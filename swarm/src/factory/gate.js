/* Promotion gate: decides, from evidence written down in advance, what each strategy may do.
 *
 *   backtest → shadow : ≥ 300 trades; average R > 0 at 1.5× costs over all of it AND in the newest third;
 *                       positive in at least 2 of 3 thirds; t-stat ≥ the multiple-testing bar (rises with every
 *                       variant ever tried: 2.0 + 0.5·log10(tries), so 10 tries → 2.5, 100 → 3.0)
 *   shadow   → trade  : ≥ 3 days and ≥ 150 ideas in shadow on live data; the shadow trades' average R is not
 *                       below the backtest's by more than 2 standard errors (live behaves like the test);
 *                       on paper/demo only — live money is Ibrahim's call
 *   out-of-sample route: a strategy that missed the backtest bar (usually the multiple-testing t-stat) may still
 *                       go to trade on its live record alone, because shadow trades happen AFTER it was chosen —
 *                       a clean holdout: ≥ 150 closed shadow trades of the current version (same parameters),
 *                       average R > 0 with t ≥ 2 after costs, and the backtest not negative at 1.5× costs.
 *   trade    → shadow : after ≥ 100 trades, average R < 0 with t ≤ −1, or a drawdown > 2× the backtest's
 * The gate never edits code or limits; it returns decisions that the state sync publishes as strategy-mode commands.
 *
 * Clustered t (upswarm GUIDE §4.3, G3): trades that close on the same day move together — twenty shorts opened in
 * one falling hour are one bet, not twenty. dailyStats() sums R per UTC day (days without a trade count as 0) and
 * takes the t-stat of those daily sums. Where the trades' times are known, every t above is the smaller of the
 * per-trade t and the daily one; the backtest rows carry it as `tDay` (backtest/stats.js).
 * Promotion itself moved to rule v2 (promote_v2.js); this gate stays for the factory's report and the reviewer.
 */
'use strict';

function tBar(tries) { return 2 + 0.5 * Math.log10(Math.max(1, tries)); }
function stats(rs) {
  const n = rs.length; if (!n) return { n: 0, mean: 0, sd: 0, t: 0, se: Infinity };
  const mean = rs.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean, sd, t: sd > 0 ? (mean / sd) * Math.sqrt(n) : 0, se: sd / Math.sqrt(n) };
}
const DAYMS = 86400000;
// trades: [{r, exitT, entryT?}] → stats of the daily R sums from the first trade's day to `upto` (default: the
// last exit). active = days with at least one trade closed.
function dailyStats(trades, upto) {
  const ok = (trades || []).filter((t) => Number.isFinite(t.r) && Number.isFinite(t.exitT));
  if (!ok.length) return { n: 0, active: 0, days: 0, mean: 0, sd: 0, t: 0, se: Infinity };
  const day = (x) => Math.floor(x / DAYMS), m = new Map();
  for (const t of ok) m.set(day(t.exitT), (m.get(day(t.exitT)) || 0) + t.r);
  const first = Math.min(...ok.map((t) => day(Number.isFinite(t.entryT) ? Math.min(t.entryT, t.exitT) : t.exitT)));
  const last = upto != null ? day(upto) : Math.max(...m.keys()), xs = [];
  for (let d = first; d <= last; d++) xs.push(m.get(d) || 0);
  const s = stats(xs);
  return { n: ok.length, active: m.size, days: xs.length, mean: s.mean, sd: s.sd, t: s.t, se: s.se };
}
// the honest t of a set of trades: the less extreme of the per-trade and the daily-clustered t (in either direction:
// a burst of losers in one hour does not prove a strategy broken any more than a burst of winners proves it works)
function honestT(trades, upto) {
  const s = stats(trades.map((t) => t.r)), d = dailyStats(trades, upto);
  if (d.days < 2) return s.t;
  return Math.abs(d.t) < Math.abs(s.t) ? d.t : s.t;
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
  const bar = tBar(tries), t = a.tDay != null ? Math.min(a.tStat, a.tDay) : a.tStat;
  if (!(t >= bar)) why.push(`t ${t} < ${bar.toFixed(2)} (bar for ${tries} tries${a.tDay != null ? '; daily-clustered' : ''})`);
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
// shadow: {rs: [r…] of the CURRENT version only, trades?: the same as [{r, exitT, entryT}]}; bt: backtest row
function oosGate(shadow, bt, account) {
  const why = [], s = stats(shadow.rs || []);
  if (shadow.trades && shadow.trades.length) s.t = honestT(shadow.trades);
  if (account === 'live') why.push('live money: only Ibrahim promotes');
  if (s.n < 150) why.push(`${s.n} shadow trades of this version (out-of-sample route needs 150)`);
  if (!(s.mean > 0) || !(s.t >= 2)) why.push(`shadow ${s.n ? s.mean.toFixed(3) : '—'} R, t ${s.n ? s.t.toFixed(2) : '—'} (out-of-sample route needs > 0 R and t ≥ 2)`);
  if (!((bt.cost15 || {}).avgR >= 0)) why.push(`backtest ${(bt.cost15 || {}).avgR} R at 1.5× costs (out-of-sample route needs ≥ 0)`);
  return { pass: why.length === 0, why, shadow: s };
}
// rs: [r…], or trades [{r, exitT, entryT}] (then the t is the daily-clustered one when lower)
function demoteCheck(rs, bt) {
  const trades = rs.length && typeof rs[0] === 'object' ? rs : null;
  if (trades) rs = trades.map((t) => t.r);
  const s = stats(rs);
  if (trades) s.t = honestT(trades);
  if (s.n < 100) return { demote: false, why: [`${s.n} trades (judged after 100)`] };
  const why = [];
  if (s.mean < 0 && s.t <= -1) why.push(`average ${s.mean.toFixed(3)} R, t ${s.t.toFixed(2)}`);
  const dd = maxDD(rs), btDD = (bt && bt.all && bt.all.maxDDR) || Infinity;
  if (dd > 2 * btDD) why.push(`drawdown ${dd.toFixed(1)} R > 2× backtest ${btDD} R`);
  return { demote: why.length > 0, why };
}

module.exports = { tBar, stats, dailyStats, honestT, backtestGate, shadowGate, oosGate, demoteCheck, maxDD };
