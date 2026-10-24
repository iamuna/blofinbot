/* State sync: publishes the swarm's state to GitHub every 10 minutes, so the dashboard and the slow (Claude)
 * agents — reviewer, researcher, agent manager — can read it without reaching the home PC.
 *
 * Branch `swarm-state` (env SWARM_STATE_BRANCH), checkout in <dataDir>/state-repo:
 *   summary.md        human-readable status
 *   state.json        account, positions, risk state, universe, guard summary, agent heartbeats, strategy stats
 *   trades.jsonl      every closed trade (appended)       shadow.jsonl  every shadow trade (appended)
 *   ideas.jsonl       ideas of the last 24 h               decisions.jsonl  risk decisions (appended)
 *   costs.jsonl       the implementation shortfall of every fill (exec.cost, appended)
 * Commands back: the slow agents write control.json on the branch (e.g. strategy modes they are allowed to set);
 * the sync pulls it and publishes it as sys.command from 'state-sync' (the coordinator only accepts what that
 * source may change). Pushing needs GITHUB_TOKEN (fine-grained, Contents read/write on the repo).
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { Agent } = require('../core/agent');
const { writeAtomic, readJSON } = require('../core/fsx');

class StateSync extends Agent {
  static agentName = 'state-sync';
  async onStart() {
    this.Y = Object.assign({ everyMin: 10, branch: process.env.SWARM_STATE_BRANCH || 'swarm-state', repo: process.env.SWARM_REPO || 'github.com/iamuna/blofinbot.git' }, this.cfg.stateSync || {});
    this.dir = path.join(this.ctx.dataDir, 'state-repo');
    this.token = process.env.GITHUB_TOKEN || '';
    this.hb = {}; this.buf = { trades: [], shadow: [], decisions: [], costs: [] }; this.ideas = [];
    this.subscribe('sys.heartbeat', (m) => { this.hb[m.data.agent] = Object.assign({ at: m.ts }, m.data); });
    this.subscribe('trade.closed', (m) => this.buf.trades.push(m.data), { durable: true });
    this.subscribe('shadow.trade', (m) => this.buf.shadow.push(m.data), { durable: true });
    this.subscribe('risk.decision', (m) => this.buf.decisions.push(Object.assign({ ts: m.ts }, m.data)));
    this.subscribe('exec.cost', (m) => this.buf.costs.push(m.data), { durable: true });
    this.subscribe('idea', (m) => { this.ideas.push(m.data); const cut = this.now() - 86400000; while (this.ideas.length && this.ideas[0].t < cut) this.ideas.shift(); });
    this.subscribe('risk.state', (m) => { this.risk = m.data; });
    this.ensureRepo();
    this.every(this.Y.everyMin * 60000, () => this.sync());
  }
  git(args) { return cp.execFileSync('git', ['-C', this.dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim(); }
  ensureRepo() {
    const remote = this.token ? `https://x-access-token:${this.token}@${this.Y.repo}` : null;
    if (!fs.existsSync(path.join(this.dir, '.git'))) {
      fs.mkdirSync(this.dir, { recursive: true });
      let cloned = false;
      if (remote) { try { cp.execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', this.Y.branch, remote, this.dir], { stdio: 'ignore', timeout: 120000 }); cloned = true; } catch (e) { /* new branch */ } }
      if (!cloned) { this.git(['init', '-q', '-b', this.Y.branch]); if (remote) this.git(['remote', 'add', 'origin', remote]); }
    } else if (remote) { try { this.git(['remote', 'set-url', 'origin', remote]); } catch (e) { /* ignore */ } }
    try { this.git(['config', 'user.name', 'blofin swarm (home)']); this.git(['config', 'user.email', 'swarm@users.noreply.github.com']); } catch (e) { /* ignore */ }
  }
  append(file, rows) { if (rows.length) fs.appendFileSync(path.join(this.dir, file), rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); }
  async sync() {
    const kv = async (k) => this.bus.kv.get(k);
    const [account, positions, universe, guard, results, strategyModes] = [await kv('account'), await kv('positions'), await kv('universe'), await kv('guard'), await kv('strategyResults'), await kv('strategyModes')];
    const state = {
      updatedAt: new Date(this.now()).toISOString(), account, positions, risk: this.risk || null,
      universe: universe ? { ts: universe.ts, source: universe.source, coins: universe.coins.map((c) => c.coin) } : null,
      guard: guard ? { ts: guard.ts, notTradable: Object.entries(guard.coins || {}).filter(([, v]) => !v.tradable).map(([k, v]) => `${k}: ${v.reasons.join(',')}`) } : null,
      agents: this.hb, strategyResults: results, strategyModes: strategyModes || {},
    };
    writeAtomic(path.join(this.dir, 'state.json'), JSON.stringify(state, null, 1));
    writeAtomic(path.join(this.dir, 'ideas.jsonl'), this.ideas.map((i) => JSON.stringify(i)).join('\n') + '\n');
    this.append('trades.jsonl', this.buf.trades.splice(0)); this.append('shadow.jsonl', this.buf.shadow.splice(0)); this.append('decisions.jsonl', this.buf.decisions.splice(0)); this.append('costs.jsonl', this.buf.costs.splice(0));
    writeAtomic(path.join(this.dir, 'summary.md'), this.summary(state));
    if (!this.token) { this.setStatus('degraded', 'no GITHUB_TOKEN: state written locally only'); return; }
    try {
      this.git(['add', '-A']);
      try { this.git(['commit', '-q', '-m', `swarm state ${state.updatedAt}`]); } catch (e) { /* nothing new */ }
      try { this.git(['pull', '-q', '--rebase', '-X', 'ours', 'origin', this.Y.branch]); } catch (e) { /* first push */ }
      this.git(['push', '-q', 'origin', `HEAD:${this.Y.branch}`]);
      this.count('pushes'); this.setStatus('ok');
      await this.readControl();
    } catch (e) { this.error('git push', e); }
  }
  async readControl() {
    const c = readJSON(path.join(this.dir, 'control.json'));
    if (!c || !c.id || c.id === this.lastControl) return;
    this.lastControl = c.id;
    for (const cmd of c.commands || []) if (['strategy-mode', 'pause', 'flatten', 'note'].includes(cmd.cmd)) await this.publish('sys.command', Object.assign({ by: c.by || 'supervisor' }, cmd));
  }
  summary(s) {
    const a = s.account || {}, p = s.positions || { open: [], working: [] };
    const L = [`# Swarm — live status`, '', `Updated ${s.updatedAt} · account **${(a.mode || 'paper').toUpperCase()}** · risk mode ${s.risk ? s.risk.mode : '—'}`, ''];
    L.push(`Equity $${a.equity} (start $${a.equity0}) · today ${a.dayPnlPct != null ? (a.dayPnlPct * 100).toFixed(2) : '—'}% · drawdown ${a.dd != null ? (a.dd * 100).toFixed(1) : '—'}% · ${a.trades || 0} trades · fees $${a.fees} · funding $${a.funding}`, '');
    L.push(`Open: ${p.open.map((x) => `${x.side > 0 ? '+' : '−'}${x.coin} (${x.strategies.join('+')})`).join(', ') || 'none'} · working orders: ${p.working.length}`, '');
    L.push('| Agent | Status | Note |', '|---|---|---|');
    for (const [k, v] of Object.entries(s.agents).sort()) L.push(`| ${k} | ${v.status} | ${(v.why || '').slice(0, 100)} |`);
    if (s.guard && s.guard.notTradable.length) L.push('', `Not tradable now: ${s.guard.notTradable.join('; ')}`);
    return L.join('\n') + '\n';
  }
}

module.exports = { StateSync };
