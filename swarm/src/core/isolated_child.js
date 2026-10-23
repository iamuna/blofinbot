/* The child side of an isolated agent (core/isolate.js): checks its own lock-down, then runs the agent on a bus
 * that is only a pipe to the host. Started by the host with Node's permission flags; never run by hand.
 */
'use strict';
const path = require('path');
const { Lane } = require('./bus');
const S = require('./schemas');

const send = (x) => { if (process.connected) process.send(x); };
// exit only after the host has the message (process.send is asynchronous)
const sendAndExit = (x, code) => { if (!process.connected) process.exit(code); process.send(x, () => process.exit(code)); };

class ChildBus {
  constructor() {
    this.subs = new Map(); this.seq = 0; this.kvSeq = 0; this.kvWait = new Map();
    this.kv = {
      get: (key) => new Promise((resolve) => { const id = ++this.kvSeq; this.kvWait.set(id, resolve); send({ op: 'kvget', id, key }); }),
      set: async (key, value) => { send({ op: 'kvset', key, value }); },
      del: async () => { throw new Error('kv.del is not available to an isolated agent'); },
    };
  }
  async publish(type, data, meta = {}) { S.check(type, data); send({ op: 'pub', type, data, trace: meta.trace }); return null; }
  subscribe(patterns, handler) {
    patterns = [].concat(patterns); S.expand(patterns); // throws on unknown types, like the real bus
    const id = ++this.seq, lane = new Lane(handler, (m, e) => console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', agent: 'isolated', msg: `handler failed on ${m.type}: ${e && e.message}` })));
    this.subs.set(id, lane);
    send({ op: 'sub', id, patterns });
    return { stop: async () => { lane.stopped = true; this.subs.delete(id); send({ op: 'unsub', id }); } };
  }
  onMessage(msg) {
    if (msg.op === 'msg') { const lane = this.subs.get(msg.sid); if (lane) lane.push(msg.m); }
    else if (msg.op === 'kv') { const r = this.kvWait.get(msg.id); if (r) { this.kvWait.delete(msg.id); r(msg.value); } }
  }
}

// the lock-down the host asked for must really be there before any agent code is loaded
function lockdownProblems(deny) {
  const P = process.permission;
  if (!P) return ['Node permission model is not active (needs Node 22.13+)'];
  const out = [];
  if (P.has('child')) out.push('may start programs');
  if (P.has('worker')) out.push('may start threads');
  for (const d of deny) if (P.has('fs.read', d)) out.push(`may read ${d}`);
  for (const k of ['GITHUB_TOKEN', 'TELEGRAM_BOT_TOKEN', 'BLOFIN_API_KEY', 'BLOFIN_API_SECRET', 'BLOFIN_PASSPHRASE', 'SWARM_BUS_KEY_FILE']) if (process.env[k]) out.push(`has ${k}`);
  return out;
}

let agent = null, bus = null;
process.on('message', async (msg) => {
  try {
    if (msg.op === 'init') {
      const bad = lockdownProblems(msg.deny || []);
      if (bad.length) return sendAndExit({ op: 'fatal', why: `isolation incomplete: ${bad.join('; ')}` }, 3);
      bus = new ChildBus();
      const C = msg.module ? require(path.resolve(msg.module.file))[msg.module.export] : require('../run').REGISTRY[msg.name](msg.cfg);
      agent = new C({ bus, cfg: msg.cfg, dataDir: null, busKey: null }, { name: msg.name });
      await agent.start();
      send({ op: 'ready' });
    } else if (msg.op === 'stop') {
      if (agent) await agent.stop();
      process.exit(0);
    } else if (bus) bus.onMessage(msg);
  } catch (e) {
    sendAndExit({ op: 'fatal', why: `${msg && msg.op}: ${e && e.message}` }, 4);
  }
});
process.on('disconnect', () => process.exit(0)); // the host is gone
process.on('unhandledRejection', (e) => console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', agent: 'isolated', msg: `unhandled rejection: ${e && e.message}` })));
