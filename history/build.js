#!/usr/bin/env node
/* 5-year history for the strategy × timeframe sweep, from Binance's public archive (data.binance.vision).
 * Runs on GitHub runners (the archive is not reachable from Claude's workspace).
 *
 *   node history/build.js plan <outDir> [--from 2021-10] [--to 2026-09] [--parallel 16] [--symbols BTCUSDT,ETHUSDT]
 *       every USDT perpetual in the archive → daily quote volume → the point-in-time universe (the live rules:
 *       7-day average ≥ $20M to enter, < $14M to leave, at most 80 coins) → universe.json + plan.json
 *   node history/build.js coins <outDir> --plan plan.json [--shard 0/8] [--parallel 8] [--no-oi] [--have names.txt]
 *       per coin in the shard, for every month from --warm-months (7) before its first day in the universe to its last:
 *       <coin>/1m-YYYY-MM.csv.gz, <coin>/oi-YYYY-MM.csv.gz, <coin>/funding.csv.gz (the swarm-data format) and
 *       <outDir>/manifest-<shard>.json
 *
 * Coins whose trading history ended (LUNA, FTT, …) are kept: leaving them out would test survivors only.
 * BloFin's listing history is unknown, so the universe is Binance's. Missing archive files stay missing.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { getBuffer, unzipFirst, sleep } = require('../swarm/src/core/net');

const BASE = 'https://data.binance.vision/data/futures/um';
const LIST = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const DAY = 86400000;
const argv = process.argv.slice(2), A = {}, POS = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) A[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else POS.push(argv[i]); }
const [MODE, OUTARG] = POS;
const OUT = path.resolve(OUTARG || 'history-data');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'swarm', 'config', 'swarm.json'), 'utf8'));
const U = cfg.universe;
const EXCLUDE = new Set(U.exclude);
const ym = (t) => new Date(t).toISOString().slice(0, 7), ymd = (t) => new Date(t).toISOString().slice(0, 10);
function monthsBetween(a, b) { const out = []; let [y, m] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return out; }
const addMonths = (s, k) => { const [y, m] = s.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return ym(d.getTime()); };

async function retry(fn, tries = 4) { for (let a = 0; ; a++) { try { return await fn(); } catch (e) { if (a >= tries - 1) throw e; await sleep(1500 * (a + 1)); } } }
async function fetchZip(url, check = true) {
  return retry(async () => {
    const body = await getBuffer(url, { timeoutMs: 120000 });
    if (!body) return null;
    if (check) {
      const chk = await getBuffer(url + '.CHECKSUM', { timeoutMs: 30000 }).catch(() => null);
      if (chk && chk.toString().split(/\s+/)[0].toLowerCase() !== crypto.createHash('sha256').update(body).digest('hex')) throw new Error('checksum mismatch ' + url);
    }
    return unzipFirst(body).toString('utf8');
  });
}
const rows = (csv) => csv.split('\n').filter((l) => /^\d/.test(l)).map((l) => l.split(','));
async function pool(items, n, fn) { const q = items.slice(); let done = 0; await Promise.all(Array.from({ length: n }, async () => { for (let x; (x = q.shift()) !== undefined; ) { await fn(x); if (++done % 200 === 0) console.log(`  ${done}/${items.length}`); } })); }

// S3 listing: sub-folders (delimiter) or keys under a prefix, all pages
async function list(prefix, folders) {
  const out = []; let marker = '';
  for (;;) {
    const url = `${LIST}?${folders ? 'delimiter=/&' : ''}prefix=${encodeURIComponent(prefix)}${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`;
    const xml = (await retry(() => getBuffer(url, { timeoutMs: 60000 }))).toString('utf8');
    const re = folders ? /<Prefix>([^<]+)<\/Prefix>/g : /<Key>([^<]+)<\/Key>/g;
    const got = [...xml.matchAll(re)].map((m) => m[1]).filter((x) => x !== prefix);
    out.push(...got);
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !got.length) break;
    const nm = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/);
    marker = nm ? nm[1] : got[got.length - 1];
  }
  return out;
}

// BloFin-style coin name and price scale for a Binance symbol
function coinOf(sym) {
  if (!sym.endsWith('USDT') || sym.includes('_')) return null;
  let base = sym.slice(0, -4), scale = 1;
  const m = base.match(/^(1000000|1000|1M)([A-Z0-9]+)$/);
  if (m && !/^\d+$/.test(m[2])) { base = m[2]; scale = m[1] === '1M' || m[1] === '1000000' ? 1e6 : 1000; }
  if (EXCLUDE.has(base) || /DOM$|^DEFI$|^FOOTBALL$|^BLUEBIRD$/.test(base)) return null;
  return { coin: base, scale };
}

const WARM = +(A['warm-months'] || 7);
const SAFE = /^[A-Z0-9][A-Z0-9_]*$/; // coin names a release asset can carry (two meme coins have Chinese names: left out) // history before a coin's first day in the universe: a daily 200-bar average needs ~7 months

async function plan() {
  const from = A.from || '2021-10', to = A.to || '2026-09', months = monthsBetween(addMonths(from, -1), to);
  fs.mkdirSync(OUT, { recursive: true });
  let symbols = A.symbols ? A.symbols.split(',') : (await list('data/futures/um/monthly/klines/', true)).map((p) => p.split('/').slice(-2, -1)[0]);
  const meta = {};
  const skipped = [];
  for (const s of symbols) { const c = coinOf(s); if (c && SAFE.test(c.coin)) meta[s] = c; else if (c) skipped.push(s); }
  if (skipped.length) console.log(`left out (names a release asset cannot carry): ${skipped.join(' ')}`);
  symbols = Object.keys(meta);
  console.log(`${symbols.length} USDT perpetual symbols in the archive (after exclusions)`);
  // daily quote volume from the monthly 1d klines
  const vol = {}; // symbol → {day: quoteVolume}
  await pool(symbols, +(A.parallel || 16), async (s) => {
    const keys = new Set(await list(`data/futures/um/monthly/klines/${s}/1d/`, false).catch(() => []));
    for (const m of months) {
      const key = `data/futures/um/monthly/klines/${s}/1d/${s}-1d-${m}.zip`;
      if (!keys.has(key)) continue;
      const csv = await fetchZip(`https://data.binance.vision/${key}`, false).catch(() => null);
      if (!csv) continue;
      for (const r of rows(csv)) (vol[s] = vol[s] || {})[ymd(+r[0])] = +r[7];
    }
  });
  console.log(`daily volumes: ${Object.keys(vol).length} symbols, ${Object.values(vol).reduce((a, v) => a + Object.keys(v).length, 0)} days`);
  // if two symbols map to one coin (a relisting), they stay separate unless they never overlap
  const byCoin = {};
  for (const s of Object.keys(vol)) {
    let key = meta[s].coin;
    if (byCoin[key] && byCoin[key].symbol !== s) key = `${key}_${s}`;
    byCoin[key] = { symbol: s, scale: meta[s].scale, vol: vol[s] };
  }
  // the universe, day by day: 7-day average quote volume, enter ≥ enterVolQ, leave < exitVolQ, at most maxCoins
  const start = Date.parse(from + '-01T00:00:00Z'), end = Date.parse(addMonths(to, 1) + '-01T00:00:00Z');
  const members = new Set(), days = {}, spans = {};
  for (let t = start; t < end; t += DAY) {
    const cand = [];
    for (const [coin, x] of Object.entries(byCoin)) {
      let sum = 0, n = 0;
      for (let k = 1; k <= U.days; k++) { const v = x.vol[ymd(t - k * DAY)]; if (v != null) { sum += v; n++; } }
      if (n < 3) continue;
      const avg = sum / U.days; // days without trading count as zero
      if (avg >= U.enterVolQ || (members.has(coin) && avg >= U.exitVolQ)) cand.push([coin, avg]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    members.clear(); for (const [c] of cand.slice(0, U.maxCoins)) members.add(c);
    const d = ymd(t); days[d] = [...members].sort();
    for (const c of members) { const s = (spans[c] = spans[c] || []); const last = s[s.length - 1]; if (last && Date.parse(last[1] + 'T00:00:00Z') + DAY === t) last[1] = d; else s.push([d, d]); }
  }
  const coins = {};
  for (const [c, s] of Object.entries(spans)) {
    const first = s[0][0].slice(0, 7), last = s[s.length - 1][1].slice(0, 7);
    coins[c] = { symbol: byCoin[c].symbol, scale: byCoin[c].scale, spans: s, months: monthsBetween(addMonths(first, -WARM), last), memberDays: s.reduce((x, [a, b]) => x + (Date.parse(b) - Date.parse(a)) / DAY + 1, 0) };
  }
  const sizes = Object.values(days).map((x) => x.length);
  fs.writeFileSync(path.join(OUT, 'universe.json'), JSON.stringify({ from, to, rules: { enterVolQ: U.enterVolQ, exitVolQ: U.exitVolQ, days: U.days, maxCoins: U.maxCoins }, coins: Object.fromEntries(Object.entries(coins).map(([c, x]) => [c, x.spans])), size: { min: Math.min(...sizes), max: Math.max(...sizes), avg: +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1) } }, null, 1));
  // shards balanced by coin-months
  const list2 = Object.entries(coins).sort((a, b) => b[1].months.length - a[1].months.length);
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify({ from, to, coins: Object.fromEntries(list2) }, null, 1));
  const cm = list2.reduce((x, [, v]) => x + v.months.length, 0);
  console.log(`universe: ${Object.keys(coins).length} coins ever in it; ${sizes.length} days, ${Math.min(...sizes)}–${Math.max(...sizes)} coins a day (avg ${(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1)}); ${cm} coin-months to download`);
}

async function coins() {
  const P = JSON.parse(fs.readFileSync(path.resolve(A.plan), 'utf8'));
  // --have <file>: names already stored (one per line, "<coin>.tar") — build only the rest (a rerun resumes)
  const have = new Set(A.have && fs.existsSync(A.have) ? fs.readFileSync(A.have, 'utf8').split('\n').map((x) => x.trim().replace(/\.tar$/, '')).filter(Boolean) : []);
  for (const c of Object.keys(P.coins)) if (have.has(c) || !SAFE.test(c)) delete P.coins[c];
  const [si, sn] = String(A.shard || '0/1').split('/').map(Number);
  // greedy balance by months: biggest first, each to the lightest shard
  const loads = Array.from({ length: sn }, () => ({ n: 0, coins: [] }));
  for (const [c, x] of Object.entries(P.coins).sort((a, b) => b[1].months.length - a[1].months.length)) { const l = loads.reduce((a, b) => (b.n < a.n ? b : a)); l.n += x.months.length; l.coins.push(c); }
  const mine = loads[si].coins;
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { shard: `${si}/${sn}`, coins: {} };
  console.log(`shard ${si}/${sn}: ${mine.length} coins, ${loads[si].n} coin-months`);
  const fmt = (a) => a.map((x) => (typeof x === 'number' && !Number.isInteger(x) ? +x.toPrecision(10) : x)).join(',');
  await pool(mine, +(A.parallel || 8), async (coin) => {
    const t0 = Date.now(), { symbol, scale, months } = P.coins[coin], dir = path.join(OUT, coin), info = { symbol, scale, rows1m: 0, rowsOI: 0, missing: [], months: [] };
    fs.mkdirSync(dir, { recursive: true });
    const write = (file, header, list) => fs.writeFileSync(path.join(dir, file), zlib.gzipSync(header + '\n' + list.map(fmt).join('\n') + '\n', { level: 9 }));
    try {
      for (const m of months) {
        const csv = await fetchZip(`${BASE}/monthly/klines/${symbol}/1m/${symbol}-1m-${m}.zip`);
        if (!csv) { info.missing.push('1m ' + m); continue; }
        const list = rows(csv).map((r) => [+r[0], +r[1] / scale, +r[2] / scale, +r[3] / scale, +r[4] / scale, +r[5] * scale, +r[7], +r[8], +r[10]]).sort((a, b) => a[0] - b[0]);
        write(`1m-${m}.csv.gz`, 't,o,h,l,c,v,q,n,bq', list); info.rows1m += list.length; info.months.push(m);
        if (!info.first) info.first = list[0][0]; info.last = list[list.length - 1][0];
        if (A['no-oi']) continue;
        const oi = [];
        const [y, mo] = m.split('-').map(Number);
        for (let t = Date.UTC(y, mo - 1, 1); t < Date.UTC(y, mo, 1); t += DAY) {
          const d = ymd(t), c2 = await fetchZip(`${BASE}/daily/metrics/${symbol}/${symbol}-metrics-${d}.zip`, false).catch(() => null);
          if (!c2) continue;
          for (const r of rows(c2.replace(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/gm, (x) => Date.parse(x.replace(' ', 'T') + 'Z')))) oi.push([+r[0], +r[2] * scale, +r[3], +r[5], +r[6], +r[7]]);
        }
        if (oi.length) { oi.sort((a, b) => a[0] - b[0]); write(`oi-${m}.csv.gz`, 't,oi,oiQ,lsTop,lsAll,takerLS', oi); info.rowsOI += oi.length; }
      }
      const fund = [];
      for (const m of months) { const csv = await fetchZip(`${BASE}/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${m}.zip`, false).catch(() => null); if (csv) for (const r of rows(csv)) fund.push([+r[0], +r[2]]); }
      fund.sort((a, b) => a[0] - b[0]); write('funding.csv.gz', 't,rate', fund);
      info.status = info.rows1m ? 'ok' : 'empty';
    } catch (e) { info.status = 'error'; info.error = e.message; }
    info.seconds = Math.round((Date.now() - t0) / 1000);
    manifest.coins[coin] = info;
    console.log(`${coin} (${symbol}): ${info.months.length} months, ${info.rows1m} bars, ${info.rowsOI} OI rows, ${info.missing.length} missing, ${info.status}, ${info.seconds}s`);
  });
  fs.writeFileSync(path.join(OUT, `manifest-${si}.json`), JSON.stringify(manifest, null, 1));
  const bad = Object.values(manifest.coins).filter((x) => x.status === 'error').length;
  console.log(`shard done: ${mine.length - bad}/${mine.length} coins`);
  if (bad > mine.length / 4) process.exit(1);
}

(MODE === 'plan' ? plan() : MODE === 'coins' ? coins() : Promise.reject(new Error('mode: plan | coins'))).catch((e) => { console.error(e); process.exit(1); });
