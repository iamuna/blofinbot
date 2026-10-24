/* Trade statistics used by the tester, the promotion gate and the reviewer. All in R (1 R = the amount risked)
 * and basis points net of fees, slippage and funding. costMult re-prices the same trades at higher costs.
 */
'use strict';
const DAY = 86400000;

function netAt(t, m) { return t.grossBps - m * (t.feeBps + t.slipBps) - t.fundBps; }
function summarize(trades, o = {}) {
  const m = o.costMult || 1;
  const rs = trades.map((t) => netAt(t, m) / t.riskBps), nets = trades.map((t) => netAt(t, m));
  const n = rs.length;
  if (!n) return { n: 0 };
  const sum = rs.reduce((a, b) => a + b, 0), mean = sum / n;
  const sd = Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, n - 1));
  const win = rs.filter((r) => r > 0), loss = rs.filter((r) => r <= 0);
  let eq = 0, peak = 0, dd = 0;
  const order = trades.map((t, k) => [t.exitT, rs[k]]).sort((a, b) => a[0] - b[0]);
  for (const [, r] of order) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  // daily series at a fixed risk per trade → Sharpe of the strategy on its own
  const days = new Map(); for (const [t, r] of order) { const d = Math.floor(t / DAY); days.set(d, (days.get(d) || 0) + r); }
  const first = Math.floor(order[0][0] / DAY), last = Math.floor(order[order.length - 1][0] / DAY), dr = [];
  for (let d = first; d <= last; d++) dr.push(days.get(d) || 0);
  const dm = dr.reduce((a, b) => a + b, 0) / dr.length, dsd = Math.sqrt(dr.reduce((a, x) => a + (x - dm) ** 2, 0) / Math.max(1, dr.length - 1));
  const span = Math.max(1, last - first + 1);
  return {
    n, perDay: +(n / span).toFixed(2), winRate: +(win.length / n).toFixed(3), avgR: +mean.toFixed(4), sumR: +sum.toFixed(2),
    avgNetBps: +(nets.reduce((a, b) => a + b, 0) / n).toFixed(2), avgGrossBps: +(trades.reduce((a, t) => a + t.grossBps, 0) / n).toFixed(2),
    avgCostBps: +(trades.reduce((a, t) => a + m * (t.feeBps + t.slipBps) + t.fundBps, 0) / n).toFixed(2),
    pf: loss.length ? +(win.reduce((a, b) => a + b, 0) / Math.abs(loss.reduce((a, b) => a + b, 0) || 1e-9)).toFixed(2) : null,
    tStat: sd > 0 ? +((mean / sd) * Math.sqrt(n)).toFixed(2) : null, maxDDR: +dd.toFixed(2),
    sharpe: dsd > 0 ? +((dm / dsd) * Math.sqrt(365)).toFixed(2) : null, days: span,
    // daily-clustered t: trades closing on the same day count as one observation (the gate uses the lower t)
    tDay: dsd > 0 && dr.length >= 2 ? +((dm / dsd) * Math.sqrt(dr.length)).toFixed(2) : null,
  };
}
// the same summary for each third of the period (stability), by month and by coin
function breakdown(trades, o = {}) {
  if (!trades.length) return { thirds: [], months: {}, coins: {} };
  const sorted = [...trades].sort((a, b) => a.exitT - b.exitT), t0 = sorted[0].exitT, t1 = sorted[sorted.length - 1].exitT + 1, w = (t1 - t0) / 3;
  const thirds = [0, 1, 2].map((k) => summarize(sorted.filter((t) => t.exitT >= t0 + k * w && t.exitT < t0 + (k + 1) * w), o));
  const group = (key) => { const g = {}; for (const t of sorted) (g[key(t)] = g[key(t)] || []).push(t); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, summarize(v, o)])); };
  return { thirds, months: group((t) => new Date(t.exitT).toISOString().slice(0, 7)), coins: group((t) => t.coin), tfs: group((t) => String(t.tf)), reasons: group((t) => t.reason) };
}

module.exports = { summarize, breakdown, netAt };
