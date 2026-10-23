/* Isolated agents: an agent that runs in its own Node process, locked down, behind a bridge to the bus.
 *
 * On the Windows PC every agent shares one process and the in-memory bus, so the brain — where the strategy plugins
 * run, code the Claude agents write — would share the process that holds the tokens and the bus key. With
 * `--isolate brain` (run.ps1 passes it) the brain runs in a child process instead, the same split the Linux install
 * makes with its own user for the brain group:
 *   - Node's permission model: it may read only swarm/src (not secrets.json, bus.key, blofin-demo.json, the config
 *     or the data folder, whose state repo holds the GitHub token), and may not start programs or threads;
 *   - an environment without tokens or keys (ENV_KEEP only);
 *   - the bridge forwards the messages it subscribes to, and lets through only what it may say (RULES: never an
 *     order, command, account or position message), always under its own name. kv: it reads any key, writes only
 *     its own (the brain: betas; the trend sleeve: sleeve:trend).
 * The trend sleeve (src/sleeve/agent.js) runs the same way (`--isolate brain,trend-sleeve`).
 * The child checks its own lock-down before it starts the agent; if the lock-down is missing it stops and the host
 * reports it (the strategies stay off rather than running with the keys in reach). A child that dies is restarted.
 */
'use strict';
const cp = require('child_process'), path = require('path'), fs = require('fs');
const { Agent } = require('./agent');
const auth = require('./auth');

const RULES = {
  brain: { types: ['idea', 'feat.bar', 'regime.state', 'shadow.trade', 'shadow.end', 'sys.heartbeat', 'sys.log'], kvSet: ['betas'] },
  // the trend sleeve asks (sleeve.target) and reports (sleeve.state); the risk agent decides (docs/TREND_SLEEVE_DESIGN.md)
  'trend-sleeve': { types: ['sleeve.target', 'sleeve.state', 'sys.heartbeat', 'sys.log'], kvSet: ['sleeve:trend'] },
};
const ENV_KEEP = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'TZ', 'SWARM_DEBUG'];
const SRC = path.join(__dirname, '..');

// --permission is the stable name from Node 22.13 / 23.5 on
function permissionFlag(v = process.versions.node) {
  const [a, b] = v.split('.').map(Number);
  return a > 23 || (a === 23 && b >= 5) || (a === 22 && b >= 13) ? '--permission' : '--experimental-permission';
}
function cleanEnv(env) { const out = {}; for (const k of ENV_KEEP) if (env[k] !== undefined) out[k] = env[k]; return out; }

class IsolatedAgent extends Agent {
  // opts: name (the agent to isolate), plus for tests: module {file, export}, rules, allowRead [extra dirs]
  constructor(ctx, opts = {}) {
    super(ctx, Object.assign({}, opts, { name: `${opts.name}-host` }));
    this.target = opts.name; this.rules = opts.rules || RULES[opts.name];
    if (!this.rules) throw new Error(`no isolation rules for agent ${opts.name}`);
    for (const t of this.rules.types) if (auth.SIGNED.has(t)) throw new Error(`an isolated agent may not send ${t}`);
    this.module = opts.module || null; this.allowRead = [SRC, ...(opts.allowRead || [])];
    this.restartMs = opts.restartMs || 10000;
  }
  async onStart() {
    this.bridgeSubs = new Map(); this.stopping = false; this.restarts = 0;
    await this.spawn();
  }
  async onStop() {
    this.stopping = true; clearTimeout(this.restartTimer);
    const c = this.child;
    if (!c || c.exitCode !== null || c.signalCode !== null) { this.dropSubs(); return; }
    const gone = new Promise((r) => c.once('exit', r));
    if (c.connected) c.send({ op: 'stop' });
    const t = setTimeout(() => c.kill(), 8000);
    await gone; clearTimeout(t);
    this.dropSubs();
  }
  dropSubs() { for (const s of this.bridgeSubs.values()) { try { s.stop(); } catch (e) { /* ignore */ } } this.bridgeSubs.clear(); }

  spawn() {
    const execArgv = [permissionFlag(), ...this.allowRead.map((d) => `--allow-fs-read=${d}`)];
    if (process.allowedNodeEnvironmentFlags.has('--allow-net')) execArgv.push('--allow-net'); // Node versions that also gate the network
    const child = cp.fork(path.join(__dirname, 'isolated_child.js'), [], { execArgv, env: cleanEnv(process.env), stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    this.child = child;
    // the config without anything secret-looking; the child cannot read the files it came from
    const cfg = Object.assign({}, this.cfg); delete cfg.herald;
    // the hard limits (not secret) for agents that size against them; the child cannot read config/
    try { cfg.riskLimits = JSON.parse(fs.readFileSync(this.ctx.riskFile || path.join(SRC, '..', 'config', 'risk.json'), 'utf8')); } catch (e) { /* the agent reports it */ }
    const deny = [path.join(SRC, '..', 'config'), this.ctx.dataDir].filter(Boolean);
    return new Promise((resolve) => {
      let ready = false;
      child.on('message', (msg) => {
        if (msg && msg.op === 'ready') { ready = true; this.setStatus('ok'); this.gauge('childPid', child.pid); resolve(); return; }
        if (msg && msg.op === 'fatal') { this.fatal = msg.why; this.setStatus('degraded', msg.why); this.error(`${this.target} not started`, new Error(msg.why)); return; }
        this.onChild(msg).catch((e) => this.error('bridge', e));
      });
      child.on('exit', (code) => {
        this.dropSubs();
        if (!ready) resolve();
        if (this.stopping) return;
        if (this.fatal) return; // its lock-down failed: restarting would only fail again
        this.count('childExits'); this.setStatus('degraded', `${this.target} process exited (code ${code}); restarting`);
        this.error(this.target, new Error(`process exited with code ${code}; restarting in ${Math.round(this.restartMs / 1000)} s`));
        this.restartTimer = setTimeout(() => { this.restarts++; this.spawn(); }, this.restartMs);
      });
      child.send({ op: 'init', name: this.target, module: this.module, cfg, deny });
    });
  }

  async onChild(msg) {
    const c = this.child;
    const reply = (x) => { if (c.connected) c.send(x); };
    if (!msg || typeof msg !== 'object') return;
    if (msg.op === 'sub') {
      const s = this.bus.subscribe(msg.patterns, (m) => reply({ op: 'msg', sid: msg.id, m }), { group: `${this.target}:${msg.id}` });
      this.bridgeSubs.set(msg.id, s);
    } else if (msg.op === 'unsub') {
      const s = this.bridgeSubs.get(msg.id); if (s) { this.bridgeSubs.delete(msg.id); await s.stop(); }
    } else if (msg.op === 'pub') {
      const data = msg.data;
      if (!this.rules.types.includes(msg.type)) return this.refuse(`${msg.type} message`);
      if (msg.type === 'sys.heartbeat' && !(data && (data.agent === this.target || String(data.agent).startsWith('strategy:')))) return this.refuse(`heartbeat for ${data && data.agent}`);
      if (msg.type === 'sys.log' && data) data.agent = this.target;
      try { await this.bus.publish(msg.type, data, { src: this.target, trace: msg.trace, key: null }); this.count('forwarded'); } catch (e) { this.refuse(`invalid ${msg.type}: ${e.message}`); }
    } else if (msg.op === 'kvget') {
      reply({ op: 'kv', id: msg.id, value: await this.bus.kv.get(String(msg.key)).catch(() => null) });
    } else if (msg.op === 'kvset') {
      if (!this.rules.kvSet.includes(msg.key)) return this.refuse(`kv write to ${msg.key}`);
      await this.bus.kv.set(msg.key, msg.value);
    }
  }
  refuse(what) { this.count('refused'); this.warn(`${this.target}: refused ${what}`); }
}

module.exports = { IsolatedAgent, RULES, ENV_KEEP, permissionFlag, cleanEnv };
