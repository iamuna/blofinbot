/* Execution study: how should the 1m → 30m layer work an order once a higher timeframe changes a target?
 *   node lab/mtf/execution_study.js <btc 1h csv> <btc 1m binary (t,o,h,l,c,v,n,tbv as Float64)> [out.json]
 * Takes every rebalance the hourly engine made on BTC (signal at an hour close, price P) and replays
 * different ways of executing it on the following 1-minute candles. Cost = signed distance of the
 * average fill from P, plus fees. Positive = cost, negative = improvement.
 *   market   : taker at the next minute's open + slippage
 *   limitK   : post a limit at P for K minutes, else market at minute K
 *   offsetK  : post a limit x bps better than P for K minutes, else market at minute K
 *   twapK    : K equal market slices, one per minute
 *   dipK     : wait up to K minutes for a 3-minute pullback against the trade, then post at that minute's
 *              close; market at minute K if it never comes
 */
'use strict';
const fs = require('fs');
const M = require('./mtf.js');

const TAKER = 6, MAKER = 2, SLIP = 2, TICK_BPS = 0.02; // bps
function load1m(path) {
  const buf = fs.readFileSync(path), f = new Float64Array(buf.buffer, buf.byteOffset, buf.length / 8), n = f.length / 8;
  const D = { n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  for (let i = 0; i < n; i++) { D.t[i] = f[i * 8]; D.o[i] = f[i * 8 + 1]; D.h[i] = f[i * 8 + 2]; D.l[i] = f[i * 8 + 3]; D.c[i] = f[i * 8 + 4]; }
  return D;
}
function idx(D, t) { let lo = 0, hi = D.n; while (lo < hi) { const m = (lo + hi) >> 1; if (D.t[m] < t) lo = m + 1; else hi = m; } return lo; }

function execute(D, i0, side, P, policy) {
  // i0 = first 1m candle after the signal close; returns cost in bps (fees included)
  const bps = (px) => side * (px / P - 1) * 1e4;
  const market = (i) => bps(D.o[i] * (1 + side * SLIP / 1e4)) + TAKER;
  const { kind, K = 0, x = 0 } = policy;
  if (kind === 'market') return market(i0);
  if (kind === 'twap') { let s = 0; for (let k = 0; k < K; k++) s += market(i0 + k); return s / K; }
  if (kind === 'limit' || kind === 'offset') {
    const L = P * (1 - side * x / 1e4);
    for (let k = 0; k < K; k++) { const i = i0 + k; const through = side > 0 ? D.l[i] <= L * (1 - TICK_BPS / 1e4) : D.h[i] >= L * (1 + TICK_BPS / 1e4); if (through) return bps(L) + MAKER; }
    return market(i0 + K);
  }
  if (kind === 'dip') {
    for (let k = 3; k < K; k++) {
      const i = i0 + k, move = side * (D.c[i] / D.c[i - 3] - 1) * 1e4;
      if (move < -x) { // price moved against the trade direction over 3 minutes: post at this close
        const L = D.c[i];
        for (let q = 1; q <= Math.max(1, K - k); q++) { const j = i + q; const through = side > 0 ? D.l[j] <= L * (1 - TICK_BPS / 1e4) : D.h[j] >= L * (1 + TICK_BPS / 1e4); if (through) return bps(L) + MAKER; }
        return market(i0 + K);
      }
    }
    return market(i0 + K);
  }
  throw new Error('unknown policy');
}

function main() {
  const [h1, m1, out] = process.argv.slice(2);
  const D = load1m(m1);
  const grid = M.align([M.loadCsvPlain(h1, 'BTC')]);
  const from = D.t[0] + 86400 * 10, to = D.t[D.n - 1] - 3600;
  const sim = M.simulate(grid, { start: from, end: to, log: true, xsec: 0, fundingCrowd: 0 });
  const orders = sim.tradeLog.map(([t, j, gap]) => ({ t: t + 3600, side: Math.sign(gap), size: Math.abs(gap) })); // hour bar t closes at t+3600
  const policies = [
    { name: 'market now', kind: 'market' },
    { name: 'limit at signal price, 5m', kind: 'limit', K: 5 }, { name: 'limit at signal price, 15m', kind: 'limit', K: 15 }, { name: 'limit at signal price, 30m', kind: 'limit', K: 30 },
    { name: 'limit 5 bps better, 15m', kind: 'offset', K: 15, x: 5 }, { name: 'limit 10 bps better, 30m', kind: 'offset', K: 30, x: 10 }, { name: 'limit 20 bps better, 60m', kind: 'offset', K: 60, x: 20 },
    { name: 'TWAP 5 minutes', kind: 'twap', K: 5 }, { name: 'TWAP 15 minutes', kind: 'twap', K: 15 },
    { name: 'wait for 3m dip >5 bps, 15m', kind: 'dip', K: 15, x: 5 }, { name: 'wait for 3m dip >10 bps, 30m', kind: 'dip', K: 30, x: 10 },
  ];
  const res = [];
  for (const p of policies) {
    const costs = [];
    for (const o of orders) {
      const i0 = idx(D, o.t); if (i0 + 70 >= D.n || Math.abs(D.t[i0] - o.t) > 120) continue;
      const P = D.o[i0]; // the price at the signal close
      costs.push(execute(D, i0, o.side, P, p));
    }
    costs.sort((a, b) => a - b);
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length, wsize = 0;
    const row = { policy: p.name, orders: costs.length, meanCostBps: +mean.toFixed(2), medianBps: +costs[Math.floor(costs.length / 2)].toFixed(2), p90Bps: +costs[Math.floor(costs.length * 0.9)].toFixed(2), worstBps: +costs[costs.length - 1].toFixed(1) };
    res.push(row);
    console.log(row.policy.padEnd(32), `n=${row.orders} mean ${row.meanCostBps} bps  median ${row.medianBps}  p90 ${row.p90Bps}  worst ${row.worstBps}`);
  }
  if (out) fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), orders: orders.length, fees: { TAKER, MAKER, SLIP }, results: res }, null, 1));
}
if (require.main === module) main();
module.exports = { execute };
