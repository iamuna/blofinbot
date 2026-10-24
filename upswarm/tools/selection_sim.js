#!/usr/bin/env node
/* Selection simulator: which rule for "which strategies trade this week" actually makes money?
 *
 *   node upswarm/tools/selection_sim.js --trades <trades.json from trades_run.js --set config>
 *        [--sweep <swarm-reports history/2026-10-20/results.json>] [--out file.md]
 *
 * Every strategy's backtest trades stand in for its shadow record (in the backtest every strategy trades on its own,
 * as shadow does). Every Monday 00:00 UTC each rule looks only at trades that closed before that moment and picks the
 * strategies that trade during the next 7 days; the week's result is the R of the trades those strategies entered in
 * that week (each trade risks the same amount). Rules:
 *   avgR±0.7 (4 days)   Ibrahim's rule on a short window: average R of the last 4 days' trades > +0.7 → trade,
 *                       < −0.7 → off for good, otherwise shadow
 *   avgR±0.7 (all)      the same thresholds on every trade so far
 *   48h ΣR ≥ +10        the rule used on 2026-10-23 (sum of R over the last 48 hours)
 *   rolling 30d avgR>0  "trade what worked last month"
^ *   clustered t ≥ 2     live record only: daily R sums since the strategy's first trade (days
 *                       without trades count as 0), t ≥ 2 with ≥ 30 trades and ≥ 20 active days → trade; t < 1 → back
 *                       to shadow
 *   prior + live veto   the proposed rule with its long-history prior (upswarm/GUIDE.md §9): only strategies whose
 *                       5-year sweep result BEFORE 2026 is positive in total and in ≥ 3 of the 4 full years 2022–2025
 *                       may trade (needs --sweep; 2026 is not used, so the test window is out of sample); live record
 *                       vetoes: after ≥ 20 active days with a clustered t < −1 → shadow
 *   everything          every strategy trades
 *   pre-registered set  the robust slow set named before this test (chosen on 2020–2026 data that includes this
 *                       window, so it is a reference, not a clean out-of-sample result)
 */
'use strict';
const fs = require('fs');

const DAYMS = 86400000, WEEK = 7 * DAYMS;
const ROBUST = ['ma-retest-4h', 'ma-retest-12h', 'ma-pullback-12h', 'rsi-macd-trend-12h', 'donchian-12h-60'];
// configured strategy → its 5-year sweep variant (swarm-reports history/2026-10-20); strategies without one have no prior
const SWEEP_OF = {
  'ma-retest-4h': 'ma-retest@240', 'ma-retest-12h': 'ma-retest@720', 'ma-retest-1d': 'ma-retest@1440', 'ma-pullback-12h': 'ma-pullback@720',
  'rsi-macd-trend-12h': 'rsi-macd-trend@720', 'it-4h': 'intraday-trend@240', 'it-12h': 'intraday-trend@720', 'it-1d': 'intraday-trend@1440',
  'trend-pullback-1h': 'trend-pullback@60', 'intraday-trend': 'intraday-trend@30', 'trend-pullback': 'trend-pullback@5', 'session-drive': 'session-drive@30', 'dip-reversal': 'dip-reversal@5', 'squeeze-ride': 'squeeze-ride@5',
  'overshoot-fade': 'overshoot-fade@1', 'leader-follow': 'leader-follow@5', 'crowd-squeeze': 'crowd-squeeze@5', 'noise-breakout': 'noise-breakout@60',
  'harmonic': 'harmonic@15', 'rsi-macd': 'rsi-macd-rev@15', 'ma-21-200': 'ma-retest@15',
};
let PRIOR = {}; // name → {pre, posYears}
function loadPrior(file) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8')), byName = {};
  for (const v of Object.values(r.variants)) byName[v.name] = v;
  for (const [k, sv] of Object.entries(SWEEP_OF)) {
    const v = byName[sv]; if (!v) continue;
    const y = v.years || {}, pre = ['2021', '2022', '2023', '2024', '2025'].reduce((a, x) => a + (y[x] || 0), 0);
    PRIOR[k] = { variant: sv, pre, posYears: ['2022', '2023', '2024', '2025'].filter((x) => (y[x] || 0) > 0).length };
  }
}
function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function tOf(xs) { const n = xs.length; if (n < 2) return 0; const m = mean(xs), sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)); return sd > 0 ? (m / sd) * Math.sqrt(n) : 0; }
// t-stat of daily R sums from the first trade's day to `upto` (days without trades = 0)
function clusteredT(trades, upto) {
  const closed = trades.filter((t) => t.exitT < upto); if (closed.length < 2) return { t: 0, n: closed.length, active: 0 };
  const day = (x) => Math.floor(x / DAYMS), m = new Map();
  for (const t of closed) m.set(day(t.exitT), (m.get(day(t.exitT)) || 0) + t.r);
  const first = Math.min(...closed.map((t) => day(t.entryT))), last = day(upto) - 1, xs = [];
  for (let d = first; d <= last; d++) xs.push(m.get(d) || 0);
  return { t: tOf(xs), n: closed.length, active: m.size };
}

const RULES = {
  'avgR±0.7 (4 days)': (name, tr, W, st) => {
    if (st.off) return 'off';
    const recent = tr.filter((t) => t.exitT < W && t.exitT >= W - 4 * DAYMS).map((t) => t.r);
    if (!recent.length) return st.mode || 'shadow';
    const m = mean(recent); if (m < -0.7) { st.off = true; return 'off'; } return m > 0.7 ? 'trade' : 'shadow';
  },
  'avgR±0.7 (all)': (name, tr, W, st) => {
    if (st.off) return 'off';
    const all = tr.filter((t) => t.exitT < W).map((t) => t.r);
    if (!all.length) return 'shadow';
    const m = mean(all); if (m < -0.7) { st.off = true; return 'off'; } return m > 0.7 ? 'trade' : 'shadow';
  },
  '48h ΣR ≥ +10': (name, tr, W) => { const s = tr.filter((t) => t.exitT < W && t.exitT >= W - 2 * DAYMS).reduce((a, t) => a + t.r, 0); return s >= 10 ? 'trade' : s < 0 ? 'off' : 'shadow'; },
  'rolling 30d avgR > 0': (name, tr, W) => { const x = tr.filter((t) => t.exitT < W && t.exitT >= W - 30 * DAYMS).map((t) => t.r); return x.length >= 5 && mean(x) > 0 ? 'trade' : 'shadow'; },
  'clustered t ≥ 2 (live record only)': (name, tr, W, st) => {
    const c = clusteredT(tr, W);
    if (st.mode === 'trade') return c.t < 1 ? 'shadow' : 'trade';
    return c.t >= 2 && c.n >= 30 && c.active >= 20 ? 'trade' : 'shadow';
  },
  'prior + live veto (proposed)': (name, tr, W) => {
    const p = PRIOR[name]; if (!p || !(p.pre > 0) || p.posYears < 3) return 'shadow';
    const c = clusteredT(tr, W);
    return c.active >= 20 && c.t < -1 ? 'shadow' : 'trade';
  },
  everything: () => 'trade',
  'pre-registered set (reference)': (name) => (ROBUST.includes(name) ? 'trade' : 'shadow'),
};

function simulate(T, startT, endT) {
  const out = {};
  for (const [rule, fn] of Object.entries(RULES)) {
    const state = {}, weeks = [];
    for (let W = startT; W + WEEK <= endT + DAYMS; W += WEEK) {
      let R = 0, n = 0; const trading = [];
      for (const [name, tr] of Object.entries(T)) {
        const st = (state[name] = state[name] || {});
        st.mode = fn(name, tr, W, st);
        if (st.mode !== 'trade') continue;
        trading.push(name);
        for (const t of tr) if (t.entryT >= W && t.entryT < W + WEEK) { R += t.r; n++; }
      }
      weeks.push({ W, R, n, k: trading.length, trading });
    }
    out[rule] = weeks;
  }
  return out;
}

function main() {
  const A = args(), J = JSON.parse(fs.readFileSync(A.trades, 'utf8')), T = J.trades;
  if (A.sweep) loadPrior(A.sweep); else delete RULES['prior + live veto (proposed)'];
  const evalFrom = Date.parse(J.evalFrom), allT = Object.values(T).flat();
  const endT = Math.max(...allT.map((t) => t.entryT));
  // first Monday 00:00 UTC at least 28 days after trades start counting (every rule has some record by then)
  let startT = evalFrom + 28 * DAYMS; startT = Math.ceil((startT - 4 * DAYMS) / WEEK) * WEEK + 4 * DAYMS;
  const sim = simulate(T, startT, endT);
  const L = [`# Selection rules compared (${new Date(startT).toISOString().slice(0, 10)} → ${new Date(endT).toISOString().slice(0, 10)}, ${sim.everything.length} weeks)`, '',
    `${Object.keys(T).length} strategies, every one traded on its own in the backtest (the live code path, BloFin costs). Each rule picks, every Monday, which strategies trade that week, using only trades that closed before. R = the sum of the R of the trades entered that week by the picked strategies (equal risk per trade).`, '',
    '"Quality of picks" = the whole-period average R a trade of the strategies a rule had trading, weighted by weeks picked — did it choose good strategies, whatever the luck of the weeks it held them.', '',
    '| Rule | Weeks positive | Total R | Avg R / week | Worst week | Best week | Trades | Avg R / trade | Strategies trading (avg) | Quality of picks |', '|---|---|---|---|---|---|---|---|---|---|'];
  const whole0 = Object.fromEntries(Object.entries(T).map(([k, tr]) => [k, mean(tr.map((t) => t.r))]));
  for (const [rule, ws] of Object.entries(sim)) {
    const tot = ws.reduce((a, w) => a + w.R, 0), n = ws.reduce((a, w) => a + w.n, 0), active = ws.filter((w) => w.n > 0);
    const picks = ws.flatMap((w) => w.trading), q = picks.length ? mean(picks.map((s) => whole0[s])) : NaN;
    L.push(`| ${rule} | ${active.filter((w) => w.R > 0).length} of ${active.length} | ${tot.toFixed(1)} | ${(tot / ws.length).toFixed(1)} | ${Math.min(...ws.map((w) => w.R)).toFixed(1)} | ${Math.max(...ws.map((w) => w.R)).toFixed(1)} | ${n} | ${n ? (tot / n).toFixed(3) : '—'} | ${(ws.reduce((a, w) => a + w.k, 0) / ws.length).toFixed(1)} | ${Number.isFinite(q) ? (q >= 0 ? '+' : '') + q.toFixed(3) + ' R' : '—'} |`);
  }
  L.push('', '## Week by week (R)', '', `| Week from | ${Object.keys(sim).join(' | ')} |`, `|---|${Object.keys(sim).map(() => '---|').join('')}`);
  for (let k = 0; k < sim.everything.length; k++) L.push(`| ${new Date(sim.everything[k].W).toISOString().slice(0, 10)} | ${Object.values(sim).map((ws) => `${ws[k].R.toFixed(1)} (${ws[k].k})`).join(' | ')} |`);
  L.push('', 'In brackets: how many strategies the rule had trading that week.', '');
  // which strategies the short-window rules picked, and what those strategies are worth over the whole period
  const whole = Object.fromEntries(Object.entries(T).map(([k, tr]) => [k, { n: tr.length, avg: mean(tr.map((t) => t.r)) }]));
  if (A.sweep) L.push(`Prior (5-year sweep, 2021-10 → 2025-12 only): ${Object.entries(PRIOR).map(([k, p]) => `${k} ${p.pre >= 0 ? '+' : ''}${p.pre.toFixed(0)} R, ${p.posYears}/4 years positive`).join('; ')}.`, '');
  for (const rule of ['avgR±0.7 (4 days)', '48h ΣR ≥ +10', 'clustered t ≥ 2 (live record only)', 'prior + live veto (proposed)'].filter((r) => RULES[r])) {
    const picks = new Map(); for (const w of sim[rule]) for (const s of w.trading) picks.set(s, (picks.get(s) || 0) + 1);
    const rows = [...picks.entries()].sort((a, b) => b[1] - a[1]).map(([s, k]) => `${s} (${k} wk, ${whole[s].avg >= 0 ? '+' : ''}${whole[s].avg.toFixed(3)} R over ${whole[s].n} trades)`);
    L.push(`**${rule}** picked: ${rows.join('; ') || 'nothing'}.`, '');
  }
  const md = L.join('\n') + '\n';
  if (A.out) fs.writeFileSync(A.out, md);
  console.log(md);
}
if (require.main === module) main();
module.exports = { simulate, clusteredT, RULES, SWEEP_OF };
