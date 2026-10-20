#!/usr/bin/env node
/* Agent manager: turns the reviewer's report cards, the factory's results and the live record into proposals —
 * retire, fix, retune, investigate — and, with --apply, makes the one change it may make on its own: retiring a
 * strategy whose evidence is decisively negative (config `enabled: false`, a self-service change the home PC
 * installs after the tests pass). Everything else is a proposal for the Claude agent manager (docs/CLAUDE_AGENTS.md)
 * to act on: a new or edited strategy plugin goes through the factory; any change to other agents waits for Ibrahim.
 *
 *   node swarm/src/tools/agent_manager.js --state <swarm-state dir> --factory <swarm-factory dir> [--config swarm/config/swarm.json] [--apply] [--now ms]
 *
 * Retire (applied with --apply): a strategy in shadow or off, never promoted, whose backtest is negative with
 *   t ≤ −3, and whose live shadow record — if it has 100+ trades of the current version — is negative too.
 *   A strategy with no backtest result and no ideas for 14 days is proposed, not applied.
 * Fix: a strategy reporting errors; an agent silent or degraded (from the report card flags).
 * Investigate: shadow results worse than the backtest by more than 2 standard errors (the two disagree).
 */
'use strict';
const fs = require('fs'), path = require('path');
const { stats } = require('../factory/gate');
const { review } = require('./review');

const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []);
function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }

function propose({ cfg, latest, state, shadow, ideas, flags, now }) {
  const out = [], modes = Object.assign({}, ...Object.entries(cfg.strategies || {}).map(([k, v]) => ({ [k]: v.enabled === false ? 'off' : v.mode || 'shadow' })), state.strategyModes || {});
  for (const [name, sc] of Object.entries(cfg.strategies || {})) {
    if (sc.enabled === false) continue;
    const bt = latest[name], mode = modes[name] || 'shadow';
    const sh = shadow.filter((t) => t.strategy === name && (!bt || !bt.ph || t.ph === bt.ph)), s = stats(sh.map((t) => t.r));
    if (bt && bt.all && bt.all.n >= 300 && bt.all.avgR < 0 && bt.all.tStat <= -3 && mode !== 'trade' && !(s.n >= 100 && s.mean >= 0)) {
      out.push({ kind: 'retire', strategy: name, auto: true, why: `backtest ${bt.all.avgR} R over ${bt.all.n} trades (t ${bt.all.tStat})${s.n ? `; shadow ${s.mean.toFixed(3)} R over ${s.n}` : ''} — decisively negative` });
      continue;
    }
    if (!bt && !ideas.some((i) => i.strategy === name && i.t >= now - 14 * 86400000)) out.push({ kind: 'retire', strategy: name, auto: false, why: 'no backtest result and no ideas in 14 days' });
    if (bt && bt.all && s.n >= 30 && s.mean < bt.all.avgR - 2 * s.se) out.push({ kind: 'investigate', strategy: name, auto: false, why: `shadow ${s.mean.toFixed(3)} R (n ${s.n}) vs backtest ${bt.all.avgR} R: the live market or the code differs from the test` });
  }
  for (const f of flags) {
    const m = f.match(/^(strategy:)?([^:]+): (.*)$/);
    if (!m) continue;
    if (/errors/.test(m[3])) out.push({ kind: 'fix', strategy: m[2], auto: false, why: m[3] });
    else if (/silent|degraded|down/.test(m[3])) out.push({ kind: 'fix', agent: m[2], auto: false, why: m[3] });
  }
  return out;
}

function apply(cfgFile, proposals) {
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')), done = [];
  for (const p of proposals) if (p.kind === 'retire' && p.auto && cfg.strategies[p.strategy] && cfg.strategies[p.strategy].enabled !== false) {
    cfg.strategies[p.strategy].enabled = false; cfg.strategies[p.strategy].retired = `${new Date().toISOString().slice(0, 10)}: ${p.why}`; done.push(p.strategy);
  }
  if (done.length) fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
  return done;
}

function main() {
  const A = args(), now = A.now ? +A.now : Date.now();
  const cfgFile = path.resolve(A.config || path.join(__dirname, '..', '..', 'config', 'swarm.json'));
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const S = A.state ? path.resolve(A.state) : null, F = A.factory ? path.resolve(A.factory) : null;
  const latest = F && fs.existsSync(path.join(F, 'latest.json')) ? JSON.parse(fs.readFileSync(path.join(F, 'latest.json'), 'utf8')).results : {};
  const state = S && fs.existsSync(path.join(S, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(S, 'state.json'), 'utf8')) : {};
  const flags = S && fs.existsSync(path.join(S, 'state.json')) ? review(S, { now, factory: F }).flags : [];
  const ps = propose({ cfg, latest, state, shadow: S ? jsonl(path.join(S, 'shadow.jsonl')) : [], ideas: S ? jsonl(path.join(S, 'ideas.jsonl')) : [], flags, now });
  const L = ['# Agent manager — proposals', '', ps.length ? '' : 'Nothing to propose.'];
  for (const p of ps) L.push(`- **${p.kind}** ${p.strategy || p.agent}${p.auto ? ' (self-service)' : ''}: ${p.why}`);
  if (A.apply) { const done = apply(cfgFile, ps); L.push('', done.length ? `Applied: retired ${done.join(', ')} in config/swarm.json.` : 'Applied: nothing.'); }
  console.log(L.join('\n'));
}
if (require.main === module) main();
module.exports = { propose, apply };
