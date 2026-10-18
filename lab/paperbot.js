#!/usr/bin/env node
/*
 * blofinbot paper bot — checks every minute.
 *
 *   node lab/paperbot.js run    --state-dir state [--minutes 350] [--git] [--venue blofin,cryptocom,binance]
 *   node lab/paperbot.js report --state-dir state
 *   node lab/paperbot.js run    --state-dir /tmp/x --sim --minutes 3000      (offline test: simulated exchange, fast clock)
 *
 * Every minute: pull closed 1m candles → manage the open paper position (stops only tighten) →
 * act on the champion strategy's signal when its timeframe bar closes → log everything.
 * Every --think-every minutes: re-optimise on the venue's own 1h/4h history and swap the champion
 * only when a challenger passes the chronological train/validation/test gate AND beats the
 * champion on both validation and test by a margin. PAPER only: no order ever reaches an exchange.
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const E = require('./engine.js');

// ───────────────────────── args
const argv = process.argv.slice(2);
const CMD = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'run';
const A = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const DIR = path.resolve(A['state-dir'] || 'paper');
const RUN_MIN = +(A.minutes || 350);
const THINK_EVERY = +(A['think-every'] || 60);
const PUSH_EVERY = +(A['push-every'] || 10);
const KEEP_DAYS = +(A['keep-days'] || 21);
const BOOT_DAYS = +(A['boot-days'] || 10);
const SIM = !!A.sim;
const GIT = !!A.git;
const VENUES = String(A.venue || 'blofin,cryptocom,binance').split(',');
const THINK_TFS = String(A['think-tfs'] || '60,240').split(',').map(Number);
const HTF_DAYS = { 15: 90, 60: 365, 240: 730 };
const CHAMPION_FILE = path.join(__dirname, 'champion.json');
const BRANCH = A.branch || 'paper-state';

// ───────────────────────── clock (real or simulated)
let simNow = 0;
const nowSec = () => (SIM ? simNow : Math.floor(Date.now() / 1000));
const iso = (t) => new Date(t * 1000).toISOString().replace('.000Z', 'Z');
const hhmm = (t) => iso(t).slice(11, 16);
const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const px = (x) => x.toLocaleString('en-US', { maximumFractionDigits: x >= 1000 ? 1 : 4 });
const sgnR = (r) => (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2) + 'R';

// ───────────────────────── market data feeds (closed candles only, ascending)
async function getJSON(url) {
  let last;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'blofinbot-paper/1.0' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) { last = new Error('HTTP ' + r.status); await sleep(1500 * (a + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
      return await r.json();
    } catch (e) { last = e; if (/HTTP 4\d\d/.test(String(e.message)) && !/429/.test(e.message)) break; await sleep(1000 * (a + 1)); }
  }
  throw last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TF_CODE = {
  blofin: { 1: '1m', 15: '15m', 60: '1H', 240: '4H' },
  cryptocom: { 1: '1m', 15: '15m', 60: '1h', 240: '4h' },
  binance: { 1: '1m', 15: '15m', 60: '1h', 240: '4h' },
};
const FEEDS = {
  blofin: {
    venue: 'BloFin BTC-USDT perpetual', max: 1440,
    async page(tf, endMs, limit) {
      const u = new URL('https://openapi.blofin.com/api/v1/market/candles');
      u.searchParams.set('instId', 'BTC-USDT'); u.searchParams.set('bar', TF_CODE.blofin[tf]); u.searchParams.set('limit', String(Math.min(1440, limit)));
      if (endMs) u.searchParams.set('after', String(endMs));
      const j = await getJSON(u);
      if (String(j.code) !== '0') throw new Error('BloFin code ' + j.code + ' ' + (j.msg || ''));
      return (j.data || []).filter((r) => String(r[8]) === '1').map((r) => ({ t: Math.floor(+r[0] / 1000), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] })).reverse();
    },
  },
  cryptocom: {
    venue: 'Crypto.com BTCUSD perpetual', max: 300,
    async page(tf, endMs, limit) {
      const u = new URL('https://api.crypto.com/exchange/v1/public/get-candlestick');
      u.searchParams.set('instrument_name', 'BTCUSD-PERP'); u.searchParams.set('timeframe', TF_CODE.cryptocom[tf]); u.searchParams.set('count', String(Math.min(300, limit)));
      if (endMs) u.searchParams.set('end_ts', String(endMs - 1));
      const j = await getJSON(u);
      if (j.code && j.code !== 0) throw new Error('Crypto.com code ' + j.code + ' ' + (j.message || ''));
      const rows = (j.result && j.result.data) || j.data || [];
      const span = tf * 60;
      return rows.map((r) => ({ t: Math.floor(+(r.t ?? Date.parse(r.timestamp)) / 1000), o: +(r.o ?? r.open), h: +(r.h ?? r.high), l: +(r.l ?? r.low), c: +(r.c ?? r.close), v: +(r.v ?? r.volume ?? 0) }))
        .filter((b) => b.t + span <= nowSec()).sort((a, b) => a.t - b.t);
    },
  },
  binance: {
    venue: 'Binance BTCUSDT spot', max: 1000,
    async page(tf, endMs, limit) {
      const u = new URL('https://data-api.binance.vision/api/v3/klines');
      u.searchParams.set('symbol', 'BTCUSDT'); u.searchParams.set('interval', TF_CODE.binance[tf]); u.searchParams.set('limit', String(Math.min(1000, limit)));
      if (endMs) u.searchParams.set('endTime', String(endMs - 1));
      const j = await getJSON(u);
      return j.filter((k) => +k[6] < nowSec() * 1000).map((k) => ({ t: Math.floor(+k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    },
  },
};
// simulated exchange for offline tests
let SIMBARS = null;
function simFeed() {
  if (!SIMBARS) SIMBARS = E.genSample({ n: 60000, end: 1760000000, seed: +(A.seed || 7) });
  return {
    venue: 'Simulated (offline test)', max: 1000,
    async page(tf, endMs, limit) {
      const end = endMs ? endMs / 1000 : nowSec(), span = tf * 60, out = [];
      let cur = null;
      for (const b of SIMBARS) {
        if (b.t + 60 > end) break;
        const bk = Math.floor(b.t / span) * span;
        if (!cur || cur.t !== bk) { if (cur) out.push(cur); cur = { t: bk, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; } else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
      }
      if (cur && cur.t + span <= end) out.push(cur);
      return out.slice(-limit);
    },
  };
}
async function fetchRange(feed, tf, fromT, toT) {
  // walk backwards from toT until fromT is covered; returns ascending unique bars with fromT <= t <= toT
  const span = tf * 60, got = new Map();
  let end = (toT + span) * 1000, guard = 0;
  while (guard++ < 400) {
    const page = await feed.page(tf, end, feed.max);
    if (!page.length) break;
    for (const b of page) if (b.t >= fromT && b.t <= toT) got.set(b.t, b);
    const first = page[0].t;
    if (first <= fromT) break;
    if (first * 1000 >= end) break;
    end = first * 1000;
    if (!SIM) await sleep(120);
  }
  return [...got.values()].sort((a, b) => a.t - b.t);
}

// ───────────────────────── candle store (1m, one CSV per UTC day)
const C = { t: [], o: [], h: [], l: [], c: [], v: [] };
function loadCandles() {
  const dir = path.join(DIR, 'candles');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort().slice(-KEEP_DAYS);
  for (const f of files) for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    const p = line.split(','); if (p.length < 6 || !/^\d/.test(p[0])) continue;
    pushBar({ t: +p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
  }
}
function pushBar(b) {
  const n = C.t.length;
  if (n && b.t <= C.t[n - 1]) return false;
  C.t.push(b.t); C.o.push(b.o); C.h.push(b.h); C.l.push(b.l); C.c.push(b.c); C.v.push(b.v);
  return true;
}
const dirtyDays = new Set();
function saveCandles() {
  const dir = path.join(DIR, 'candles');
  fs.mkdirSync(dir, { recursive: true });
  const cutoff = nowSec() - KEEP_DAYS * 86400;
  // trim memory and old files
  let k = 0; while (k < C.t.length && C.t[k] < cutoff) k++;
  if (k) for (const key in C) C[key].splice(0, k);
  for (const f of fs.readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\.csv$/.test(f) && Date.parse(f.slice(0, 10) + 'T00:00:00Z') / 1000 < cutoff - 86400) fs.unlinkSync(path.join(dir, f));
  for (const day of dirtyDays) {
    const a = Date.parse(day + 'T00:00:00Z') / 1000, b = a + 86400, rows = ['t,o,h,l,c,v'];
    for (let i = 0; i < C.t.length; i++) if (C.t[i] >= a && C.t[i] < b) rows.push([C.t[i], C.o[i], C.h[i], C.l[i], C.c[i], +C.v[i].toFixed(6)].join(','));
    fs.writeFileSync(path.join(dir, day + '.csv'), rows.join('\n') + '\n');
  }
  dirtyDays.clear();
}
function datasetAll() {
  const a = {}; for (const k in C) a[k] = Float64Array.from(C[k]);
  return E.datasetFromArrays(a, { venue: state.venue });
}

// ───────────────────────── state
const CFG = { equity: 10000, risk: { mode: 'fixed', riskPct: 0.25, targetVol: 40, maxLev: 5 }, costs: { fee: 0.06, maker: 0.02, slip: 0.02 }, gov: Object.assign({}, E.GOV_DEFAULT) };
let state = null;
function freshState() {
  return { version: 1, venue: null, feedKey: null, createdAt: nowSec(), updatedAt: 0, lastT: 0, cfg: CFG, champion: null, sim: null, trades: [], events: [], equity: [], thinks: [], leaderboard: [], thinking: null, stats: null, errors: [], controlApplied: null, lastThinkT: 0, gaps: [], runs: [] };
}
function loadState() {
  const p = path.join(DIR, 'state.json');
  state = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : freshState();
  state.cfg = Object.assign({}, CFG, state.cfg, { gov: Object.assign({}, E.GOV_DEFAULT, state.cfg && state.cfg.gov) });
}
function saveState() {
  state.updatedAt = nowSec();
  state.trades = state.trades.slice(-1500);
  state.events = state.events.slice(-600);
  state.thinks = state.thinks.slice(-200);
  state.errors = state.errors.slice(-100);
  state.equity = state.equity.slice(-6000);
  state.gaps = state.gaps.slice(-100);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(DIR, 'summary.md'), summaryMd());
}
function event(t, type, text, extra) {
  state.events.push(Object.assign({ t, type, text }, extra || {}));
  if (!SIM || A.verbose) console.log(`[${iso(t)}] ${type.padEnd(7)} ${text}`);
}
let lastErrKey = '', lastErrT = 0;
function error(where, e) {
  const msg = where + ': ' + (e && e.message ? e.message : String(e));
  const t = nowSec();
  if (msg === lastErrKey && t - lastErrT < 900) return;
  lastErrKey = msg; lastErrT = t;
  state.errors.push({ t, msg: msg.slice(0, 300) });
  console.error(`[${iso(t)}] ERROR ${msg}`);
}

// sim state ↔ JSON (bar indices become timestamps so the window can slide)
function idxOf(D, t) { let lo = 0, hi = D.n - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D.t[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
function restoreSim(D) {
  const S = E.newState(state.cfg);
  const s = state.sim;
  if (!s) return S;
  Object.assign(S, s, { cfg: state.cfg, trades: [] });
  if (s.pos) { S.pos = Object.assign({}, s.pos); S.pos.ei = Math.max(0, idxOf(D, s.pos.et)); }
  if (s.pending) { S.pending = Object.assign({}, s.pending); S.pending.s = Math.max(0, idxOf(D, s.pending.st)); }
  return S;
}
function saveSim(S, D) {
  const s = { cash: S.cash, peak: S.peak, maxDD: S.maxDD, blown: S.blown, hwm: S.hwm, day: S.day, dayStart: S.dayStart, streak: S.streak, rejects: S.rejects, halted: S.halted };
  if (S.pos) { s.pos = Object.assign({}, S.pos, { et: D.t[S.pos.ei] }); delete s.pos.ei; }
  if (S.pending) { s.pending = Object.assign({}, S.pending, { st: D.t[S.pending.s] }); delete s.pending.s; }
  state.sim = s;
}

// ───────────────────────── champion
function loadSeedChampion() {
  if (!fs.existsSync(CHAMPION_FILE)) return null;
  try {
    const c = JSON.parse(fs.readFileSync(CHAMPION_FILE, 'utf8'));
    return { s: c.strategy, tf: c.tf, name: c.name || E.describe(c.strategy), status: c.status || 'gated', since: nowSec(), evidence: c.evidence || null, source: 'research (' + (c.source || 'champion.json') + ')' };
  } catch (e) { error('champion.json', e); return null; }
}
const tfLabel = (m) => (m >= 60 ? m / 60 + 'h' : m + 'm');

// ───────────────────────── per-minute processing
let D1 = null, Xcache = null;
function rebuild() {
  D1 = datasetAll();
  Xcache = null;
}
function champX() {
  if (Xcache) return Xcache;
  const ch = state.champion, f = ch.tf;
  const Dtf = f > 1 ? E.resample(D1, f) : D1;
  Xcache = { Dtf, X: E.prepareTf(D1, Dtf, f, ch.s) };
  return Xcache;
}
let lastTrailLog = 0, rejectSeen = {};
function processNew(allowEntries) {
  if (!state.champion || !D1 || D1.n < 2) return;
  const { X } = champX();
  const S = restoreSim(D1);
  let start = idxOf(D1, state.lastT) + 1;
  if (!state.lastT) start = D1.n - 1; // a fresh bot starts trading from now, no back-filled trades
  start = Math.max(1, start);
  for (let i = start; i < D1.n; i++) {
    const ev = [];
    const eq = E.step(S, D1, X, state.champion.s, i, allowEntries, ev);
    for (const e of ev) logSimEvent(e, D1, S);
    const t = D1.t[i];
    const lastEq = state.equity[state.equity.length - 1];
    if (!lastEq || t - lastEq[0] >= 900) state.equity.push([t, +eq.toFixed(2)]);
  }
  state.lastT = D1.t[D1.n - 1];
  saveSim(S, D1);
}
function logSimEvent(e, D, S) {
  const t = D.t[e.i];
  if (e.type === 'enter') {
    const p = e.pos, side = p.dir > 0 ? 'Long' : 'Short';
    event(t, 'enter', `${side} ${p.qty.toFixed(4)} BTC at ${px(p.ep)} · stop ${px(p.stop)} · target ${px(p.tp)} (R:R ${p.rr}) · risk ${money(p.risk)}`, { dir: p.dir, price: p.ep, stop: p.stop, tp: p.tp });
  } else if (e.type === 'exit') {
    const tr = e.tr, side = tr.dir > 0 ? 'long' : 'short';
    const rec = Object.assign({}, tr, { et: D.t[tr.ei], xt: D.t[tr.xi], champ: state.champion.name, tf: state.champion.tf });
    delete rec.ei; delete rec.xi;
    state.trades.push(rec);
    S.trades.length = 0;
    event(t, 'exit', `Closed ${side} at ${px(tr.xp)} — ${tr.reason} · ${sgnR(tr.R)} (${money(tr.pnl)})`, { dir: tr.dir, price: tr.xp, R: tr.R, pnl: tr.pnl, reason: tr.reason });
  } else if (e.type === 'be') {
    event(t, 'stop', `Stop moved to breakeven ${px(e.stop)}`);
  } else if (e.type === 'trail') {
    if (t - lastTrailLog >= 900) { lastTrailLog = t; event(t, 'stop', `Trailing stop tightened to ${px(e.stop)}`); }
  } else if (e.type === 'reject') {
    const key = e.reason + e.dir;
    if (!rejectSeen[key] || t - rejectSeen[key] > 3600) { rejectSeen[key] = t; event(t, 'reject', `Skipped ${e.dir > 0 ? 'long' : 'short'} signal — ${e.reason}`, { reason: e.reason }); }
  }
}

// ───────────────────────── the bot's "thinking" snapshot (what it sees right now)
const QUADS = ['trend up · calm', 'trend up · volatile', 'trend down · calm', 'trend down · volatile'];
function snapshot() {
  if (!state.champion || !D1 || D1.n < 50) return;
  const ch = state.champion, { Dtf } = champX();
  const M = ch.tf > 1 ? E.tfMap(D1, Dtf, ch.tf) : null;
  const j = M ? M.kOf[D1.n - 1] : D1.n - 1; // last closed bar of the champion's timeframe
  if (j < 30) return;
  const D = Dtf, c = D.c[j], read = [];
  const st = E.structureAt(D, j, 5);
  const ema = (n) => E.ma(D, 'EMA', n)[j];
  const lens = [21, 37, 50, 100, 200].filter((n) => !isNaN(ema(n)));
  const above = lens.filter((n) => c > ema(n));
  read.push({ k: 'Trend', v: `price above ${above.length}/${lens.length} EMAs (${lens.map((n) => (c > ema(n) ? '▲' : '▼') + n).join(' ')})`, tone: above.length >= lens.length - 1 ? 'up' : above.length <= 1 ? 'down' : '' });
  if (st.quad >= 0) read.push({ k: 'Regime', v: QUADS[st.quad], tone: st.quad < 2 ? 'up' : 'down' });
  const r = E.rsi(D, 14)[j], m = E.macd(D, 12, 26, 9), b = E.bb(D, 20, 2);
  if (!isNaN(r)) read.push({ k: 'RSI 14', v: r.toFixed(1) + (r > 70 ? ' overbought' : r < 30 ? ' oversold' : ''), tone: r > 70 ? 'down' : r < 30 ? 'up' : '' });
  if (!isNaN(m.h[j])) read.push({ k: 'MACD', v: `histogram ${m.h[j] >= 0 ? 'positive' : 'negative'}, ${m.h[j] > m.h[j - 1] ? 'rising' : 'falling'}`, tone: m.h[j] >= 0 ? 'up' : 'down' });
  if (!isNaN(b.up[j])) read.push({ k: 'Bollinger', v: `%B ${(((c - b.lo[j]) / (b.up[j] - b.lo[j])) * 100).toFixed(0)}`, tone: '' });
  const atrj = E.atr(D, 14)[j];
  if (st.sup) read.push({ k: 'Support', v: `${px(st.sup.price)} (${((c - st.sup.price) / atrj).toFixed(1)} ATR below, ${st.sup.touches} touch${st.sup.touches > 1 ? 'es' : ''})`, tone: '' });
  if (st.res) read.push({ k: 'Resistance', v: `${px(st.res.price)} (${((st.res.price - c) / atrj).toFixed(1)} ATR above, ${st.res.touches} touch${st.res.touches > 1 ? 'es' : ''})`, tone: '' });
  if (st.fib) { const L = st.fib.levels.find((x) => x.f === 0.618); read.push({ k: 'Fibonacci', v: `last leg ${st.fib.up ? 'up' : 'down'} ${px(st.fib.from.price)} → ${px(st.fib.to.price)}; 0.618 at ${px(L.price)}`, tone: '' }); }
  read.push({ k: 'Harmonic', v: st.harm ? `${st.harm.bull ? 'bullish' : 'bearish'} ${st.harm.name} forming, PRZ ${px(st.harm.bot)}–${px(st.harm.top)}` : 'no XABCD match', tone: st.harm ? (st.harm.bull ? 'up' : 'down') : '' });
  read.push({ k: 'Elliott', v: st.ew ? st.ew.label : 'no valid impulse count', tone: st.ew ? (st.ew.bull ? 'up' : 'down') : '' });
  read.push({ k: 'Wyckoff', v: st.wy ? `trading range ${px(st.wy.lo)}–${px(st.wy.hi)}; spring below / upthrust above` : 'no tight range', tone: '' });
  const checks = E.explain(D, ch.s, j).map((x) => ({ role: x.role, label: x.label, L: x.L, S: x.S, agoL: x.agoL, agoS: x.agoS }));
  const sim = state.sim || {};
  let decision;
  const span = ch.tf * 60, nextClose = (Math.floor(D1.t[D1.n - 1] / span) + 1) * span + span - 60;
  if (sim.pos) {
    const p = sim.pos, last = D1.c[D1.n - 1], rNow = ((last - p.ep) * p.dir) / p.d;
    decision = `In a ${p.dir > 0 ? 'long' : 'short'} from ${px(p.ep)}: now ${sgnR(rNow)}, stop ${px(p.stop)}, target ${px(p.tp)}. Checking stop and target every minute.`;
  } else if (state.paused) decision = 'Paused by the supervisor: managing nothing, opening nothing.';
  else if (state.stale) decision = 'Market data is stale, so no new entries until fresh candles arrive.';
  else {
    const trig = checks.filter((x) => x.role === 'trigger'), filt = checks.filter((x) => x.role === 'filter');
    const want = (side) => { const fOk = filt.every((x) => x[side]); return { fOk, tOk: trig.some((x) => x[side]) }; };
    const l = want('L'), s = want('S');
    const parts = [];
    if (ch.s.dir !== 'short') parts.push(`long needs ${l.tOk ? 'nothing more' : trig.map((x) => x.label).join(' or ')}${l.fOk ? '' : ' (filters not aligned)'}`);
    if (ch.s.dir !== 'long') parts.push(`short needs ${s.tOk ? 'nothing more' : trig.map((x) => x.label).join(' or ')}${s.fOk ? '' : ' (filters not aligned)'}`);
    decision = `Flat. Next ${tfLabel(ch.tf)} close at ${hhmm(nextClose + 60)} UTC — ${parts.join('; ')}.`;
  }
  state.thinking = { t: D1.t[D1.n - 1], price: D1.c[D1.n - 1], tf: ch.tf, barT: D.t[j], checks, read, decision };
}

// ───────────────────────── re-think: optimise on the venue's own higher-timeframe history
const HTF = {};
async function loadHTF(feed, tf) {
  const p = path.join(DIR, `htf_${tf}.csv`);
  let bars = HTF[tf];
  if (!bars && fs.existsSync(p)) bars = fs.readFileSync(p, 'utf8').split('\n').filter((l) => /^\d/.test(l)).map((l) => { const q = l.split(',').map(Number); return { t: q[0], o: q[1], h: q[2], l: q[3], c: q[4], v: q[5] }; });
  bars = bars || [];
  const span = tf * 60, now = nowSec(), lastClosed = Math.floor(now / span) * span - span;
  const from = bars.length ? bars[bars.length - 1].t + span : now - (HTF_DAYS[tf] || 365) * 86400;
  if (from <= lastClosed) {
    const add = await fetchRange(feed, tf, from, lastClosed);
    for (const b of add) if (!bars.length || b.t > bars[bars.length - 1].t) bars.push(b);
  }
  const keepFrom = now - (HTF_DAYS[tf] || 365) * 86400;
  bars = bars.filter((b) => b.t >= keepFrom);
  HTF[tf] = bars;
  fs.writeFileSync(p, 't,o,h,l,c,v\n' + bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v].join(',')).join('\n') + '\n');
  return bars;
}
function scoreOn(D, s, a, b, objective, minTrades) {
  const tr = E.backtest(D, s, state.cfg, Math.min(300, Math.floor(D.n * 0.05)), a).metrics;
  const val = E.backtest(D, s, state.cfg, a, b).metrics, test = E.backtest(D, s, state.cfg, b, D.n).metrics;
  const fv = E.fitness(val, objective, Math.max(5, Math.round(minTrades / 3)), 0), ft = E.fitness(test, objective, Math.max(5, Math.round(minTrades / 3)), 0);
  return { train: tr, val, test, fv, ft, score: E.fitness(tr, objective, minTrades, E.complexityOf(s)) + fv, gate: E.gateCheck(val, test, minTrades) };
}
async function think(feed, why) {
  const t0 = Date.now(), t = nowSec(), objective = 'balanced';
  const rows = [], champ = state.champion;
  let champEval = null;
  for (const tf of THINK_TFS) {
    let bars;
    try { bars = await loadHTF(feed, tf); } catch (e) { error('history ' + tfLabel(tf), e); continue; }
    if (bars.length < 400) { error('history ' + tfLabel(tf), new Error('only ' + bars.length + ' bars')); continue; }
    const D = E.makeDataset(bars, { venue: state.venue });
    const minTrades = tf >= 240 ? 15 : 30;
    const seeds = [];
    if (champ && champ.tf === tf) seeds.push(champ.s);
    for (const r of state.leaderboard) if (r.tf === tf && seeds.length < 4) seeds.push(r.s);
    const O = E.createOptimizer(D, { pop: 40, gens: 18, splits: [0.6, 0.8], objective, minTrades, cfg: state.cfg, seedStrats: seeds, seed: (t % 100000) + tf, space: { triggers: Object.keys(E.RULES).filter((k) => E.RULES[k].role === 'trigger'), filters: Object.keys(E.RULES).filter((k) => E.RULES[k].role === 'filter'), dir: 'auto', minRR: 1, maxRR: 5 } });
    while (O.next()) {}
    for (const r of O.board(5)) rows.push({ tf, s: r.s, name: r.name, score: r.score, gate: r.gate, train: slim(r.train), val: slim(r.val), test: slim(r.test), bars: D.n, from: D.t[0], to: D.t[D.n - 1] });
    if (champ && champ.tf === tf) champEval = scoreOn(D, champ.s, O.splits.a, O.splits.b, objective, minTrades);
  }
  rows.sort((x, y) => (y.gate.pass - x.gate.pass) || y.score - x.score);
  state.leaderboard = rows.slice(0, 10);
  const best = rows.find((r) => r.gate.pass);
  let verdict;
  const heldFor = champ ? t - champ.since : Infinity;
  if (champEval) champ.lastCheck = { t, gate: champEval.gate.pass, val: slim(champEval.val), test: slim(champEval.test) };
  if (best && (!champ || champ.status !== 'gated' || (champEval && !champEval.gate.pass) || (champEval && best.score >= champEval.score + 0.1 && E.fitness(best.val, objective, 5, 0) >= champEval.fv && E.fitness(best.test, objective, 5, 0) >= champEval.ft && heldFor >= 6 * 3600))) {
    const prev = champ ? champ.name : 'none';
    const same = champ && E.stratKey(champ.s) + JSON.stringify(champ.s.exit) === E.stratKey(best.s) + JSON.stringify(best.s.exit) && champ.tf === best.tf;
    state.champion = { s: best.s, tf: best.tf, name: same ? champ.name : best.name + ' · ' + tfLabel(best.tf), status: 'gated', since: same ? champ.since : t, evidence: { train: best.train, val: best.val, test: best.test }, source: same ? champ.source : 're-think' };
    state.cfg.risk.riskPct = CFG.risk.riskPct;
    Xcache = null;
    verdict = same ? `Champion confirmed on ${state.venue} data and promoted to full risk.` : `Switched champion: ${prev} → ${state.champion.name}. Validation ${sgnR(best.val.expR)}/PF ${best.val.pf.toFixed(2)} (${best.val.n} tr), test ${sgnR(best.test.expR)}/PF ${best.test.pf.toFixed(2)} (${best.test.n} tr).`;
    event(t, 'think', verdict, { switched: true });
  } else if (!champ && rows.length) {
    const r = rows[0];
    state.champion = { s: r.s, tf: r.tf, name: r.name + ' · ' + tfLabel(r.tf), status: 'probation', since: t, evidence: { train: r.train, val: r.val, test: r.test }, source: 're-think' };
    state.cfg.risk.riskPct = 0.125; Xcache = null;
    verdict = `No strategy passed the out-of-sample gate. Paper-trading the best candidate on probation at half risk: ${state.champion.name}.`;
    event(t, 'think', verdict, { switched: true });
  } else {
    verdict = champEval
      ? `Kept champion (${champEval.gate.pass ? 'still passes' : 'FAILS'} the gate on fresh data: val ${sgnR(champEval.val.expR)}, test ${sgnR(champEval.test.expR)}). ${best ? 'Best challenger ' + best.name + ' did not beat it by enough.' : 'No challenger passed the gate.'}`
      : `Kept champion. ${best ? 'Best challenger: ' + best.name + '.' : 'No challenger passed the gate.'}`;
    event(t, 'think', verdict);
  }
  state.thinks.push({ t, why, ms: Date.now() - t0, verdict, top: state.leaderboard.slice(0, 3).map((r) => ({ tf: r.tf, name: r.name, gate: r.gate.pass, val: r.val, test: r.test })) });
  state.lastThinkT = t;
}
function slim(m) { return m ? { n: m.n, winRate: +m.winRate.toFixed(3), expR: +m.expR.toFixed(3), pf: +Math.min(m.pf, 99).toFixed(2), maxDD: +m.maxDD.toFixed(2), netPct: +m.netPct.toFixed(2) } : null; }

// ───────────────────────── stats + summary
function computeStats() {
  const tr = state.trades, n = tr.length, eq0 = state.cfg.equity;
  const sim = state.sim || {};
  let wins = 0, gw = 0, gl = 0, sR = 0;
  for (const x of tr) { sR += x.R; if (x.pnl > 0) { wins++; gw += x.pnl; } else gl -= x.pnl; }
  const last = D1 && D1.n ? D1.c[D1.n - 1] : null;
  const unreal = sim.pos && last ? sim.pos.dir * sim.pos.qty * (last - sim.pos.ep) : 0;
  const equity = (sim.cash ?? eq0) + unreal;
  const dayStart = Math.floor(nowSec() / 86400) * 86400;
  const today = tr.filter((x) => x.xt >= dayStart).reduce((a, x) => a + x.pnl, 0);
  state.stats = { equity: +equity.toFixed(2), netPct: +((equity / eq0 - 1) * 100).toFixed(3), trades: n, winRate: n ? +(wins / n).toFixed(3) : 0, pf: gl > 0 ? +(gw / gl).toFixed(2) : n ? 99 : 0, expR: n ? +(sR / n).toFixed(3) : 0, maxDD: +((sim.maxDD || 0) * 100).toFixed(2), todayPnl: +today.toFixed(2), price: last, lastCandle: D1 && D1.n ? D1.t[D1.n - 1] : null, unrealized: +unreal.toFixed(2), rejects: sim.rejects || {}, halted: sim.halted || null };
}
function summaryMd() {
  const s = state.stats || {}, ch = state.champion, p = state.sim && state.sim.pos;
  const L = [];
  L.push('# Paper bot — live status', '', `Updated ${state.updatedAt ? iso(state.updatedAt) : '—'} · feed: ${state.venue || '—'} · mode: **PAPER**`, '');
  L.push('| Equity | Net | Trades | Win rate | Profit factor | Avg R | Max DD |', '|---|---|---|---|---|---|---|');
  L.push(`| ${money(s.equity || 0)} | ${(s.netPct || 0).toFixed(2)}% | ${s.trades || 0} | ${((s.winRate || 0) * 100).toFixed(0)}% | ${s.pf ?? '—'} | ${s.expR ?? '—'} | ${s.maxDD ?? 0}% |`, '');
  L.push(`**Champion:** ${ch ? `${ch.name} (${ch.status}, since ${iso(ch.since)})` : 'none yet'}`, '');
  if (p) L.push(`**Open position:** ${p.dir > 0 ? 'LONG' : 'SHORT'} ${p.qty.toFixed(4)} BTC @ ${px(p.ep)} · stop ${px(p.stop)} · target ${px(p.tp)}`, '');
  if (state.thinking) L.push(`**Thinking:** ${state.thinking.decision}`, '');
  L.push('## Recent events', '');
  for (const e of state.events.slice(-15).reverse()) L.push(`- \`${iso(e.t)}\` ${e.text}`);
  if (state.errors.length) { L.push('', '## Recent errors', ''); for (const e of state.errors.slice(-5).reverse()) L.push(`- \`${iso(e.t)}\` ${e.msg}`); }
  return L.join('\n') + '\n';
}

// ───────────────────────── git persistence (state branch)
function git(args) { return cp.execFileSync('git', ['-C', DIR, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function pushState(msg) {
  if (!GIT) return;
  try {
    git(['add', '-A']);
    try { git(['commit', '-q', '-m', msg]); } catch (e) { /* nothing to commit */ }
    try { git(['pull', '-q', '--rebase', '-X', 'theirs', 'origin', BRANCH]); } catch (e) { /* branch may not exist yet */ }
    git(['push', '-q', 'origin', 'HEAD:' + BRANCH]);
  } catch (e) { error('git push', e); }
}
function readControl() {
  const p = path.join(DIR, 'control.json');
  if (!fs.existsSync(p)) return;
  let c;
  try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { error('control.json', e); return; }
  state.paused = !!c.pause;
  if (!c.id || c.id === state.controlApplied) return;
  state.controlApplied = c.id;
  const t = nowSec();
  if (c.forceChampion && c.forceChampion.strategy) {
    state.champion = { s: c.forceChampion.strategy, tf: c.forceChampion.tf, name: c.forceChampion.name || E.describe(c.forceChampion.strategy), status: c.forceChampion.status || 'gated', since: t, evidence: c.forceChampion.evidence || null, source: 'supervisor' };
    Xcache = null;
    event(t, 'super', `Supervisor set the champion: ${state.champion.name}${c.note ? ' — ' + c.note : ''}`);
  }
  if (c.riskPct) { state.cfg.risk.riskPct = Math.min(+c.riskPct, state.cfg.gov.maxRisk); event(t, 'super', `Supervisor set risk per trade to ${state.cfg.risk.riskPct}%`); }
  if (c.thinkNow) state.thinkNow = true;
  if (c.note && !c.forceChampion) event(t, 'super', 'Supervisor note: ' + c.note);
}

// ───────────────────────── main loop
async function pickFeed() {
  if (SIM) { const f = simFeed(); state.feedKey = 'sim'; state.venue = f.venue; return f; }
  const order = state.feedKey ? [state.feedKey] : VENUES;
  const errs = [];
  for (const k of order) {
    try { const b = await FEEDS[k].page(1, null, 5); if (b.length) { if (!state.feedKey) { state.feedKey = k; state.venue = FEEDS[k].venue; } return FEEDS[k]; } errs.push(k + ': empty'); }
    catch (e) { errs.push(k + ': ' + e.message); }
  }
  throw new Error('no market data feed reachable — ' + errs.join(' | '));
}
async function pullCandles(feed) {
  const now = nowSec(), lastClosed = Math.floor(now / 60) * 60 - 60;
  const have = C.t.length ? C.t[C.t.length - 1] : 0;
  if (have >= lastClosed) return 0;
  let bars;
  if (!have || lastClosed - have > 60 * (feed.max - 5)) bars = await fetchRange(feed, 1, have ? have + 60 : now - BOOT_DAYS * 86400, lastClosed);
  else bars = await feed.page(1, null, Math.min(feed.max, Math.ceil((lastClosed - have) / 60) + 3));
  let added = 0;
  for (const b of bars) if (b.t > have && pushBar(b)) { added++; dirtyDays.add(iso(b.t).slice(0, 10)); }
  if (added && have) {
    // record gaps rather than invent candles
    const idx = C.t.length - added;
    if (C.t[idx] - have > 60) { const g = { after: have, next: C.t[idx], minutes: (C.t[idx] - have) / 60 - 1 }; state.gaps.push(g); event(now, 'data', `Data gap: ${g.minutes} minute(s) missing after ${iso(have)} — not filled with invented candles`); }
  }
  return added;
}
async function run() {
  loadState();
  loadCandles();
  if (SIM) simNow = (C.t.length ? C.t[C.t.length - 1] + 60 : 1760000000 - 40000 * 60) + 5;
  const started = nowSec(), runId = process.env.GITHUB_RUN_ID || 'local-' + started;
  state.runs.push({ id: runId, start: started }); state.runs = state.runs.slice(-50);
  let feed;
  try { feed = await pickFeed(); } catch (e) { error('feed', e); saveState(); pushState('paper: no feed'); process.exitCode = 1; return; }
  event(nowSec(), 'start', `Bot started (run ${runId}) on ${state.venue}. Checking every minute.`);
  if (!state.champion) {
    state.champion = loadSeedChampion();
    if (state.champion) {
      state.cfg.risk.riskPct = state.champion.status === 'gated' ? CFG.risk.riskPct : CFG.risk.riskPct / 2;
      event(nowSec(), 'think', `Starting champion from research: ${state.champion.name} (${state.champion.status}${state.champion.status === 'gated' ? '' : ', half risk until it passes the gate on this venue'})`);
    }
  }
  let stop = false;
  const shutdown = () => { if (stop) return; stop = true; console.log('shutdown requested'); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  let lastPush = 0, tick = 0;
  while (!stop && nowSec() - started < RUN_MIN * 60) {
    tick++;
    try {
      const added = await pullCandles(feed);
      const newest = C.t.length ? C.t[C.t.length - 1] : 0;
      state.stale = nowSec() - newest > 5 * 60;
      if (added) { rebuild(); readControl(); processNew(!state.paused && !state.stale); }
      else readControl();
      const due = state.thinkNow || !state.champion || nowSec() - (state.lastThinkT || 0) >= THINK_EVERY * 60;
      if (due && D1) { state.thinkNow = false; try { await think(feed, state.champion ? 'scheduled' : 'no champion'); } catch (e) { error('think', e); state.lastThinkT = nowSec(); } }
      if (D1) { snapshot(); computeStats(); }
      saveCandles();
      saveState();
      if (nowSec() - lastPush >= PUSH_EVERY * 60) { lastPush = nowSec(); pushState(`paper ${iso(nowSec())} eq ${state.stats ? state.stats.equity : '-'} trades ${state.trades.length}`); }
    } catch (e) { error('tick', e); }
    if (SIM) { simNow += 60; continue; }
    const next = (Math.floor(Date.now() / 60000) + 1) * 60000 + 4000; // 4s after each minute closes
    while (!stop && Date.now() < next) await sleep(Math.min(1000, next - Date.now()));
  }
  event(nowSec(), 'stop', `Run ${runId} ending after ${Math.round((nowSec() - started) / 60)} minutes; the next run continues from this state.`);
  computeStats(); saveCandles(); saveState();
  pushState(`paper ${iso(nowSec())} end of run`);
}
function report() {
  loadState();
  const s = state.stats || {}, ch = state.champion;
  console.log(summaryMd());
  if (ch) console.log('champion strategy:', JSON.stringify(ch.s));
  console.log('last thinks:'); for (const t of state.thinks.slice(-5)) console.log(' ', iso(t.t), t.verdict);
  console.log('stats:', JSON.stringify(s));
}

if (CMD === 'run') run().catch((e) => { console.error(e); process.exitCode = 1; });
else if (CMD === 'report') report();
else { console.error('usage: paperbot.js run|report --state-dir DIR'); process.exitCode = 2; }
