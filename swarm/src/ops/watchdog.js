/* Ops watchdog: notices when an agent stops reporting, the disk fills up or memory runs short, and tells the
 * Herald (sys.alert). Restarting dead processes is systemd's job; the watchdog makes sure someone hears about it.
 * Expected agents = every agent in the configured groups (cfg.watch.groups, default all groups).
 */
'use strict';
const fs = require('fs'), os = require('os');
const { Agent } = require('../core/agent');

class Watchdog extends Agent {
  static agentName = 'watchdog';
  async onStart() {
    this.W = Object.assign({ silentMs: 90000, diskMinFreePct: 10, memMinFreeMb: 300, groups: null }, this.cfg.watch || {});
    const groups = this.W.groups || Object.keys(this.cfg.groups || {});
    this.expected = new Set(groups.flatMap((g) => (this.cfg.groups || {})[g] || []).filter((a) => a !== this.name));
    this.seen = new Map(); this.down = new Set(); this.started = this.now();
    this.subscribe('sys.heartbeat', (m) => this.onBeat(m.data));
    this.every(15000, () => this.check());
  }
  onBeat(h) {
    this.seen.set(h.agent, { t: this.now(), status: h.status, why: h.why });
    if (this.down.has(h.agent)) { this.down.delete(h.agent); this.publish('sys.alert', { text: `${h.agent} is back`, key: `up:${h.agent}`, everyMs: 0 }).catch(() => {}); }
  }
  async check() {
    const t = this.now();
    for (const a of this.expected) {
      const s = this.seen.get(a), last = s ? s.t : this.started;
      if (t - last > this.W.silentMs && !this.down.has(a)) { this.down.add(a); await this.publish('sys.alert', { text: `${a} has not reported for ${Math.round((t - last) / 1000)} s`, key: `down:${a}` }); }
    }
    for (const [a, s] of this.seen) if (s.status === 'degraded' && t - s.t < 30000) await this.publish('sys.alert', { text: `${a} degraded: ${s.why}`, key: `degraded:${a}:${s.why}`, everyMs: 3600000 });
    try {
      const st = fs.statfsSync(this.ctx.dataDir), freePct = (st.bavail / st.blocks) * 100;
      this.gauge('diskFreePct', +freePct.toFixed(1));
      if (freePct < this.W.diskMinFreePct) await this.publish('sys.alert', { text: `disk ${freePct.toFixed(1)}% free on the data drive`, key: 'disk', everyMs: 3600000 });
    } catch (e) { /* statfs not available */ }
    const freeMb = os.freemem() / 1048576; this.gauge('memFreeMb', Math.round(freeMb)); this.gauge('memTotalMb', Math.round(os.totalmem() / 1048576)); this.gauge('rssMb', Math.round(process.memoryUsage().rss / 1048576)); // rss: this process (on Windows, the whole swarm)
    if (freeMb < this.W.memMinFreeMb) await this.publish('sys.alert', { text: `only ${Math.round(freeMb)} MB of memory free`, key: 'mem', everyMs: 3600000 });
    this.gauge('down', [...this.down].join(',') || 'none');
  }
}

module.exports = { Watchdog };
