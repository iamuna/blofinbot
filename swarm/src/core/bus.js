/* The message bus every agent talks through (the "Messenger").
 *
 *   bus.publish(type, data, {src, trace, ts})       → message id
 *   bus.subscribe(['md.bar', 'ref.*'], handler, {group, durable, from})  → {stop()}
 *   bus.kv.get(key) / bus.kv.set(key, value)       small shared state (universe, mode, guard summary)
 *
 * Two backends with the same behaviour:
 *   RedisBus  — production: one Redis Stream per message type, each agent may run in its own process.
 *               durable subscribers use a consumer group, so after a restart they receive what they missed.
 *   MemoryBus — tests, replays and backtests: everything in one process, deterministic, with drain().
 * Each subscriber handles its messages one at a time and in order. A handler that throws does not stop the
 * subscriber: the message goes to the dead-letter type `sys.dead` with the error.
 */
'use strict';
const os = require('os');
const { Redis, parseXread } = require('./resp');
const S = require('./schemas');
const A = require('./auth');

let seq = 0;
const rnd = () => Math.random().toString(36).slice(2, 6);
function newId(ts) { seq = (seq + 1) % 1679616; return `${ts.toString(36)}-${seq.toString(36)}-${rnd()}`; }
function envelope(type, data, meta, now, key) {
  const ts = meta.ts || now();
  const id = newId(ts);
  const m = { v: 1, id, type, ts, src: meta.src || 'unknown', trace: meta.trace || id, data };
  if (key && A.SIGNED.has(type)) m.sig = A.sign(key, m); // core/auth.js: authority messages are signed
  return m;
}

// per-subscriber serial queue: handler(m) runs for one message at a time, in arrival order
class Lane {
  constructor(handler, onError) { this.h = handler; this.onError = onError; this.q = []; this.busy = null; this.stopped = false; }
  push(m) { if (this.stopped) return; this.q.push(m); if (!this.busy) this.busy = this.run(); }
  async run() {
    await null; // always continue asynchronously, so `busy` is set before run() can finish
    while (this.q.length && !this.stopped) {
      const m = this.q.shift();
      try { await this.h(m); } catch (e) { this.onError(m, e); }
    }
    this.busy = null;
  }
  idle() { return this.busy || Promise.resolve(); }
}

class MemoryBus {
  constructor(o = {}) {
    this.now = o.now || Date.now; this.keepN = o.keep || 20000; this.validate = o.validate !== false; this.signKey = o.key || null;
    this.subs = new Set(); this.hist = new Map(); this.store = new Map(); this.stats = { published: {}, dead: 0 };
    this.kv = { get: async (k) => (this.store.has(k) ? JSON.parse(this.store.get(k)) : null), set: async (k, v) => { this.store.set(k, JSON.stringify(v)); }, del: async (k) => { this.store.delete(k); } };
  }
  async publish(type, data, meta = {}) {
    if (this.validate) S.check(type, data);
    const m = envelope(type, data, meta, this.now, meta.key === undefined ? this.signKey : meta.key);
    let h = this.hist.get(type); if (!h) this.hist.set(type, (h = []));
    h.push(m); if (h.length > this.keepN) h.splice(0, h.length - this.keepN);
    this.stats.published[type] = (this.stats.published[type] || 0) + 1;
    for (const s of this.subs) if (s.patterns.some((p) => S.matches(p, type))) s.lane.push(m);
    return m.id;
  }
  subscribe(patterns, handler, o = {}) {
    patterns = [].concat(patterns); S.expand(patterns); // throws on unknown types
    const sub = { patterns, lane: new Lane(handler, (m, e) => this._dead(o.group || 'anon', m, e)) };
    if (o.from === '0') { // replay what the bus still holds, in time order
      const old = []; for (const [t, h] of this.hist) if (patterns.some((p) => S.matches(p, t))) old.push(...h);
      old.sort((a, b) => a.ts - b.ts); for (const m of old) sub.lane.push(m);
    }
    this.subs.add(sub);
    return { stop: () => { sub.lane.stopped = true; this.subs.delete(sub); } };
  }
  _dead(agent, m, e) {
    this.stats.dead++;
    if (m.type === 'sys.dead') return;
    this.publish('sys.dead', { agent, type: m.type, id: m.id, error: String(e && e.stack ? e.stack : e).slice(0, 2000) }, { src: 'bus' }).catch(() => {});
  }
  // resolves when every subscriber has handled everything published so far (and what that caused)
  async drain() {
    for (let k = 0; k < 1000; k++) {
      const busy = [...this.subs].filter((s) => s.lane.busy || s.lane.q.length);
      if (!busy.length) return;
      await Promise.all(busy.map((s) => s.lane.idle()));
      await new Promise((r) => setImmediate(r));
    }
    throw new Error('bus did not drain');
  }
  async close() { for (const s of this.subs) s.lane.stopped = true; this.subs.clear(); }
}

class RedisBus {
  constructor(o = {}) {
    this.url = o.url || 'redis://127.0.0.1:6379'; this.prefix = o.prefix || 'sw'; this.now = o.now || Date.now; this.validate = o.validate !== false; this.signKey = o.key || null;
    this.cmd = new Redis({ url: this.url, name: `${this.prefix}-cmd-${process.pid}` });
    this.readers = new Set(); this.stats = { published: {}, dead: 0, readErrors: 0 };
    this.kv = {
      get: async (k) => { const v = await this.cmd.call('GET', `${this.prefix}:kv:${k}`); return v == null ? null : JSON.parse(v); },
      set: async (k, v) => { await this.cmd.call('SET', `${this.prefix}:kv:${k}`, JSON.stringify(v)); },
      del: async (k) => { await this.cmd.call('DEL', `${this.prefix}:kv:${k}`); },
    };
  }
  key(type) { return `${this.prefix}:s:${type}`; }
  async connect() { await this.cmd.connect(); await this.cmd.call('PING'); return this; }
  async publish(type, data, meta = {}) {
    if (this.validate) S.check(type, data);
    const m = envelope(type, data, meta, this.now, this.signKey);
    await this.cmd.call('XADD', this.key(type), 'MAXLEN', '~', S.keep(type), '*', 'm', JSON.stringify(m));
    this.stats.published[type] = (this.stats.published[type] || 0) + 1;
    return m.id;
  }
  subscribe(patterns, handler, o = {}) {
    const types = S.expand(patterns), keys = types.map((t) => this.key(t));
    const group = o.group || 'anon', durable = !!o.durable, count = o.count || 300, block = o.block || 2000;
    const consumer = o.consumer || `${group}-${os.hostname()}-${process.pid}`;
    const r = new Redis({ url: this.url, name: `${this.prefix}-rd-${group}` });
    const lane = new Lane(handler, (m, e) => this._dead(group, m, e));
    const state = { stopped: false };
    this.readers.add(r);
    const deliver = async (reply, ackable) => {
      const batch = [];
      for (const { stream, entries } of parseXread(reply)) for (const [id, f] of entries) {
        let m = null; try { m = JSON.parse(f.m); } catch (e) { /* skip garbage */ }
        batch.push({ stream, id, m });
      }
      batch.sort((a, b) => (a.m && b.m ? a.m.ts - b.m.ts : 0));
      for (const x of batch) if (x.m) lane.push(x.m);
      await lane.idle();
      if (ackable && batch.length) {
        const by = {}; for (const x of batch) (by[x.stream] = by[x.stream] || []).push(x.id);
        await Promise.all(Object.entries(by).map(([k, ids]) => r.call('XACK', k, group, ...ids)));
      }
      return batch;
    };
    const loop = async () => {
      await r.connect();
      if (durable) {
        for (const k of keys) { try { await r.call('XGROUP', 'CREATE', k, group, o.from === '0' ? '0' : '$', 'MKSTREAM'); } catch (e) { if (!/BUSYGROUP/.test(e.message)) throw e; } }
        // first whatever this consumer received but never acknowledged (a crash mid-batch), then new messages
        let pending = true;
        while (!state.stopped) {
          try {
            const reply = await r.call('XREADGROUP', 'GROUP', group, consumer, 'COUNT', count, ...(pending ? [] : ['BLOCK', block]), 'STREAMS', ...keys, ...keys.map(() => (pending ? '0' : '>')));
            const got = await deliver(reply, true);
            if (pending && !got.length) pending = false;
          } catch (e) { if (state.stopped) break; this.stats.readErrors++; await sleep(500); }
        }
      } else {
        // start after the newest message ('$' resolved to a real id, so nothing published between reads is missed)
        const last = {};
        for (const k of keys) {
          if (o.from === '0') { last[k] = '0'; continue; }
          const top = await r.call('XREVRANGE', k, '+', '-', 'COUNT', 1);
          last[k] = top && top.length ? top[0][0] : '0-0';
        }
        while (!state.stopped) {
          try {
            const reply = await r.call('XREAD', 'COUNT', count, 'BLOCK', block, 'STREAMS', ...keys, ...keys.map((k) => last[k]));
            for (const { stream, entries } of parseXread(reply)) if (entries.length) last[stream] = entries[entries.length - 1][0];
            await deliver(reply, false);
          } catch (e) { if (state.stopped) break; this.stats.readErrors++; await sleep(500); }
        }
      }
    };
    const done = loop().catch((e) => { this.stats.readErrors++; if (o.onError) o.onError(e); });
    return { stop: async () => { state.stopped = true; lane.stopped = true; this.readers.delete(r); await r.quit(); await done; }, done };
  }
  _dead(agent, m, e) {
    this.stats.dead++;
    if (m.type === 'sys.dead') return;
    this.publish('sys.dead', { agent, type: m.type, id: m.id, error: String(e && e.stack ? e.stack : e).slice(0, 2000) }, { src: 'bus' }).catch(() => {});
  }
  // messages of one type between two times (ms), oldest first — for replays and reports
  async range(type, fromMs, toMs, max = 100000) {
    const rows = await this.cmd.call('XRANGE', this.key(type), fromMs == null ? '-' : String(fromMs), toMs == null ? '+' : String(toMs), 'COUNT', max);
    return (rows || []).map(([, kv]) => JSON.parse(kv[1]));
  }
  async close() { for (const r of this.readers) await r.quit(); this.readers.clear(); await this.cmd.quit(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createBus(o = {}) {
  if ((o.kind || 'memory') === 'memory') return new MemoryBus(o);
  return new RedisBus(o).connect();
}

module.exports = { MemoryBus, RedisBus, createBus, envelope, newId };
