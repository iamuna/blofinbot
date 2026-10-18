#!/usr/bin/env node
/*
 * blofinbot multi-coin, multi-timeframe paper bot.
 *
 *   node lab/mtfbot.js run    --state-dir state [--minutes 340] [--git] [--seed-dir research-data] [--sim]
 *   node lab/mtfbot.js report --state-dir state
 *
 * Every minute, for every coin in lab/universe.json:
 *   - pull the newly closed 1m candle from BloFin, mark positions, pay funding at settlement,
 *   - work open orders (post at the best price, re-post on each 1m close, market after 30 minutes),
 *   - note which timeframes closed (1m, 2m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 3d, 1w, 1M, 3M).
 * Every hour close: append BloFin 1H candles and recompute each coin's target position with the
 * multi-timeframe engine (lab/mtf/mtf.js, configuration V3 = what the research validated), apply the
 * portfolio risk governor, and send orders where holdings are outside the hysteresis band.
 * PAPER ONLY: nothing is sent to an exchange.
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), zlib = require('zlib');
const M = require('./mtf/mtf.js');

// ───────────────────────── args & config
const argv = process.argv.slice(2);
const CMD = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'run';
const A = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const DIR = path.resolve(A['state-dir'] || 'mtf-state');
const RUN_MIN = +(A.minutes || 340);
const SIM = !!A.sim, GIT = !!A.git;
const SEED = A['seed-dir'] ? path.resolve(A['seed-dir']) : null;
const PUSH_EVERY = +(A['push-every'] || 10);
const BRANCH = A.branch || 'mtf-state';
const BASE_UNIVERSE = JSON.parse(fs.readFileSync(path.join(__dirname, 'universe.json'), 'utf8'));
let UNIVERSE = BASE_UNIVERSE; // replaced at start-up by resolveUniverse()
const P = require('./mtf/profile.js');
const STRAT = ['1d', '3d', '1w', '1M', '3M'];
// Validated configuration (docs/RESEARCH_MTF_2026-10-18.md)
const ENGINE = Object.assign({ shortTfs: STRAT, normLive: true, fundingCrowd: 0, minHistoryDays: 0 }, BASE_UNIVERSE.engine || {});
const EXEC = { chaseMinutes: 30, thruBps: 0.5, maker: 0.0002, taker: 0.0006, slip: 0.0002 };
const RISK = Object.assign({ equity0: 10000, dailyLossPct: 5, ddHalvePct: 15, ddFlatPct: 25, maxCoinWeight: 0.6, staleMin: 5 }, BASE_UNIVERSE.risk || {});
const HIST_HOURS = 24 * 500; // hourly history kept per coin (≈ 16 months; covers the 360-day lookback)
const TFS_ALL = ['1m', '2m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '3d', '1w', '1M', '3M'];

const H = 3600, MIN = 60;
let simNow = 0;
const nowSec = () => (SIM ? simNow : Math.floor(Date.now() / 1000));
const iso = (t) => new Date(t * 1000).toISOString().replace('.000Z', 'Z');
const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const px = (x) => (x >= 100 ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : x >= 1 ? x.toFixed(4) : x.toPrecision(5));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── market data (BloFin public REST; closed candles only, ascending)
async function getJSON(url) {
  let last;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'blofinbot-mtf/1.0' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) { last = new Error('HTTP ' + r.status); await sleep(1500 * (a + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (String(j.code) !== '0') throw new Error('BloFin code ' + j.code + ' ' + (j.msg || ''));
      return j.data;
    } catch (e) { last = e; await sleep(800 * (a + 1)); }
  }
  throw last;
}
const BAR = { 1: '1m', 60: '1H' };
const blofin = {
  async candles(instId, minutes, limit, afterMs) {
    const u = new URL('https://openapi.blofin.com/api/v1/market/candles');
    u.searchParams.set('instId', instId); u.searchParams.set('bar', BAR[minutes]); u.searchParams.set('limit', String(Math.min(1440, limit)));
    if (afterMs) u.searchParams.set('after', String(afterMs));
    const d = await getJSON(u);
    return d.filter((r) => String(r[8]) === '1').map((r) => ({ t: Math.floor(+r[0] / 1000), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] })).reverse();
  },
  async funding(instId) {
    const d = await getJSON(`https://openapi.blofin.com/api/v1/market/funding-rate?instId=${encodeURIComponent(instId)}`);
    const x = Array.isArray(d) ? d[0] : d;
    return x ? { rate: +x.fundingRate, next: Math.floor(+x.fundingTime / 1000) } : null;
  },
};
// simulated exchange for offline tests: replays research-data 5m candles as if each were one minute
const simData = {};
function simLoad(coin) {
  if (simData[coin]) return simData[coin];
  const p = path.join(SEED, coin, '5m.csv.gz');
  const rows = zlib.gunzipSync(fs.readFileSync(p)).toString('utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split(',').map(Number));
  const scale = coinCfg(coin).seedScale || 1;
  return (simData[coin] = rows.map((r) => ({ t: r[0] / 1000, o: r[1] / scale, h: r[2] / scale, l: r[3] / scale, c: r[4] / scale, v: r[5] })));
}
const sim = {
  async candles(coin, minutes, limit) {
    const rows = simLoad(coin), out = [];
    if (minutes === 1) { for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) if (rows[i].t + 300 <= simNow) out.push(rows[i]); return out.reverse(); }
    let cur = null; const span = 3600;
    for (const b of rows) { if (b.t + 300 > simNow) break; const k = Math.floor(b.t / span) * span; if (!cur || cur.t !== k) { if (cur) out.push(cur); cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; } else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; } }
    if (cur && cur.t + span <= simNow) out.push(cur);
    return out.slice(-limit);
  },
  async funding() { return { rate: 0.0001, next: Math.ceil(simNow / (8 * H)) * 8 * H }; },
};
const coinCfg = (coin) => UNIVERSE.coins.find((c) => c.coin === coin);

// ───────────────────────── universe: weekly top-20 from research-data (minus exclusions) + coins still held
function resolveUniverse() {
  const ex = new Set(BASE_UNIVERSE.exclude || []);
  let coins = BASE_UNIVERSE.coins.slice(), source = 'lab/universe.json';
  try {
    if (SEED && fs.existsSync(path.join(SEED, 'universe.json')) && fs.existsSync(path.join(SEED, 'manifest.json'))) {
      const u = JSON.parse(fs.readFileSync(path.join(SEED, 'universe.json'), 'utf8')), m = JSON.parse(fs.readFileSync(path.join(SEED, 'manifest.json'), 'utf8'));
      const by = Object.fromEntries((m.coins || []).map((c) => [c.coin, c]));
      const pick = (u.selected || []).filter((r) => by[r.base] && by[r.base].status === 'ok' && !ex.has(r.base)).map((r) => ({ coin: r.base, instId: r.instId, binance: by[r.base].binance_symbol, seedScale: by[r.base].binance_symbol.startsWith('1000') && !r.instId.startsWith('1000') ? 1000 : 1 }));
      if (pick.length >= 5) { coins = pick; source = 'research-data universe ' + (u.generated_at_utc || '').slice(0, 10); }
    }
  } catch (e) { console.error('universe', e.message); }
  coins = coins.filter((c) => !ex.has(c.coin));
  const have = new Set(coins.map((c) => c.coin));
  // coins we still hold (or have orders in) stay until flat, with a zero target
  const prev = ((S && S.universe) || []).slice();
  // coins with positions or orders but no universe record (e.g. state from an older version)
  for (const k of new Set([...Object.keys(S.pos || {}), ...Object.keys(S.orders || {})])) if (!prev.some((c) => c.coin === k)) prev.push({ coin: k, instId: k + '-USDT', seedScale: 1 });
  for (const c of prev) if (!have.has(c.coin) && ((S.pos[c.coin] && S.pos[c.coin].qty) || S.orders[c.coin])) {
    if (ex.has(c.coin) && S.orders[c.coin] && !(S.pos[c.coin] && S.pos[c.coin].qty)) { delete S.orders[c.coin]; continue; } // excluded and nothing filled: just cancel
    coins.push(Object.assign({}, c, { windDown: true })); have.add(c.coin);
  }
  UNIVERSE = Object.assign({}, BASE_UNIVERSE, { coins, source });
  const added = coins.filter((c) => !prev.some((p) => p.coin === c.coin)).map((c) => c.coin);
  const dropped = prev.filter((p) => !have.has(p.coin)).map((p) => p.coin);
  S.universePrevCount = ((S && S.universe) || []).length;
  S.universe = coins.map((c) => ({ coin: c.coin, instId: c.instId, binance: c.binance, seedScale: c.seedScale, windDown: !!c.windDown }));
  return { added, dropped, windDown: coins.filter((c) => c.windDown).map((c) => c.coin) };
}

// ───────────────────────── state
let S = null;
function fresh() {
  return { version: 1, createdAt: nowSec(), updatedAt: 0, equity0: RISK.equity0, cash: RISK.equity0, pos: {}, orders: {}, fills: [], events: [], equity: [], peak: RISK.equity0, day: -1, dayStart: RISK.equity0, lastHour: 0, lastMin: {}, funding: {}, targets: {}, thinking: null, errors: [], runs: [], controlApplied: null, paused: false, riskScale: 1, governor: 'normal', stats: null };
}
function load() {
  const p = path.join(DIR, 'state.json');
  S = fs.existsSync(p) ? Object.assign(fresh(), JSON.parse(fs.readFileSync(p, 'utf8'))) : fresh();
}
function save() {
  S.updatedAt = nowSec();
  S.fills = S.fills.slice(-3000); S.events = S.events.slice(-800); S.equity = S.equity.slice(-8000); S.errors = S.errors.slice(-100); S.runs = S.runs.slice(-50);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(S));
  fs.writeFileSync(path.join(DIR, 'summary.md'), summary());
}
function event(type, text, extra) { const t = nowSec(); S.events.push(Object.assign({ t, type, text }, extra || {})); if (!SIM || A.verbose) console.log(`[${iso(t)}] ${type.padEnd(7)} ${text}`); }
let lastErr = '', lastErrT = 0;
function error(where, e) { const msg = `${where}: ${e && e.message ? e.message : e}`; const t = nowSec(); if (msg === lastErr && t - lastErrT < 900) return; lastErr = msg; lastErrT = t; S.errors.push({ t, msg: msg.slice(0, 300) }); console.error(`[${iso(t)}] ERROR ${msg}`); }

// ───────────────────────── hourly history per coin (persisted as CSV)
const HOURS = {}; // coin → [{t,o,h,l,c,v}]
const FUND_HIST = {}; // coin → [[t, rate]]
function hourFile(coin) { return path.join(DIR, 'hours', coin + '.csv'); }
function loadHours(coin) {
  const p = hourFile(coin);
  HOURS[coin] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => /^\d/.test(l)).map((l) => { const q = l.split(',').map(Number); return { t: q[0], o: q[1], h: q[2], l: q[3], c: q[4], v: q[5] }; }) : [];
  const fp = path.join(DIR, 'hours', coin + '.funding.csv');
  FUND_HIST[coin] = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8').split('\n').filter((l) => /^\d/.test(l)).map((l) => l.split(',').map(Number)) : [];
}
function saveHours(coin) {
  fs.mkdirSync(path.join(DIR, 'hours'), { recursive: true });
  const rows = HOURS[coin].slice(-HIST_HOURS);
  HOURS[coin] = rows;
  fs.writeFileSync(hourFile(coin), 't,o,h,l,c,v\n' + rows.map((b) => [b.t, b.o, b.h, b.l, b.c, +b.v.toFixed(4)].join(',')).join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'hours', coin + '.funding.csv'), 't,rate\n' + FUND_HIST[coin].slice(-2000).map((r) => r.join(',')).join('\n') + '\n');
}
// seed from the research-data branch (Binance USD-M history), rescaled to BloFin's contract price units
function seedHours(coin) {
  if (!SEED) return 0;
  const c = coinCfg(coin), p = path.join(SEED, coin, '1h.csv.gz');
  if (!fs.existsSync(p)) return 0;
  const scale = c.seedScale || 1;
  const lines = zlib.gunzipSync(fs.readFileSync(p)).toString('utf8').split('\n');
  const hdr = lines[0].split(','), ix = (k) => hdr.indexOf(k);
  const cut = nowSec() - HIST_HOURS * H;
  const rows = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const r = lines[i].split(','); const t = +r[ix('t')] / 1000; if (t < cut || t + H > nowSec()) continue; rows.push({ t, o: +r[ix('o')] / scale, h: +r[ix('h')] / scale, l: +r[ix('l')] / scale, c: +r[ix('c')] / scale, v: +r[ix('v')] }); }
  HOURS[coin] = rows;
  const fp = path.join(SEED, coin, 'funding.csv.gz');
  if (fs.existsSync(fp)) FUND_HIST[coin] = zlib.gunzipSync(fs.readFileSync(fp)).toString('utf8').split('\n').slice(1).filter(Boolean).map((l) => { const q = l.split(',').map(Number); return [Math.floor(q[0] / 1000), q[1]]; }).filter((r) => r[0] >= cut);
  return rows.length;
}
async function syncHours(coin, feed) {
  const c = coinCfg(coin), rows = HOURS[coin];
  const lastClosed = Math.floor(nowSec() / H) * H - H;
  const have = rows.length ? rows[rows.length - 1].t : 0;
  if (have >= lastClosed) return 0;
  const need = Math.min(1440, Math.ceil((lastClosed - have) / H) + 2);
  const got = SIM ? await feed.candles(coin, 60, need) : await feed.candles(c.instId, 60, need);
  // join check: overlapping hour must agree within 1.5% (catches unit/contract mismatches between sources)
  if (have) {
    const ov = got.find((b) => b.t === have);
    if (ov) { const r = ov.c / rows[rows.length - 1].c; if (Math.abs(r - 1) > 0.015) { event('data', `${coin}: BloFin and seeded history disagree by ${((r - 1) * 100).toFixed(1)}% at ${iso(have)} — rescaling seeded history`); for (const b of rows) { b.o *= r; b.h *= r; b.l *= r; b.c *= r; } } }
  }
  let added = 0;
  for (const b of got) if (b.t > (rows.length ? rows[rows.length - 1].t : 0) && b.t <= lastClosed) { if (rows.length && b.t - rows[rows.length - 1].t > H) event('data', `${coin}: ${(b.t - rows[rows.length - 1].t) / H - 1} hour(s) missing before ${iso(b.t)} (kept missing)`); rows.push(b); added++; }
  return added;
}

// deepen a short history from BloFin itself (records earlier than the oldest candle we have)
async function backfillHours(coin, feed) {
  if (SIM) return 0;
  const c = coinCfg(coin), rows = HOURS[coin], want = nowSec() - HIST_HOURS * H;
  let added = 0;
  for (let k = 0; k < 12; k++) {
    const first = rows.length ? rows[0].t : Math.floor(nowSec() / H) * H;
    if (first <= want) break;
    const got = await feed.candles(c.instId, 60, 1440, first * 1000);
    const older = got.filter((b) => b.t < first);
    if (!older.length) break;
    rows.unshift(...older); added += older.length;
    await sleep(150);
  }
  return added;
}

// ───────────────────────── coin profiles: how each market moves (computed before a coin trades, refreshed daily)
function profileAll(newOnly) {
  S.profiles = S.profiles || {};
  const btc = HOURS.BTC && HOURS.BTC.length ? [...P.dayReturns(HOURS.BTC.map((b) => b.t), HOURS.BTC.map((b) => b.c))].sort((a, b) => a[0] - b[0]) : null;
  for (const c of UNIVERSE.coins) {
    const rows = HOURS[c.coin];
    if (!rows || rows.length < 24 * 60) continue;
    if (newOnly && S.profiles[c.coin]) continue;
    const n = rows.length, hourly = { t: new Float64Array(n), c: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), qv: new Float64Array(n), funding: FUND_HIST[c.coin] || [] };
    rows.forEach((b, i) => { hourly.t[i] = b.t; hourly.c[i] = b.c; hourly.h[i] = b.h; hourly.l[i] = b.l; hourly.qv[i] = b.v * b.c; });
    try {
      const p = P.profileCoin(c.coin, hourly, null, btc);
      const fresh = !S.profiles[c.coin];
      S.profiles[c.coin] = { t: nowSec(), days: p.days, annualVol: p.annualVol, varianceRatio: p.varianceRatio, betaBTC: p.betaBTC, corrBTC: p.corrBTC, feeShare1h: p.costShareTaker['1h'], feeShare1d: p.costShareTaker['1d'], trendEfficiency: p.trendEfficiency30d, funding: p.funding || null, plan: p.plan };
      if (fresh) event('profile', `Analysed ${c.coin}: ${(p.annualVol * 100).toFixed(0)}% annual volatility, ${p.betaBTC}× BTC (corr ${p.corrBTC}); trends at ${p.plan.trendHorizons.join('/') || 'no horizon'}, snaps back at ${p.plan.meanReversionHorizons.join('/') || 'no horizon'}; fees are ${(p.costShareTaker['1h'] * 100).toFixed(0)}% of an hourly candle, ${(p.costShareTaker['1d'] * 100).toFixed(0)}% of a daily one → signals from ${p.plan.smallestSignalTimeframe} and up.`, { coin: c.coin });
    } catch (e) { error('profile ' + c.coin, e); }
  }
}

// ───────────────────────── minute data (memory only; refetched on restart)
const MINS = {}; // coin → last 1440 1m candles
async function syncMinutes(coin, feed) {
  const c = coinCfg(coin), arr = MINS[coin] || (MINS[coin] = []);
  const have = arr.length ? arr[arr.length - 1].t : 0;
  const lastClosed = Math.floor(nowSec() / MIN) * MIN - MIN;
  if (have >= lastClosed) return [];
  const need = have ? Math.min(1440, Math.ceil((lastClosed - have) / MIN) + 2) : 240;
  const got = SIM ? await feed.candles(coin, 1, need) : await feed.candles(c.instId, 1, need);
  const added = got.filter((b) => b.t > have && b.t <= lastClosed);
  for (const b of added) arr.push(b);
  if (arr.length > 1440) arr.splice(0, arr.length - 1440);
  return added;
}
const lastPrice = (coin) => { const m = MINS[coin]; if (m && m.length) return m[m.length - 1].c; const h = HOURS[coin]; return h && h.length ? h[h.length - 1].c : NaN; };

// ───────────────────────── paper broker
function equityNow() {
  let e = S.cash;
  for (const coin in S.pos) { const p = S.pos[coin], c = lastPrice(coin); if (p.qty && isFinite(c)) e += p.qty * (c - p.avg); }
  return e;
}
function fill(coin, qty, price, fee, why) {
  // qty signed (base units); realised P&L booked into cash, avg price kept for open part
  const p = S.pos[coin] || (S.pos[coin] = { qty: 0, avg: 0 });
  const feeUsd = Math.abs(qty) * price * fee;
  S.cash -= feeUsd;
  if (p.qty === 0 || Math.sign(p.qty) === Math.sign(qty)) {
    p.avg = (p.avg * Math.abs(p.qty) + price * Math.abs(qty)) / (Math.abs(p.qty) + Math.abs(qty));
    p.qty += qty;
  } else {
    const closeQty = Math.min(Math.abs(qty), Math.abs(p.qty)) * Math.sign(qty);
    S.cash += -closeQty * (price - p.avg); // closing a long (closeQty<0) books (price-avg)*|q|
    p.qty += closeQty;
    const rest = qty - closeQty;
    if (Math.abs(p.qty) < 1e-12) { p.qty = 0; p.avg = 0; }
    if (rest !== 0) { p.qty = rest; p.avg = price; }
  }
  S.fills.push({ t: nowSec(), coin, qty, price, feeUsd: +feeUsd.toFixed(4), why });
}
function workOrders(coin, bars) {
  const o = S.orders[coin];
  if (!o) return;
  for (const b of bars) {
    if (b.t < o.t0) continue;
    const side = Math.sign(o.qty);
    const through = side > 0 ? b.l <= o.limit * (1 - EXEC.thruBps / 1e4) : b.h >= o.limit * (1 + EXEC.thruBps / 1e4);
    if (through) { fill(coin, o.qty, o.limit, EXEC.maker, 'limit'); event('fill', `${coin} ${side > 0 ? 'bought' : 'sold'} ${Math.abs(o.qty).toPrecision(4)} at ${px(o.limit)} (limit, maker fee) — ${o.reason}`, { coin }); delete S.orders[coin]; return; }
    if (b.t + MIN - o.t0 >= EXEC.chaseMinutes * MIN) { const p = b.c * (1 + side * EXEC.slip); fill(coin, o.qty, p, EXEC.taker, 'market'); event('fill', `${coin} ${side > 0 ? 'bought' : 'sold'} ${Math.abs(o.qty).toPrecision(4)} at ${px(p)} (market after ${EXEC.chaseMinutes} min) — ${o.reason}`, { coin }); delete S.orders[coin]; return; }
    o.limit = b.c; // re-post at the latest price
  }
}
function payFunding(coin, info) {
  const f = S.funding[coin];
  if (f && f.next && nowSec() >= f.next) {
    const p = S.pos[coin], c = lastPrice(coin);
    if (p && p.qty && isFinite(c) && isFinite(f.rate)) { const usd = p.qty * c * f.rate; S.cash -= usd; S.fundingPaid = (S.fundingPaid || 0) + usd; }
    FUND_HIST[coin] = FUND_HIST[coin] || []; FUND_HIST[coin].push([f.next, f.rate]);
    f.next = 0;
  }
  if (info) S.funding[coin] = info;
}

// ───────────────────────── targets (hourly)
function computeTargets() {
  const coins = UNIVERSE.coins.map((c) => c.coin).filter((c) => HOURS[c] && HOURS[c].length > 24 * 30);
  const data = coins.map((coin) => {
    const rows = HOURS[coin], n = rows.length;
    const d = { coin, n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), qv: new Float64Array(n), funding: FUND_HIST[coin] || [] };
    rows.forEach((b, i) => { d.t[i] = b.t; d.o[i] = b.o; d.h[i] = b.h; d.l[i] = b.l; d.c[i] = b.c; d.v[i] = b.v; d.qv[i] = b.v * b.c; });
    return d;
  });
  const grid = M.align(data);
  const r = M.simulate(grid, Object.assign({}, ENGINE, { start: grid.t[0] + 400 * 86400 > grid.t[grid.n - 1] ? grid.t[Math.floor(grid.n / 2)] : grid.t[0] + 400 * 86400 }));
  const out = {};
  coins.forEach((coin, j) => {
    const comps = r.lastComponents[j];
    const byTf = {};
    for (const c of comps) { const k = c.tf; (byTf[k] = byTf[k] || []).push(c.s); }
    const votes = {}; for (const k in byTf) votes[k] = +(byTf[k].reduce((a, b) => a + b, 0) / byTf[k].length).toFixed(2);
    const wd = coinCfg(coin) && coinCfg(coin).windDown;
    out[coin] = { weight: wd ? 0 : r.lastWant[j], vol: r.lastVol[j], xsec: r.lastXsec ? r.lastXsec[j] : null, votes, gridEnd: grid.t[grid.n - 1], windDown: !!wd };
  });
  return { targets: out, portScale: r.portScale, backtestSharpe: r.sharpe };
}
function governor(eq) {
  const day = Math.floor(nowSec() / 86400);
  if (day !== S.day) { S.day = day; S.dayStart = eq; if (S.governor === 'daily-loss') S.governor = 'normal'; }
  if (eq > S.peak) S.peak = eq;
  const dd = (1 - eq / S.peak) * 100, dl = (1 - eq / S.dayStart) * 100;
  let scale = S.riskScale, mode = 'normal', blockAdds = false;
  if (dd >= RISK.ddFlatPct) { mode = 'flat'; scale = 0; }
  else if (dd >= RISK.ddHalvePct) { mode = 'half'; scale *= 0.5; }
  if (dl >= RISK.dailyLossPct) { blockAdds = true; if (mode === 'normal') mode = 'daily-loss'; }
  if (S.paused) { mode = 'paused'; blockAdds = true; }
  if (mode !== S.governor) { event('risk', `Risk governor: ${S.governor} → ${mode} (drawdown ${dd.toFixed(1)}%, today ${(-dl).toFixed(1)}%)`); S.governor = mode; if (mode === 'flat') S.paused = true; }
  return { scale, blockAdds, dd, dl };
}
function rebalance() {
  const eq = equityNow();
  const g = governor(eq);
  for (const coin in S.targets) {
    const T = S.targets[coin], c = lastPrice(coin);
    if (!isFinite(c) || c <= 0) continue;
    const mins = MINS[coin];
    if (!SIM && (!mins || !mins.length || nowSec() - (mins[mins.length - 1].t + MIN) > RISK.staleMin * MIN)) { T.note = 'stale data: no orders'; continue; }
    let w = Math.max(-RISK.maxCoinWeight, Math.min(RISK.maxCoinWeight, T.weight * g.scale));
    const cur = (S.pos[coin] ? S.pos[coin].qty : 0) * c / eq;
    const gap = w - cur;
    const adds = Math.abs(w) > Math.abs(cur) + 1e-9;
    if (g.blockAdds && adds) { T.note = 'adds blocked by risk governor'; continue; }
    // hysteresis: same rule as the backtest (trade if |gap| > 0.5% of equity and outside a 25% band, or on a sign change)
    if (Math.abs(gap) < ENGINE.minTradePct || (Math.abs(gap) < ENGINE.band * Math.abs(w) && w !== 0 && Math.sign(w) === Math.sign(cur))) { if (S.orders[coin] && Math.sign(S.orders[coin].qty) !== Math.sign(gap)) delete S.orders[coin]; T.note = 'within band'; continue; }
    const qty = (gap * eq) / c;
    const reason = `target ${(w * 100).toFixed(1)}% of equity (was ${(cur * 100).toFixed(1)}%)`;
    S.orders[coin] = { qty, limit: c, t0: nowSec() - (nowSec() % MIN), reason };
    T.note = 'order working';
    event('order', `${coin}: ${qty > 0 ? 'buy' : 'sell'} ${Math.abs(qty).toPrecision(4)} (~${money(Math.abs(qty * c))}) — ${reason}`, { coin });
  }
}
ENGINE.band = ENGINE.band || M.DEFAULT.band; ENGINE.minTradePct = ENGINE.minTradePct || M.DEFAULT.minTradePct;

// ───────────────────────── timeframe clock + thinking
function closedTfs(t) { // timeframes whose candle closed at boundary t (t = start of the new minute)
  const out = ['1m'];
  const m = Math.floor(t / 60);
  for (const [k, n] of [['2m', 2], ['3m', 3], ['5m', 5], ['15m', 15], ['30m', 30]]) if (m % n === 0) out.push(k);
  if (t % H === 0) {
    out.push('1h');
    for (const k of ['2h', '4h', '6h', '12h', '1d', '3d', '1w', '1M', '3M']) if (M.bucketOf(t - 1, k) !== M.bucketOf(t, k)) out.push(k);
  }
  return out;
}
function microView(coin, minutes) { // direction of the last 20 candles of a sub-hour timeframe, from 1m data
  const m = MINS[coin]; if (!m || m.length < minutes * 21) return null;
  const closes = []; for (let i = m.length - 1; i >= 0 && closes.length < 21; i -= minutes) closes.push(m[i].c);
  const ch = closes[0] / closes[closes.length - 1] - 1;
  return +(ch * 1e4).toFixed(0); // bps over 20 candles
}
function snapshot(closed) {
  const eq = equityNow();
  const coins = Object.keys(S.targets).sort((a, b) => Math.abs(S.targets[b].weight) - Math.abs(S.targets[a].weight));
  S.thinking = {
    t: nowSec(), closed, equity: eq,
    coins: coins.map((coin) => {
      const T = S.targets[coin], p = S.pos[coin], c = lastPrice(coin);
      const strat = STRAT.map((k) => T.votes[k]).filter((x) => x != null), setup = ['1h', '2h', '4h', '6h', '12h'].map((k) => T.votes[k]).filter((x) => x != null);
      return {
        coin, price: c, target: +(T.weight * 100).toFixed(2), holding: +(((p ? p.qty : 0) * c / eq) * 100).toFixed(2),
        strategic: strat.length ? +(strat.reduce((a, b) => a + b, 0) / strat.length).toFixed(2) : null,
        setup: setup.length ? +(setup.reduce((a, b) => a + b, 0) / setup.length).toFixed(2) : null,
        votes: T.votes, xsec: T.xsec != null ? +T.xsec.toFixed(2) : null, vol: T.vol ? +(T.vol * 100).toFixed(0) : null,
        micro: { '1m': microView(coin, 1), '5m': microView(coin, 5), '15m': microView(coin, 15), '30m': microView(coin, 30) },
        order: S.orders[coin] ? { qty: S.orders[coin].qty, limit: S.orders[coin].limit, since: S.orders[coin].t0 } : null,
        note: T.note || '', windDown: !!T.windDown,
        profile: S.profiles && S.profiles[coin] ? { vol: S.profiles[coin].annualVol, beta: S.profiles[coin].betaBTC, trends: S.profiles[coin].plan.trendHorizons, reverts: S.profiles[coin].plan.meanReversionHorizons, minSignal: S.profiles[coin].plan.smallestSignalTimeframe, feeShare1h: S.profiles[coin].feeShare1h } : null,
      };
    }),
  };
}
function stats() {
  const eq = equityNow();
  const gross = Object.keys(S.pos).reduce((a, k) => a + Math.abs((S.pos[k].qty || 0) * lastPrice(k)), 0);
  const fees = S.fills.reduce((a, f) => a + f.feeUsd, 0);
  S.stats = { equity: +eq.toFixed(2), netPct: +((eq / S.equity0 - 1) * 100).toFixed(3), gross: +(gross / eq).toFixed(3), peak: +S.peak.toFixed(2), drawdownPct: +((1 - eq / S.peak) * 100).toFixed(2), fills: S.fills.length, feesUsd: +fees.toFixed(2), fundingUsd: +(S.fundingPaid || 0).toFixed(2), openOrders: Object.keys(S.orders).length, positions: Object.values(S.pos).filter((p) => p.qty).length, governor: S.governor };
}
function summary() {
  const s = S.stats || {};
  const L = ['# Multi-coin paper bot — live status', '', `Updated ${S.updatedAt ? iso(S.updatedAt) : '—'} · ${UNIVERSE.coins.length} coins · mode: **PAPER** · risk governor: ${S.governor}${S.paused ? ' (paused)' : ''}`, ''];
  L.push('| Equity | Net | Gross exposure | Drawdown | Fills | Fees | Funding |', '|---|---|---|---|---|---|---|');
  L.push(`| ${money(s.equity || 0)} | ${(s.netPct || 0).toFixed(2)}% | ${((s.gross || 0) * 100).toFixed(0)}% | ${s.drawdownPct || 0}% | ${s.fills || 0} | ${money(s.feesUsd || 0)} | ${money(s.fundingUsd || 0)} |`, '');
  if (S.thinking) {
    L.push('| Coin | Price | Target | Holding | 1d→3M vote | 1h→12h vote | Cross-coin rank | Note |', '|---|---|---|---|---|---|---|---|');
    for (const c of S.thinking.coins) L.push(`| ${c.coin} | ${px(c.price)} | ${c.target}% | ${c.holding}% | ${c.strategic ?? '—'} | ${c.setup ?? '—'} | ${c.xsec ?? '—'} | ${c.note} |`);
    L.push('');
  }
  L.push('## Recent events', '');
  for (const e of S.events.slice(-20).reverse()) L.push(`- \`${iso(e.t)}\` ${e.text}`);
  if (S.errors.length) { L.push('', '## Recent errors', ''); for (const e of S.errors.slice(-5).reverse()) L.push(`- \`${iso(e.t)}\` ${e.msg}`); }
  return L.join('\n') + '\n';
}

// ───────────────────────── git persistence + supervisor control
function git(args) { return cp.execFileSync('git', ['-C', DIR, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function push(msg) {
  if (!GIT) return;
  try {
    git(['add', '-A']);
    try { git(['commit', '-q', '-m', msg]); } catch (e) { /* nothing new */ }
    try { git(['pull', '-q', '--rebase', '-X', 'theirs', 'origin', BRANCH]); } catch (e) { /* first push */ }
    git(['push', '-q', 'origin', 'HEAD:' + BRANCH]);
  } catch (e) { error('git push', e); }
}
function readControl() {
  const p = path.join(DIR, 'control.json');
  if (!fs.existsSync(p)) return;
  let c; try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { error('control.json', e); return; }
  if (!c.id || c.id === S.controlApplied) return;
  S.controlApplied = c.id;
  if (c.pause != null) { S.paused = !!c.pause; event('super', `Supervisor ${S.paused ? 'paused' : 'resumed'} the bot${c.note ? ' — ' + c.note : ''}`); }
  if (c.riskScale != null) { S.riskScale = Math.max(0, Math.min(1, +c.riskScale)); event('super', `Supervisor set risk scale to ${S.riskScale}`); }
  if (c.flatten) { for (const coin in S.pos) if (S.pos[coin].qty) S.orders[coin] = { qty: -S.pos[coin].qty, limit: lastPrice(coin), t0: nowSec() - (nowSec() % MIN), reason: 'supervisor flatten' }; S.paused = true; event('super', 'Supervisor: flatten all positions and pause'); }
  if (c.resetPeak) { S.peak = equityNow(); event('super', 'Supervisor reset the drawdown peak'); }
  if (c.note && c.pause == null) event('super', 'Supervisor note: ' + c.note);
}

// ───────────────────────── main loop
async function run() {
  load();
  const feed = SIM ? sim : blofin;
  if (SIM) simNow = +(A['sim-start'] || Date.parse('2025-06-01T00:00:00Z') / 1000);
  const started = nowSec(), runId = process.env.GITHUB_RUN_ID || 'local-' + started;
  S.runs.push({ id: runId, start: started });
  const uni = resolveUniverse();
  if (uni.added.length && (S.universePrevCount || 0) > 0) event('universe', `Universe update (${UNIVERSE.source}): added ${uni.added.join(', ')}`);
  if (uni.dropped.length) event('universe', `Removed from the universe: ${uni.dropped.join(', ')}`);
  if (uni.windDown.length) event('universe', `Winding down (no longer top-20, still held): ${uni.windDown.join(', ')}`);
  for (const c of UNIVERSE.coins) {
    loadHours(c.coin);
    if (HOURS[c.coin].length < 24 * 30) { const n = seedHours(c.coin); if (n) event('data', `${c.coin}: seeded ${n} hourly candles from research history`); }
    if (HOURS[c.coin].length < 24 * 400) { try { const n = await backfillHours(c.coin, feed); if (n) event('data', `${c.coin}: loaded ${n} older hourly candles from BloFin`); } catch (e) { error('backfill ' + c.coin, e); } }
  }
  profileAll(true);
  event('start', `Bot started (run ${runId}): ${UNIVERSE.coins.length} coins (${UNIVERSE.source}), checking every minute.`);
  let stop = false; process.on('SIGTERM', () => (stop = true)); process.on('SIGINT', () => (stop = true));
  let lastPush = 0, needTargets = !Object.keys(S.targets).length;
  while (!stop && nowSec() - started < RUN_MIN * 60) {
    const tick = nowSec(), boundary = Math.floor(tick / MIN) * MIN;
    try {
      readControl();
      // 1) minute candles, orders, funding
      for (const c of UNIVERSE.coins) {
        try {
          const bars = await syncMinutes(c.coin, feed);
          if (bars.length) workOrders(c.coin, bars);
          if (!SIM) await sleep(60);
        } catch (e) { error('minutes ' + c.coin, e); }
      }
      // 2) hour close: candles, funding info, targets, orders
      const hourNow = Math.floor(tick / H) * H;
      if (hourNow > S.lastHour || needTargets) {
        let added = 0;
        for (const c of UNIVERSE.coins) {
          try { added += await syncHours(c.coin, feed); if (!SIM) await sleep(80); } catch (e) { error('hours ' + c.coin, e); }
          try { payFunding(c.coin, await feed.funding(c.instId)); } catch (e) { error('funding ' + c.coin, e); }
        }
        try {
          const r = computeTargets();
          for (const coin in r.targets) S.targets[coin] = Object.assign(S.targets[coin] || {}, r.targets[coin]);
          for (const coin of Object.keys(S.targets)) if (!coinCfg(coin)) delete S.targets[coin];
          if (new Date(hourNow * 1000).getUTCHours() === 0) profileAll(false);
          S.portScale = r.portScale;
          rebalance();
          S.lastHour = hourNow; needTargets = false;
          for (const c of UNIVERSE.coins) saveHours(c.coin);
        } catch (e) { error('targets', e); }
      } else for (const c of UNIVERSE.coins) payFunding(c.coin, null);
      // 3) book-keeping
      const eq = equityNow();
      const le = S.equity[S.equity.length - 1];
      if (!le || boundary - le[0] >= 900) S.equity.push([boundary, +eq.toFixed(2)]);
      snapshot(closedTfs(boundary));
      stats();
      save();
      if (nowSec() - lastPush >= PUSH_EVERY * 60) { lastPush = nowSec(); push(`mtf ${iso(nowSec())} eq ${S.stats.equity} pos ${S.stats.positions}`); }
    } catch (e) { error('tick', e); }
    if (SIM) { simNow += 300; continue; }
    const next = (Math.floor(Date.now() / 60000) + 1) * 60000 + 5000;
    while (!stop && Date.now() < next) await sleep(Math.min(1000, next - Date.now()));
  }
  event('stop', `Run ${runId} ending after ${Math.round((nowSec() - started) / 60)} minutes; the next run continues from this state.`);
  stats(); save(); push(`mtf ${iso(nowSec())} end of run`);
}
function report() { load(); console.log(summary()); }

if (require.main === module) {
  if (CMD === 'run') run().catch((e) => { console.error(e); process.exitCode = 1; });
  else if (CMD === 'report') report();
  else { console.error('usage: mtfbot.js run|report --state-dir DIR'); process.exitCode = 2; }
}
module.exports = { closedTfs };
