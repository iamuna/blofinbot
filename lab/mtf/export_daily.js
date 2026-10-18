/* Export a daily coin panel for the ML layer experiment.
 *   node lab/mtf/export_daily.js <research-data dir> <out.csv>
 * One row per coin per UTC day, all values known at that day's close (00:00 UTC):
 *   votes per timeframe (average Donchian state over its lookbacks, shorts only 1d+ as in V3),
 *   annualised vol, cross-coin momentum rank, past returns, 3-day funding (annualised), BTC's own
 *   strategic vote, and the target: next day's return (close → next close).
 */
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./mtf.js');
const [dir, out] = process.argv.slice(2);
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const coins = man.coins.filter((c) => c.status === 'ok' && c['1h'] && c['1h'].rows > 24 * 200).map((c) => c.coin);
const grid = M.align(coins.map((c) => M.loadCoin(dir, c)));
const n = grid.n, N = coins.length, STRAT = ['1d', '3d', '1w', '1M', '3M'];
const vols = grid.coins.map((g) => M.dailyVol(grid, g, 90));
const xs = M.crossMomentum(grid, vols);
const tfs = Object.keys(M.TF);
const votes = grid.coins.map((g) => {
  const o = {};
  for (const tf of tfs) {
    const bars = M.resample(grid, g, tf), acc = new Float64Array(n); let k = 0;
    for (const L of M.LOOKBACKS[tf]) { if (bars.c.length <= L) continue; const s = M.donchian(bars.c, L, STRAT.includes(tf)); const gs = M.toGrid(n, bars, s, 0); for (let i = 0; i < n; i++) acc[i] += gs[i]; k++; }
    if (k) for (let i = 0; i < n; i++) acc[i] /= k; else acc.fill(NaN);
    o[tf] = acc;
  }
  return o;
});
const btc = coins.indexOf('BTC');
const rows = ['coin,day,' + tfs.map((t) => 'v_' + t).join(',') + ',vol,xsec,r1,r7,r30,fund3,btc_strat,live,next_ret'];
// day-close hour index: the hourly bar starting at 23:00 UTC (its close = the day's close)
for (let i = 24 * 400; i < n - 24; i++) {
  if (Math.floor(grid.t[i] / 3600) % 24 !== 23) continue;
  const day = Math.floor(grid.t[i] / 86400);
  let live = 0; for (let j = 0; j < N; j++) if (vols[j][i] > 0 && !isNaN(grid.coins[j].c[i])) live++;
  const bs = btc >= 0 ? STRAT.reduce((a, tf) => a + (votes[btc][tf][i] || 0), 0) / STRAT.length : 0;
  for (let j = 0; j < N; j++) {
    const g = grid.coins[j], c = g.c[i], v = vols[j][i];
    if (!(v > 0) || isNaN(c) || isNaN(g.c[i + 24])) continue;
    const back = (h) => (i - h >= 0 && g.c[i - h] > 0 ? Math.log(c / g.c[i - h]) : NaN);
    let f = 0; for (let q = Math.max(0, i - 71); q <= i; q++) f += g.fund[q];
    const fund3 = (f / 9) * 3 * 365;
    const nxt = Math.log(g.c[i + 24] / c);
    rows.push([coins[j], day, ...tfs.map((t) => (isNaN(votes[j][t][i]) ? '' : votes[j][t][i].toFixed(3))), v.toFixed(4), xs[j][i].toFixed(3), back(24).toFixed(5), back(168).toFixed(5), back(720).toFixed(5), fund3.toFixed(4), bs.toFixed(3), live, nxt.toFixed(6)].join(','));
  }
}
fs.writeFileSync(out, rows.join('\n') + '\n');
console.log(out, rows.length - 1, 'rows', N, 'coins');
