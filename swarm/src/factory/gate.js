/* Promotion gate: decides, from evidence written down in advance, what each strategy may do.
 *
 *   backtest → shadow : ≥ 300 trades; average R > 0 at 1.5× costs over all of it AND in the newest third;
 *                       positive in at least 2 of 3 thirds; t-stat ≥ the multiple-testing bar (rises with every
 *                       variant ever tried: 2.0 + 0.5·log10(tries), so 10 tries → 2.5, 100 → 3.0)
 *   shadow   → trade  : ≥ 3 days and ≥ 150 ideas in shadow on live data; the shadow trades' average R is not
 *                       below the backtest's by more than 2 standard errors (live behaves like the test);
 *                       on paper/demo only — live money is Ibrahim's call
 *   trade    → shadow : after ≥ 100 trades, average R < 0 with t ≤ −1, or a drawdown > 2× the backtest's
 * The gate never edits code or limits; it returns decisions that the state sync publishes as strategy-mode commands.
 */
'use strict';

function tBar(tries) { return 2 + 0.5 * Math.log10(Math.max(1, tries)); }
function stats(rs) {
  const n = rs.length; if (!n) return { n: 0, mean: 0, sd: 0, t: 0, se: Infinity };
  const mean = rs.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean, sd, t: sd > 0 ? (mean / sd) * Math.sqrt(n) : 0, se: sd / Math.sqrt(n) };
}
function maxDD(rs) { let eq = 0, pk = 0, dd = 0; for (const r of rs) { eq += r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); } return dd; }

// bt: a backtest result row (backtest/run.js: all, cost15, thirds); tries: variants ever tested (trials log)
function backtestGate(bt, tries) {
  const why = [], a = bt.all || {}, c = bt.cost15 || {}, th = bt.thirds || [];
  if (!(a.n >= 300)) why.push(`${a.n || 0} trades (need 300)`);
  if (!(c.avgR > 0)) why.push(`average ${c.avgR} R at 1.5× costs (need > 0)`);
  const last = th[th.length - 1] || {};
  if (!(last.avgR > 0)) why.push(`newest third ${last.avgR} R (need > 0)`);
  if (th.filter((x) => x.sumR > 0).length < 2) why.push('positive in fewer than 2 of 3 thirds');
  const bar = tBar(tries);
  if (!(a.tStat >= bar)) why.push(`t ${a.tStat} < ${bar.toFixed(2)} (bar for ${tries} tries)`);
  return { pass: why.length === 0, why, bar };
}
// shadow: {days, ideas, rs: [r…]}; bt: backtest row
function shadowGate(shadow, bt, account) {
  const why = [];
  if (account === 'live') why.push('live money: only Ibrahim promotes');
  if (!(shadow.days >= 3)) why.push(`${(shadow.days || 0).toFixed(1)} days in shadow (need 3)`);
  if (!(shadow.ideas >= 150)) why.push(`${shadow.ideas || 0} ideas (need 150)`);
  const s = stats(shadow.rs || []), btMean = (bt.all || {}).avgR;
  if (s.n >= 20 && btMean != null && s.mean < btMean - 2 * s.se) why.push(`shadow ${s.mean.toFixed(3)} R vs backtest ${btMean} R: worse by more than 2 standard errors`);
  if (s.n < 20) why.push(`${s.n} shadow trades (need 20 to compare with the backtest)`);
  return { pass: why.length === 0, why, shadow: s };
}
function demoteCheck(rs, bt) {
  const s = stats(rs);
  if (s.n < 100) return { demote: false, why: [`${s.n} trades (judged after 100)`] };
  const why = [];
  if (s.mean < 0 && s.t <= -1) why.push(`average ${s.mean.toFixed(3)} R, t ${s.t.toFixed(2)}`);
  const dd = maxDD(rs), btDD = (bt && bt.all && bt.all.maxDDR) || Infinity;
  if (dd > 2 * btDD) why.push(`drawdown ${dd.toFixed(1)} R > 2× backtest ${btDD} R`);
  return { demote: why.length > 0, why };
}

module.exports = { tBar, stats, backtestGate, shadowGate, demoteCheck, maxDD };
