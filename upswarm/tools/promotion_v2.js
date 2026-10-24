#!/usr/bin/env node
/* Promotion rule v2 — what the evidence supports for each strategy, today. Read-only: it prints a table and, with
 * --control, writes a control.json proposal next to the output (it never pushes anything).
 *
 *   node upswarm/tools/promotion_v2.js --state <swarm-state dir> --sweep <swarm-reports history/…/results.json>
 *        [--factory <swarm-factory dir>] [--out file.md] [--control proposal.json]
 *
 * The rule (upswarm/GUIDE.md §9), tested on 21 weeks out of sample in §13.2:
 *   1. Long-history gate: the strategy's 5-year sweep variant (point-in-time universe, dead coins included) is positive
 *      at 1.5× costs and positive in at least 3 of the 4 full years 2022–2025. No sweep result → no capital; it goes to
 *      the sweep queue first, whatever its shadow record says.
 *   2. Live veto: daily R sums of its shadow + paper trades (days without a trade count as 0). After ≥ 20 active days,
 *      a clustered t < −1 sends it back to shadow. Before that, the live record neither promotes nor demotes.
 *   3. Size: posterior average R a trade = (100 × backtest avg R + n × live avg R) ÷ (100 + n); the allocator's
 *      quarter-Kelly uses it instead of the raw live average.
 *   4. Out-of-sample route without a sweep result: ≥ 150 live trades over ≥ 60 active days with a clustered t ≥ 2.5.
 *   5. Minimum edge: the sweep's average R a trade must be at least --min-edge (default 0.03): thinner edges die with
 *      any error in the cost model. Added after the replay in GUIDE §13.2 (which ran without it), on the deep review's
 *      finding that trend-pullback@60 is "too thin to trade after costs"; --min-edge 0 gives the rule as replayed.
 * Live money stays Ibrahim's decision.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { SWEEP_OF } = require('./selection_sim');

const DAYMS = 86400000, PRIOR_TRADES = 100;
function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
function tOf(xs) { const n = xs.length; if (n < 2) return NaN; const m = mean(xs), sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)); return sd > 0 ? (m / sd) * Math.sqrt(n) : NaN; }
function daily(trades, now) {
  if (!trades.length) return { t: NaN, active: 0, days: 0 };
  const m = new Map(), day = (x) => Math.floor(x / DAYMS);
  for (const t of trades) m.set(day(t.exitT), (m.get(day(t.exitT)) || 0) + t.r);
  const first = Math.min(...trades.map((t) => day(t.entryT))), xs = [];
  for (let d = first; d <= day(now); d++) xs.push(m.get(d) || 0);
  return { t: tOf(xs), active: m.size, days: xs.length };
}

function decide({ state, sweep, factory, now = Date.now(), minEdge = 0.03 }) {
  const st = fs.existsSync(path.join(state, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(state, 'state.json'), 'utf8')) : {};
  const modes = st.strategyModes || {};
  const shadow = jsonl(path.join(state, 'shadow.jsonl')), paper = jsonl(path.join(state, 'trades.jsonl'));
  const sw = {}; if (sweep) for (const v of Object.values(JSON.parse(fs.readFileSync(sweep, 'utf8')).variants)) sw[v.name] = v;
  const fac = factory && fs.existsSync(path.join(factory, 'latest.json')) ? JSON.parse(fs.readFileSync(path.join(factory, 'latest.json'), 'utf8')).results : {};
  const names = new Set([...Object.keys(modes), ...shadow.map((t) => t.strategy)]);
  const rows = [];
  for (const name of [...names].sort()) {
    const v = sw[SWEEP_OF[name]], y = (v && v.years) || {};
    const posYears = ['2022', '2023', '2024', '2025'].filter((k) => (y[k] || 0) > 0).length;
    const prior = v ? { variant: v.name, n: v.full.n, avgR: v.full.avgR, sumR15: v.full.sumR15, posYears, ok: v.full.sumR15 > 0 && posYears >= 3 && v.full.avgR >= minEdge } : null;
    const live = shadow.filter((t) => t.strategy === name).concat(paper.filter((t) => (t.strategies || []).some((s) => (s.name || s) === name)));
    const d = daily(live, now), liveAvg = mean(live.map((t) => t.r));
    const post = prior ? (PRIOR_TRADES * prior.avgR + live.length * (Number.isFinite(liveAvg) ? liveAvg : 0)) / (PRIOR_TRADES + live.length) : NaN;
    let verdict, why;
    if (prior && prior.ok) {
      if (d.active >= 20 && d.t < -1) { verdict = 'shadow'; why = `live veto: clustered t ${d.t.toFixed(2)} over ${d.active} active days`; }
      else { verdict = 'trade'; why = `5-year sweep ${prior.variant}: ${prior.n} trades, ${prior.avgR} R a trade, ${prior.posYears}/4 years positive, positive at 1.5× costs${d.active < 20 ? `; live record too short to veto (${d.active} active days)` : `; live clustered t ${d.t.toFixed(2)}`}`; }
    } else if (prior) { verdict = 'shadow'; why = `5-year sweep ${prior.variant} fails the gate: ${prior.avgR} R a trade${prior.avgR < minEdge && prior.avgR > 0 ? ` (below the ${minEdge} R minimum edge)` : ''}, ${prior.posYears}/4 years positive, ${prior.sumR15 > 0 ? 'positive' : 'negative'} at 1.5× costs`; }
    else if (live.length >= 150 && d.active >= 60 && d.t >= 2.5) { verdict = 'trade'; why = `out-of-sample route: ${live.length} live trades, ${d.active} active days, clustered t ${d.t.toFixed(2)}`; }
    else {
      const fb = fac[name] && fac[name].all;
      verdict = 'shadow';
      why = fb && fb.n >= 100 && fb.avgR < 0 && fb.tStat <= -2 ? `no 5-year sweep result, and the factory backtest is negative (${fb.avgR} R a trade, t ${fb.tStat}, ${fb.n} trades): retirement candidate`
        : `no 5-year sweep result — queue it for the sweep (live: ${live.length} trades over ${d.active} active days${Number.isFinite(d.t) ? `, clustered t ${d.t.toFixed(2)}` : ''})`;
    }
    const f = fac[name] && fac[name].all;
    rows.push({ name, mode: modes[name] || '—', verdict, why, liveN: live.length, liveAvg, active: d.active, t: d.t, post, factory: f && f.n ? `${f.avgR} (${f.n})` : '—' });
  }
  return rows;
}

// a change worth proposing: any move to or from trade (an 'off' strategy staying out of trade is not one)
const changed = (r) => r.mode !== '—' && r.verdict !== r.mode && !(r.mode === 'off' && r.verdict === 'shadow');

function markdown(rows, at) {
  const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—');
  const ch = rows.filter(changed);
  const L = [`# Promotion rule v2 — ${at}`, '', `Trade now: **${rows.filter((r) => r.verdict === 'trade').map((r) => r.name).join(', ') || 'nothing'}**.`, '',
    `Changes from the PC's modes: ${ch.map((r) => `${r.name} ${r.mode} → ${r.verdict}`).join('; ') || 'none'}.`, '',
    '| Strategy | Mode now | Rule v2 | Live trades | Live avg R | Active days | Clustered t (daily) | Posterior avg R | Factory avg R (trades) | Why |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) L.push(`| ${r.name} | ${r.mode} | ${r.verdict === 'trade' ? '**trade**' : r.verdict} | ${r.liveN} | ${fx(r.liveAvg, 2)} | ${r.active} | ${fx(r.t, 2)} | ${fx(r.post)} | ${r.factory} | ${r.why} |`);
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const A = args(), now = A.now ? +A.now : Date.now();
  const rows = decide({ state: path.resolve(A.state), sweep: A.sweep && path.resolve(A.sweep), factory: A.factory && path.resolve(A.factory), now, minEdge: A['min-edge'] == null ? 0.03 : +A['min-edge'] });
  const md = markdown(rows, new Date(now).toISOString().slice(0, 16) + 'Z');
  if (A.out) fs.writeFileSync(A.out, md);
  if (A.control) {
    const cmds = rows.filter(changed).map((r) => ({ cmd: 'strategy-mode', strategy: r.name, mode: r.verdict, why: r.why }));
    fs.writeFileSync(A.control, JSON.stringify({ id: `promotion-v2-${now}`, by: 'promotion-v2 (proposal, needs Ibrahim)', at: new Date(now).toISOString(), commands: cmds }, null, 1));
  }
  console.log(md);
}
module.exports = { decide, markdown, daily };
