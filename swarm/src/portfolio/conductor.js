/* Conductor — the heart (upswarm GUIDE §7.2): one beat an hour decides how much risk the whole book takes and how
 * it is shared between the sleeves. Pure: no I/O. It can only scale DOWN from the signed limits, never up, never
 * switches anything to live, and never acts on one week's sign.
 *
 * dial = min(1, volTarget ÷ realised volatility of the book's last 60 days) × ladder scale × week scale,
 *   floored at 0.25 while trading is allowed. The ladder scale is the risk engine's (drawdown ≥ 10% → 0.5).
 * Weekly cap (risk v2, docs/RISK_V2.md): week-to-date loss ≥ weekLossStopPct → no new risk until Monday 00:00 UTC;
 *   a week that ended ≤ −weekLossHalvePct → the next week at half size.
 * Edge health per sleeve: a one-sided CUSUM (Page, 1954) on its daily result against what its backtest expects:
 *   S = max(0, S + (μ − r − k)), k = ½σ, alarm when S > h = 5σ (μ, σ: the sleeve's expected daily mean and standard
 *   deviation, in the same unit as r). An alarm halves the sleeve's share and restarts the sum; two alarms in 60 days
 *   send the sleeve to shadow (a proposal: modes stay with rule v2 / Ibrahim).
 */
'use strict';
const DAY = 86400000;
const RULES = { volTarget: 0.10, volDays: 60, minVolDays: 20, floor: 0.25, weekLossStopPct: 0.025, weekLossHalvePct: 0.04, cusumK: 0.5, cusumH: 5, alarmWindowDays: 60, alarmCut: 0.5 };

// Monday 00:00 UTC of the week holding ms
function weekStart(ms) { const d = Math.floor(ms / DAY), dow = (d + 3) % 7; return (d - dow) * DAY; } // day 0 (1970-01-01) was a Thursday
function stdev(xs) { if (xs.length < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); }

/* daily: [[day, return], …] of the book · ladderScale: the risk engine's budgetScale · week: {pnlPct (to date),
 * lastPct (the week before, or null)} · rules → {dial, noNew, reasons, realisedVol} */
function dial({ daily = [], ladderScale = 1, week = {}, rules = {} } = {}) {
  const R = Object.assign({}, RULES, rules), reasons = [], last = daily.slice(-R.volDays).map((x) => x[1]);
  const realisedVol = last.length >= R.minVolDays ? stdev(last) * Math.sqrt(365) : null;
  let volScale = 1;
  if (realisedVol > R.volTarget) { volScale = R.volTarget / realisedVol; reasons.push(`realised volatility ${(realisedVol * 100).toFixed(1)}% > ${(R.volTarget * 100).toFixed(0)}%: × ${volScale.toFixed(2)}`); }
  if (ladderScale < 1) reasons.push(`drawdown ladder: × ${ladderScale}`);
  let weekScale = 1, noNew = false;
  if (R.weekLossStopPct && week.pnlPct != null && -week.pnlPct >= R.weekLossStopPct) { noNew = true; reasons.push(`week to date ${(week.pnlPct * 100).toFixed(2)}% ≤ −${(R.weekLossStopPct * 100).toFixed(1)}%: no new risk until Monday`); }
  if (R.weekLossHalvePct && week.lastPct != null && -week.lastPct >= R.weekLossHalvePct) { weekScale = 0.5; reasons.push(`last week ${(week.lastPct * 100).toFixed(2)}% ≤ −${(R.weekLossHalvePct * 100).toFixed(0)}%: this week at half size`); }
  const d = Math.max(R.floor, Math.min(1, volScale) * ladderScale * weekScale);
  return { dial: +d.toFixed(4), noNew, reasons, realisedVol }; // noNew: the caller keeps what is held and adds nothing
}

// one sleeve's CUSUM. state: {s, alarms: [ms], lastDay} · r: the day's result · exp: {mu, sd}
function cusumStep(state, day, r, exp, rules = {}) {
  const R = Object.assign({}, RULES, rules), st = Object.assign({ s: 0, alarms: [], lastDay: null }, state || {});
  if (!(exp && exp.sd > 0) || !Number.isFinite(r)) return { state: st, alarm: false };
  if (st.lastDay != null && day <= st.lastDay) return { state: st, alarm: false }; // each day once
  st.lastDay = day;
  st.s = Math.max(0, st.s + (exp.mu - r - R.cusumK * exp.sd));
  let alarm = false;
  if (st.s > R.cusumH * exp.sd) { alarm = true; st.alarms = st.alarms.concat(day * DAY).filter((t) => t > day * DAY - R.alarmWindowDays * DAY); st.s = 0; }
  return { state: st, alarm };
}
// shares after the alarms: each alarm in the window halves the share; two alarms → shadow (share 0, proposal)
function shareOf(base, state, now, rules = {}) {
  const R = Object.assign({}, RULES, rules), n = ((state && state.alarms) || []).filter((t) => t > now - R.alarmWindowDays * DAY).length;
  return { share: n >= 2 ? 0 : base * R.alarmCut ** n, alarms: n, shadow: n >= 2 };
}

module.exports = { RULES, weekStart, dial, cusumStep, shareOf };
