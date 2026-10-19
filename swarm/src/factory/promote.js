#!/usr/bin/env node
/* Promotion step: combines the tester's results (swarm-factory branch) with live evidence (swarm-state branch)
 * and writes control.json commands for the home PC.
 *
 *   node swarm/src/factory/promote.js --factory <swarm-factory dir> --state <swarm-state dir> [--write]
 *
 * shadow → trade when the backtest gate AND the shadow gate pass (paper/demo accounts only);
 * trade → shadow when the demotion check fires. Prints the decisions; --write puts them in <state>/control.json.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { backtestGate, shadowGate, demoteCheck } = require('./gate');

function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []);

function decide({ latest, state, shadow, trades, ideas, now = Date.now() }) {
  const account = (state.account && state.account.mode) || 'paper';
  const modes = (state.strategyModes) || {};
  const out = [];
  for (const [name, bt] of Object.entries(latest.results || {})) {
    const mode = modes[name] || 'shadow';
    const sh = shadow.filter((t) => t.strategy === name), id = ideas.filter((i) => i.strategy === name);
    const first = sh.length ? Math.min(...sh.map((t) => t.entryT)) : id.length ? Math.min(...id.map((i) => i.t)) : now;
    if (mode === 'shadow') {
      const g1 = backtestGate(bt, latest.tries || 1), g2 = shadowGate({ days: (now - first) / 86400000, ideas: Math.max(id.length, sh.length), rs: sh.map((t) => t.r) }, bt, account);
      out.push({ name, from: 'shadow', to: g1.pass && g2.pass ? 'trade' : 'shadow', why: g1.pass && g2.pass ? ['backtest and shadow gates pass'] : [...g1.why, ...g2.why] });
    } else if (mode === 'trade') {
      const d = demoteCheck(trades.filter((t) => (t.strategies || []).some((s) => s.name === name)).map((t) => t.r), bt);
      out.push({ name, from: 'trade', to: d.demote ? 'shadow' : 'trade', why: d.why });
    }
  }
  return out;
}

function main() {
  const A = args(), F = path.resolve(A.factory), S = path.resolve(A.state);
  const latest = JSON.parse(fs.readFileSync(path.join(F, 'latest.json'), 'utf8'));
  const state = fs.existsSync(path.join(S, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(S, 'state.json'), 'utf8')) : {};
  const ds = decide({ latest, state, shadow: jsonl(path.join(S, 'shadow.jsonl')), trades: jsonl(path.join(S, 'trades.jsonl')), ideas: jsonl(path.join(S, 'ideas.jsonl')) });
  for (const d of ds) console.log(`${d.name}: ${d.from} → ${d.to}${d.why.length ? ' — ' + d.why.join('; ') : ''}`);
  const changes = ds.filter((d) => d.to !== d.from);
  if (A.write && changes.length) {
    const ctl = { id: `gate-${Date.now()}`, by: 'promotion-gate', at: new Date().toISOString(), commands: changes.map((d) => ({ cmd: 'strategy-mode', strategy: d.name, mode: d.to, why: d.why.join('; ') })) };
    fs.writeFileSync(path.join(S, 'control.json'), JSON.stringify(ctl, null, 1));
    console.log(`wrote control.json with ${changes.length} change(s)`);
  }
}
if (require.main === module) main();
module.exports = { decide };
