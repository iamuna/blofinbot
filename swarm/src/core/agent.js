/* Base class for every swarm agent.
 *
 * An agent has a name, talks only through the bus, and reports a heartbeat (status + metrics) every 10 s so the
 * watchdog and the reviewer can see it. Subclasses implement onStart()/onStop() and react to messages.
 * Timers and handlers never throw out of the agent: errors are counted, logged and published as sys.log.
 */
'use strict';
const auth = require('./auth');

function makeLogger(name, sink) {
  const out = sink || ((line) => process.stdout.write(line + '\n'));
  const emit = (level, msg, extra) => {
    const rec = { t: new Date().toISOString(), level, agent: name, msg: typeof msg === 'string' ? msg : String(msg) };
    if (extra !== undefined) rec.extra = extra instanceof Error ? String(extra.stack || extra) : extra;
    out(JSON.stringify(rec));
  };
  return { debug: (m, x) => (process.env.SWARM_DEBUG ? emit('debug', m, x) : null), info: (m, x) => emit('info', m, x), warn: (m, x) => emit('warn', m, x), error: (m, x) => emit('error', m, x) };
}

class Agent {
  constructor(ctx, opts = {}) {
    this.ctx = ctx; this.bus = ctx.bus; this.cfg = ctx.cfg || {}; this.opts = opts;
    this.name = opts.name || this.constructor.agentName || this.constructor.name;
    this.now = ctx.now || Date.now;
    this.log = (ctx.logger || makeLogger)(this.name, ctx.logSink);
    this.timers = []; this.subs = []; this.metrics = {}; this.status = 'starting'; this.statusWhy = '';
    this.startedAt = this.now(); this.lastLogPub = {};
  }
  async start() {
    await this.onStart();
    if (this.status === 'starting') this.status = 'ok';
    if (this.ctx.heartbeats !== false) { this.every(this.cfg.heartbeatMs || 10000, () => this.heartbeat()); await this.heartbeat(); }
    this.log.info('started');
    return this;
  }
  async stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const s of this.subs) { try { await s.stop(); } catch (e) { /* ignore */ } }
    this.subs = [];
    await this.onStop();
    this.status = 'stopped';
  }
  async onStart() {}
  async onStop() {}

  publish(type, data, meta) { return this.bus.publish(type, data, Object.assign({ src: this.name }, meta)); }
  subscribe(patterns, fn, o) {
    // with a bus key (trusted groups in production), order/command/account/… messages must carry a valid signature
    const key = this.ctx.busKey;
    const handler = key ? (m) => {
      if (auth.SIGNED.has(m.type) && !auth.verify(key, m)) { this.count('unsignedDropped'); this.warn(`dropped an unsigned ${m.type} from ${m.src}`); return; }
      return fn.call(this, m);
    } : (m) => fn.call(this, m);
    const s = this.bus.subscribe(patterns, handler, Object.assign({ group: this.name }, o));
    this.subs.push(s);
    return s;
  }
  every(ms, fn) {
    const t = setInterval(() => { Promise.resolve().then(() => fn.call(this)).catch((e) => this.error('timer', e)); }, ms);
    if (t.unref && this.ctx.unrefTimers) t.unref();
    this.timers.push(t);
    return t;
  }
  count(k, n = 1) { this.metrics[k] = (this.metrics[k] || 0) + n; }
  gauge(k, v) { this.metrics[k] = v; }
  setStatus(status, why = '') {
    if (status === this.status && why === this.statusWhy) return;
    this.log[status === 'ok' ? 'info' : 'warn'](`status ${this.status} → ${status}${why ? ': ' + why : ''}`);
    this.status = status; this.statusWhy = why;
  }
  heartbeat() {
    return this.publish('sys.heartbeat', { agent: this.name, pid: process.pid, status: this.status, why: this.statusWhy, startedAt: this.startedAt, metrics: this.metrics }).catch((e) => this.log.warn('heartbeat failed', e.message));
  }
  // warnings and errors also go on the bus (at most once a minute per message text)
  warn(msg, extra) { this.log.warn(msg, extra); this._pubLog('warn', msg); }
  error(where, e) {
    this.count('errors');
    const msg = `${where}: ${e && e.message ? e.message : e}`;
    this.log.error(msg, e && e.stack ? e.stack : undefined);
    this._pubLog('error', msg);
  }
  _pubLog(level, msg) {
    const t = this.now(), k = level + msg;
    if (this.lastLogPub[k] && t - this.lastLogPub[k] < 60000) return;
    this.lastLogPub[k] = t;
    this.publish('sys.log', { agent: this.name, level, msg: String(msg).slice(0, 500) }).catch(() => {});
  }
}

module.exports = { Agent, makeLogger };
