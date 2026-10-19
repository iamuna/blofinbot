#!/usr/bin/env node
/* Reviewer's report cards, from the published state (swarm-state branch).
 *   node swarm/src/tools/review.js <swarm-state dir> [--days 1] [--factory <swarm-factory dir>]
 * Per strategy: ideas, shadow and real trades, average R, t, how it compares with its backtest, gate status.
 * Per agent: status, last heartbeat age, errors, key metrics. Flags: silent agents, strategies with no ideas for a
 * week (candidates for retirement), strategies doing worse than their backtest, risk-mode changes.
 * The Claude reviewer reads this, adds judgment, and the agent manager turns it into proposals.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { stats } = require('../factory/gate');

const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []);
function args() { const A = { _: [] }, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; else A._.push(v[i]); return A; }

function review(dir, o = {}) {
  const now = o.now || Date.now(), since = now - (o.days || 1) * 86400000;
  const state = fs.existsSync(path.join(dir, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) : {};
  const shadow = jsonl(path.join(dir, 'shadow.jsonl')), trades = jsonl(path.join(dir, 'trades.jsonl')), ideas = jsonl(path.join(dir, 'ideas.jsonl'));
  const latest = o.factory && fs.existsSync(path.join(o.factory, 'latest.json')) ? JSON.parse(fs.readFileSync(path.join(o.factory, 'latest.json'), 'utf8')).results : {};
  const agents = state.agents || {}, modes = state.strategyModes || {};
  const names = new Set([...Object.keys(agents).filter((a) => a.startsWith('strategy:')).map((a) => a.slice(9)), ...Object.keys(latest)]);
  const L = [`# Swarm review — ${new Date(now).toISOString().slice(0, 16)}Z`, '', `Account ${state.account ? state.account.mode : '—'}: equity ${state.account ? state.account.equity : '—'}, drawdown ${state.account ? ((state.account.dd || 0) * 100).toFixed(1) + '%' : '—'}, risk mode ${state.risk ? state.risk.mode : '—'}.`, ''];
  L.push('## Strategies', '', '| Strategy | Mode | Ideas (period) | Shadow trades: n / avg R / t | Real trades: n / avg R | Backtest avg R | Flag |', '|---|---|---|---|---|---|---|');
  const flags = [];
  for (const n of [...names].sort()) {
    const sh = shadow.filter((t) => t.strategy === n), shP = sh.filter((t) => t.exitT >= since), s = stats(sh.map((t) => t.r));
    const tr = trades.filter((t) => (t.strategies || []).some((x) => x.name === n)), ts = stats(tr.map((t) => t.r));
    const idP = ideas.filter((i) => i.strategy === n && i.t >= since).length, bt = latest[n] ? latest[n].all.avgR : null;
    let flag = '';
    const hb = agents[`strategy:${n}`];
    if (hb && hb.metrics && hb.metrics.errors) flag = `${hb.metrics.errors} errors`;
    else if (s.n >= 20 && bt != null && s.mean < bt - 2 * s.se) flag = 'worse than backtest';
    else if (!ideas.some((i) => i.strategy === n) && hb && now - hb.startedAt > 7 * 86400000) flag = 'no ideas in 7 days';
    if (flag) flags.push(`${n}: ${flag}`);
    L.push(`| ${n} | ${modes[n] || (hb && hb.metrics && hb.metrics.mode) || 'shadow'} | ${idP} | ${s.n} / ${s.n ? s.mean.toFixed(3) : '—'} / ${s.n ? s.t.toFixed(2) : '—'} (${shP.length} in period) | ${ts.n} / ${ts.n ? ts.mean.toFixed(3) : '—'} | ${bt ?? '—'} | ${flag} |`);
  }
  L.push('', '## Agents', '', '| Agent | Status | Last report | Note | Metrics |', '|---|---|---|---|---|');
  for (const [k, v] of Object.entries(agents).sort()) {
    const age = Math.round((now - (v.at || 0)) / 60000);
    if (age > 30) flags.push(`${k}: silent for ${age} min`);
    if (v.status !== 'ok') flags.push(`${k}: ${v.status} — ${v.why || ''}`);
    L.push(`| ${k} | ${v.status} | ${age} min ago | ${(v.why || '').slice(0, 80)} | ${JSON.stringify(v.metrics || {}).slice(0, 120)} |`);
  }
  L.push('', '## Flags', '', ...(flags.length ? flags.map((f) => `- ${f}`) : ['- none']));
  return { markdown: L.join('\n') + '\n', flags };
}

if (require.main === module) { const A = args(); process.stdout.write(review(A._[0], { days: +(A.days || 1), factory: A.factory }).markdown); }
module.exports = { review };
