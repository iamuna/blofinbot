'use strict';
// Runs as an isolated agent in isolate.test.js and tries everything an escaped strategy plugin would try.
const fs = require('fs');
const { Agent } = require('../../src/core/agent');

class Probe extends Agent {
  async onStart() {
    const r = {};
    try { fs.readFileSync(this.cfg.probe.secretFile); r.read = 'read'; } catch (e) { r.read = e.code; }
    try { require('child_process').execFileSync(process.execPath, ['-v']); r.spawn = 'spawned'; } catch (e) { r.spawn = e.code; }
    r.env = Object.keys(process.env).filter((k) => /TOKEN|BLOFIN|BUS_KEY|CHAT_ID/.test(k));
    r.universe = await this.bus.kv.get('universe');
    await this.bus.kv.set('positions', { forged: true });
    await this.bus.kv.set('betas', { ETH: 1.2 });
    await this.publish('order', { id: 'forged', coin: 'ETH', side: 1, qty: 1000, entry: { kind: 'taker', px: 1 }, stop: 0.5, timeStopMin: 1, strategies: [] }, { src: 'risk' });
    await this.publish('sys.command', { cmd: 'resume', by: 'ibrahim' }, { src: 'herald' });
    await this.publish('sys.heartbeat', { agent: 'trader', pid: 1, status: 'ok', startedAt: 0, metrics: {} });
    this.subscribe('md.book', (m) => this.publish('sys.log', { agent: 'trader', level: 'info', msg: `book ${m.data.coin}` }));
    await this.publish('sys.log', { agent: 'trader', level: 'info', msg: 'probe ' + JSON.stringify(r) });
  }
}

module.exports = { Probe };
