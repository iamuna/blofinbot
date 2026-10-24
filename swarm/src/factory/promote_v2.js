#!/usr/bin/env node
/* Promotion rule v2 (upswarm GUIDE §9) — replaces "48 h ΣR ≥ +10", "average R ±0.7" and the old gate's shadow route.
 * Live records are too short to SELECT a strategy; they are long enough to VETO one. The years of history select.
 *
 *   node swarm/src/factory/promote_v2.js --state <swarm-state dir> --sweep <results.json | swarm-reports history/ dir>
 *        [--era <era results.json>] [--factory <swarm-factory dir>] [--config swarm/config/swarm.json]
 *        [--out report.md] [--control control.json] [--min-edge 0.03] [--now ms]
 *
 *   1. Long-history gate: the strategy's 5-year sweep variant (point-in-time universe, dead coins included) is positive
 *      at 1.5× costs, positive in at least 3 of the 4 full years 2022–2025, and earns at least the minimum edge
 *      (default +0.03 R a trade: thinner edges die with any error in the cost model). Where the 2018–2021 era test has
 *      the strategy, it must be positive there at 1.5× costs too. No sweep result → no capital: it waits for the sweep.
 *   2. Live veto: shadow + paper trades summed per UTC day (days without a trade count as 0). After ≥ 20 active days a
 *      clustered t below −1 sends it back to shadow. Before that the live record neither promotes nor demotes.
 *   3. Size: posterior average R a trade = (100 × sweep avg R + n × live avg R) ÷ (100 + n).
 *   4. Out-of-sample route without a sweep result: ≥ 150 live trades over ≥ 60 active days with a clustered t ≥ 2.5.
 *   5. Retirement candidate: no sweep result and a clearly negative factory backtest (t ≤ −2 over ≥ 100 trades).
 *   6. Never live money: that is Ibrahim's decision on the demo record. 'off' strategies stay off.
 * Tested on 21 weeks out of sample (GUIDE §13.2): +124.6 R, against −65 R for "±0.7 on the last 4 days" and −1,003 R
 * for "48 h ΣR ≥ +10". --control writes a control.json proposal (the factory workflow runs this as a dry run: report
 * only, no control.json, until Ibrahim switches it on).
 */
'use strict';
const fs = require('fs'), path = require('path');
const { dailyStats } = require('./gate');

const PRIOR_TRADES = 100, YEARS = ['2022', '2023', '2024', '2025'];
// configured strategy → 5-year sweep variant (history/sweep.js names); a strategy's config may set its own `sweep`
const SWEEP_OF = {
  'ma-retest-4h': 'ma-retest@240', 'ma-retest-12h': 'ma-retest@720', 'ma-retest-1d': 'ma-retest@1440', 'ma-pullback-12h': 'ma-pullback@720',
  'rsi-macd-trend-12h': 'rsi-macd-trend@720', 'it-4h': 'intraday-trend@240', 'it-12h': 'intraday-trend@720', 'it-1d': 'intraday-trend@1440',
  'trend-pullback-1h': 'trend-pullback@60', 'intraday-trend': 'intraday-trend@30', 'trend-pullback': 'trend-pullback@5', 'session-drive': 'session-drive@30',
  'dip-reversal': 'dip-reversal@5', 'squeeze-ride': 'squeeze-ride@5', 'overshoot-fade': 'overshoot-fade@1', 'leader-follow': 'leader-follow@5',
  'crowd-squeeze': 'crowd-squeeze@5', 'noise-breakout': 'noise-breakout@60', 'harmonic': 'harmonic@15', 'rsi-macd': 'rsi-macd-rev@15', 'ma-21-200': 'ma-retest@15',
  'donchian-12h-60': 'donchian-60@720', 'donchian-1d-20': 'donchian-20@1440', 'donchian-1d-60': 'donchian-60@1440', 'donchian-1d-150': 'donchian-150@1440',
  'funding-fade-4h': 'funding-fade@240', 'adaptive-score-4h': 'adaptive-score@240', 'adaptive-score-12h': 'adaptive-score@720',
};

function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []);
const readJ = (f) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

// a results.json, or swarm-reports' history/ folder: the newest dated run in it
function sweepFile(p) {
  if (!p || !fs.existsSync(p)) return null;
  if (fs.statSync(p).isFile()) return p;
  const runs = fs.readdirSync(p).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(p, d, 'results.json'))).sort();
  return runs.length ? path.join(p, runs[runs.length - 1], 'results.json') : null;
}

// inputs already loaded: {state, shadow, paper, sweep (variants by name), era (strategies by name), factory (results), cfg}
function decide({ state = {}, shadow = [], paper = [], sweep = {}, era = {}, factory = {}, cfg = {}, now = Date.now(), minEdge = 0.03 }) {
  const modes = state.strategyModes || {}, strategies = cfg.strategies || {};
  const names = new Set([...Object.keys(modes), ...shadow.map((t) => t.strategy), ...Object.keys(strategies).filter((k) => strategies[k].enabled !== false)]);
  const rows = [];
  for (const name of [...names].filter((n) => !String(n).startsWith('sleeve:')).sort()) {
    const sc = strategies[name] || {}, mode = modes[name] || (sc.enabled === false ? 'off' : sc.mode || (strategies[name] ? 'shadow' : '—'));
    const v = sweep[sc.sweep || SWEEP_OF[name]], y = (v && v.years) || {};
    const posYears = YEARS.filter((k) => (y[k] || 0) > 0).length, e = era[name], eraOk = !e || ((e.cost15 || e.all || {}).avgR > 0);
    const prior = v ? { variant: v.name, n: v.full.n, avgR: v.full.avgR, sumR15: v.full.sumR15, posYears, era: e ? (e.cost15 || e.all).avgR : null } : null;
    if (prior) prior.ok = prior.sumR15 > 0 && posYears >= 3 && prior.avgR >= minEdge && eraOk;
    const live = shadow.filter((t) => t.strategy === name).concat(paper.filter((t) => (t.strategies || []).some((s) => (s.name || s) === name)));
    const d = dailyStats(live, now), liveAvg = mean(live.map((t) => t.r));
    const post = prior ? (PRIOR_TRADES * prior.avgR + live.length * (Number.isFinite(liveAvg) ? liveAvg : 0)) / (PRIOR_TRADES + live.length) : NaN;
    const tTxt = d.days >= 2 ? `clustered t ${d.t.toFixed(2)}` : 'no clustered t yet';
    let verdict, why;
    if (mode === 'off') { verdict = 'off'; why = 'off in the config or by Ibrahim: the rule does not switch it on'; }
    else if (prior && prior.ok) {
      if (d.active >= 20 && d.t < -1) { verdict = 'shadow'; why = `live veto: ${tTxt} over ${d.active} active days`; }
      else { verdict = 'trade'; why = `5-year sweep ${prior.variant}: ${prior.n} trades, ${prior.avgR} R a trade, ${prior.posYears}/4 years positive, positive at 1.5× costs${prior.era != null ? `, era 2018–21 ${prior.era} R` : ''}; ${d.active < 20 ? `live record too short to veto (${d.active} active days)` : `live ${tTxt}`}`; }
    } else if (prior) {
      const fails = [];
      if (!(prior.sumR15 > 0)) fails.push('negative at 1.5× costs');
      if (posYears < 3) fails.push(`${posYears}/4 years positive`);
      if (!(prior.avgR >= minEdge)) fails.push(`${prior.avgR} R a trade (minimum edge ${minEdge})`);
      if (!eraOk) fails.push(`2018–21 era test ${prior.era} R at 1.5× costs`);
      verdict = 'shadow'; why = `5-year sweep ${prior.variant} fails the gate: ${fails.join(', ')}`;
    } else if (live.length >= 150 && d.active >= 60 && d.t >= 2.5) { verdict = 'trade'; why = `out-of-sample route: ${live.length} live trades, ${d.active} active days, ${tTxt}`; }
    else {
      const fb = factory[name] && factory[name].all;
      verdict = 'shadow';
      why = fb && fb.n >= 100 && fb.avgR < 0 && fb.tStat <= -2 ? `no 5-year sweep result, and the factory backtest is negative (${fb.avgR} R a trade, t ${fb.tStat}, ${fb.n} trades): retirement candidate`
        : `no 5-year sweep result: queue it for the sweep (live: ${live.length} trades over ${d.active} active days${d.days >= 2 ? `, ${tTxt}` : ''})`;
    }
    const f = factory[name] && factory[name].all;
    rows.push({ name, mode, verdict, why, liveN: live.length, liveAvg, active: d.active, t: d.days >= 2 ? d.t : NaN, post, factory: f && f.n ? `${f.avgR} (${f.n})` : '—' });
  }
  return rows;
}

// a change worth proposing: a move into or out of trade
const changed = (r) => r.mode !== '—' && r.mode !== 'off' && r.verdict !== 'off' && r.verdict !== r.mode;

function markdown(rows, at, src) {
  const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—');
  const ch = rows.filter(changed);
  const L = [`# Promotion rule v2 — ${at}`, '', src ? `Evidence: ${src}.` : '', '',
    `Trade by the rule: **${rows.filter((r) => r.verdict === 'trade').map((r) => r.name).join(', ') || 'none'}**.`, '',
    `Differs from the PC's modes: ${ch.map((r) => `${r.name} ${r.mode} → ${r.verdict}`).join('; ') || 'none'}.`, '',
    '| Strategy | Mode now | Rule v2 | Live trades | Live avg R | Active days | Clustered t (daily) | Posterior avg R | Factory avg R (trades) | Why |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) L.push(`| ${r.name} | ${r.mode} | ${r.verdict === 'trade' ? '**trade**' : r.verdict} | ${r.liveN} | ${fx(r.liveAvg, 2)} | ${r.active} | ${fx(r.t, 2)} | ${fx(r.post)} | ${r.factory} | ${r.why} |`);
  return L.join('\n') + '\n';
}

function load(A) {
  const S = path.resolve(A.state), sf = sweepFile(A.sweep && path.resolve(A.sweep));
  const sweep = {}; if (sf) for (const v of Object.values(readJ(sf).variants)) sweep[v.name] = v;
  const eraJ = readJ(A.era && path.resolve(A.era)), latest = readJ(A.factory && path.join(path.resolve(A.factory), 'latest.json'));
  const cfg = readJ(path.resolve(A.config || path.join(__dirname, '..', '..', 'config', 'swarm.json'))) || {};
  return {
    state: readJ(path.join(S, 'state.json')) || {}, shadow: jsonl(path.join(S, 'shadow.jsonl')), paper: jsonl(path.join(S, 'trades.jsonl')),
    sweep, era: (eraJ && eraJ.strategies) || {}, factory: (latest && latest.results) || {}, cfg,
    src: `5-year sweep ${sf ? path.basename(path.dirname(sf)) : 'none'}${eraJ ? `, era test ${String(eraJ.generated || '').slice(0, 10)}` : ''}${latest ? ', factory latest' : ''}, live state ${(readJ(path.join(S, 'state.json')) || {}).updatedAt || '—'}`,
  };
}

if (require.main === module) {
  const A = args(), now = A.now ? +A.now : Date.now(), inp = load(A);
  const rows = decide(Object.assign({}, inp, { now, minEdge: A['min-edge'] == null ? 0.03 : +A['min-edge'] }));
  const md = markdown(rows, new Date(now).toISOString().slice(0, 16) + 'Z', inp.src);
  if (A.out) fs.writeFileSync(A.out, md);
  if (A.control) {
    const cmds = rows.filter(changed).map((r) => ({ cmd: 'strategy-mode', strategy: r.name, mode: r.verdict, why: r.why }));
    fs.writeFileSync(A.control, JSON.stringify({ id: `promotion-v2-${now}`, by: 'promotion-v2', at: new Date(now).toISOString(), commands: cmds }, null, 1));
  }
  process.stdout.write(md);
}
module.exports = { decide, markdown, changed, sweepFile, SWEEP_OF };
