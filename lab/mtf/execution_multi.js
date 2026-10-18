/* Execution study across the whole universe on 5-minute candles.
 *   node lab/mtf/execution_multi.js <research-data dir> <out dir>
 * Takes every rebalance the hourly portfolio engine made in the 5m-data window (signal at an hour close,
 * reference price P = that close) and replays execution policies on the following 5m candles.
 * Cost per order = side × (average fill / P − 1) in bps, plus fees. Negative = better than P.
 * Limit orders fill only if a later candle trades THROUGH the price by one tick-equivalent (0.5 bps).
 * Policies are chosen on the first half of the window and checked on the second half.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const M = require('./mtf.js');

const FEE = { taker: 6, maker: 2, slip: 2 }, THRU = 0.5; // bps
function load5m(dir, coin) {
  const lines = zlib.gunzipSync(fs.readFileSync(`${dir}/${coin}/5m.csv.gz`)).toString('utf8').split('\n');
  const hdr = lines[0].split(','), ix = (k) => hdr.indexOf(k);
  const n = lines.length - 1, D = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  let k = 0;
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const r = lines[i].split(','); D.t[k] = +r[ix('t')] / 1000; D.o[k] = +r[ix('o')]; D.h[k] = +r[ix('h')]; D.l[k] = +r[ix('l')]; D.c[k] = +r[ix('c')]; k++; }
  for (const key of ['t', 'o', 'h', 'l', 'c']) D[key] = D[key].subarray(0, k);
  D.n = k;
  // ATR(14) on 5m, causal
  D.atr = new Float64Array(k); let a = 0;
  for (let i = 1; i < k; i++) { const tr = Math.max(D.h[i] - D.l[i], Math.abs(D.h[i] - D.c[i - 1]), Math.abs(D.l[i] - D.c[i - 1])); a = i <= 14 ? a + tr / 14 : (a * 13 + tr) / 14; D.atr[i] = a; }
  return D;
}
const at = (D, t) => { let lo = 0, hi = D.n; while (lo < hi) { const m = (lo + hi) >> 1; if (D.t[m] < t) lo = m + 1; else hi = m; } return lo; };

// returns cost in bps (fees included) for one order
function exec(D, i0, side, P, pol) {
  const bps = (px) => side * (px / P - 1) * 1e4;
  const mkt = (i) => (i < D.n ? bps(D.o[i] * (1 + side * FEE.slip / 1e4)) + FEE.taker : NaN);
  const through = (i, L) => (side > 0 ? D.l[i] <= L * (1 - THRU / 1e4) : D.h[i] >= L * (1 + THRU / 1e4));
  const K = pol.K || 0; // in 5m bars
  switch (pol.kind) {
    case 'market': return mkt(i0);
    case 'twap': { let s = 0; for (let k = 0; k < K; k++) s += mkt(i0 + k); return s / K; }
    case 'limit': { // post at P − x bps (x may be 0) for K bars, then market
      const L = P * (1 - side * (pol.x || 0) / 1e4);
      for (let k = 0; k < K && i0 + k < D.n; k++) if (through(i0 + k, L)) return bps(L) + FEE.maker;
      return mkt(i0 + K);
    }
    case 'atr': { // post at P − m × ATR(5m) for K bars, then market
      const L = P - side * pol.m * D.atr[i0 - 1];
      for (let k = 0; k < K && i0 + k < D.n; k++) if (through(i0 + k, L)) return bps(L) + FEE.maker;
      return mkt(i0 + K);
    }
    case 'chase': { // post at the best price each bar (previous close), re-posting each bar; market after K
      for (let k = 0; k < K && i0 + k < D.n; k++) { const L = k === 0 ? P : D.c[i0 + k - 1]; if (through(i0 + k, L)) return bps(L) + FEE.maker; }
      return mkt(i0 + K);
    }
    case 'split': { // half at market now, half as an ATR limit for K bars
      const a = mkt(i0), L = P - side * pol.m * D.atr[i0 - 1];
      let b = mkt(i0 + K);
      for (let k = 0; k < K && i0 + k < D.n; k++) if (through(i0 + k, L)) { b = bps(L) + FEE.maker; break; }
      return (a + b) / 2;
    }
  }
  throw new Error('policy ' + pol.kind);
}

const POLICIES = [
  { name: 'Market now', kind: 'market' },
  { name: 'Limit at signal price, 15 min', kind: 'limit', K: 3 },
  { name: 'Limit at signal price, 1 h', kind: 'limit', K: 12 },
  { name: 'Limit 10 bps better, 1 h', kind: 'limit', K: 12, x: 10 },
  { name: 'Limit 20 bps better, 2 h', kind: 'limit', K: 24, x: 20 },
  { name: 'Limit 40 bps better, 4 h', kind: 'limit', K: 48, x: 40 },
  { name: 'Limit 0.5 ATR(5m) better, 1 h', kind: 'atr', K: 12, m: 0.5 },
  { name: 'Limit 1 ATR(5m) better, 2 h', kind: 'atr', K: 24, m: 1 },
  { name: 'Limit 2 ATR(5m) better, 4 h', kind: 'atr', K: 48, m: 2 },
  { name: 'Chase best price, 30 min', kind: 'chase', K: 6 },
  { name: 'TWAP 30 min', kind: 'twap', K: 6 },
  { name: 'Half market, half 1 ATR limit, 2 h', kind: 'split', K: 24, m: 1 },
];

function main() {
  const [dir, out] = process.argv.slice(2);
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const coins = man.coins.filter((c) => c.status === 'ok').map((c) => c.coin);
  const grid = M.align(coins.map((c) => M.loadCoin(dir, c)));
  const five = coins.map((c) => load5m(dir, c));
  const t0 = Math.max(...five.map((d) => d.t[0])) > 0 ? Math.min(...five.map((d) => d.t[0])) : 0;
  const tEnd = Math.min(...five.map((d) => d.t[d.n - 1])) - 6 * 3600;
  const sim = M.simulate(grid, { start: t0 + 86400 * 5, end: tEnd, log: true });
  const mid = t0 + (tEnd - t0) / 2;
  const res = POLICIES.map((p) => ({ policy: p.name, first: { w: 0, c: 0, n: 0 }, second: { w: 0, c: 0, n: 0 }, perCoin: {} }));
  let used = 0;
  for (const [t, j, gap] of sim.tradeLog) {
    const D = five[j], tc = t + 3600; // hour bar starting at t closes at t+3600
    const i0 = at(D, tc);
    if (i0 < 15 || i0 + 50 >= D.n || Math.abs(D.t[i0] - tc) > 1) continue;
    const P = D.c[i0 - 1], side = Math.sign(gap), w = Math.abs(gap);
    used++;
    POLICIES.forEach((p, k) => {
      const c = exec(D, i0, side, P, p); if (!isFinite(c)) return;
      const half = t < mid ? res[k].first : res[k].second;
      half.w += w; half.c += c * w; half.n++;
      const pc = res[k].perCoin[coins[j]] || (res[k].perCoin[coins[j]] = { w: 0, c: 0, n: 0 }); pc.w += w; pc.c += c * w; pc.n++;
    });
  }
  const rows = res.map((r) => ({ policy: r.policy, firstHalfBps: +(r.first.c / r.first.w).toFixed(2), secondHalfBps: +(r.second.c / r.second.w).toFixed(2), orders: r.first.n + r.second.n, perCoin: Object.fromEntries(Object.entries(r.perCoin).map(([k, v]) => [k, +(v.c / v.w).toFixed(1)])) }));
  rows.forEach((r) => console.log(r.policy.padEnd(38), 'first half', String(r.firstHalfBps).padStart(7), 'bps | second half', String(r.secondHalfBps).padStart(7), 'bps | orders', r.orders));
  // best per coin chosen on the first half is reported in the json for the live bot
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'execution.json'), JSON.stringify({ generated: new Date().toISOString(), window: [new Date(t0 * 1000).toISOString(), new Date(tEnd * 1000).toISOString()], split: new Date(mid * 1000).toISOString(), ordersUsed: used, fees: FEE, rows }, null, 1));
}
if (require.main === module) main();
module.exports = { exec, POLICIES, load5m };
