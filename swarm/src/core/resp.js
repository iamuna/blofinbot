/* Minimal Redis client (RESP2) with no dependencies.
 *
 * Enough for the swarm bus: commands, pipelining, automatic reconnect with backoff. One connection per client;
 * blocking commands (XREAD/XREADGROUP BLOCK) need their own client so they never hold up ordinary commands.
 * Commands sent while disconnected wait in a bounded queue and go out on reconnect; commands that were in flight
 * when the socket dropped are rejected (the caller decides whether a retry is safe).
 */
'use strict';
const net = require('net');
const { EventEmitter } = require('events');

class RedisError extends Error { constructor(msg) { super(msg); this.name = 'RedisError'; } }

const CRLF = Buffer.from('\r\n');
function encode(args) {
  const parts = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
    parts.push(Buffer.from(`$${b.length}\r\n`), b, CRLF);
  }
  return Buffer.concat(parts);
}

// Incremental RESP2 parser. parse() returns {value, end} or undefined when the reply is not complete yet.
class Parser {
  constructor(onReply) { this.buf = null; this.onReply = onReply; }
  push(chunk) {
    this.buf = this.buf && this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const r = this.parse(0);
      if (!r) break;
      this.buf = this.buf.subarray(r.end);
      this.onReply(r.value);
      if (!this.buf.length) break;
    }
  }
  parse(i) {
    const b = this.buf;
    if (!b || i >= b.length) return undefined;
    const nl = b.indexOf(CRLF, i);
    if (nl < 0) return undefined;
    const line = b.toString('utf8', i + 1, nl);
    switch (b[i]) {
      case 43: return { value: line, end: nl + 2 }; // +
      case 45: return { value: new RedisError(line), end: nl + 2 }; // -
      case 58: return { value: Number(line), end: nl + 2 }; // :
      case 36: { // $ bulk string
        const n = Number(line);
        if (n < 0) return { value: null, end: nl + 2 };
        if (b.length < nl + 2 + n + 2) return undefined;
        return { value: b.toString('utf8', nl + 2, nl + 2 + n), end: nl + 4 + n };
      }
      case 42: { // * array
        const n = Number(line);
        if (n < 0) return { value: null, end: nl + 2 };
        const out = new Array(n);
        let p = nl + 2;
        for (let k = 0; k < n; k++) { const r = this.parse(p); if (!r) return undefined; out[k] = r.value; p = r.end; }
        return { value: out, end: p };
      }
      default: throw new RedisError(`RESP: unexpected type byte ${b[i]}`);
    }
  }
}

function parseUrl(url) {
  const u = new URL(url || 'redis://127.0.0.1:6379');
  return { host: u.hostname || '127.0.0.1', port: +(u.port || 6379), password: u.password ? decodeURIComponent(u.password) : null, db: u.pathname && u.pathname.length > 1 ? +u.pathname.slice(1) : 0 };
}

class Redis extends EventEmitter {
  constructor(opts = {}) {
    super();
    const o = typeof opts === 'string' ? parseUrl(opts) : Object.assign(parseUrl(opts.url), opts);
    this.o = o; this.name = opts.name || null;
    this.sock = null; this.ready = false; this.closing = false; this.started = false;
    this.inflight = []; this.queue = []; this.maxQueue = opts.maxQueue || 10000;
    this.backoff = 100;
    this.on('error', () => {}); // errors are reported through rejected commands; listeners may add logging
  }
  // resolves once connected (or when the client is closed)
  connect() {
    if (!this.started) { this.started = true; this._attempt(); }
    if (this.ready || this.closing) return Promise.resolve();
    return new Promise((resolve) => { const done = () => { this.off('ready', done); this.off('end', done); resolve(); }; this.on('ready', done); this.on('end', done); });
  }
  _attempt() {
    if (this.closing) return;
    const sock = net.createConnection({ host: this.o.host, port: this.o.port });
    sock.setNoDelay(true);
    const parser = new Parser((v) => this._reply(v));
    let opened = false;
    sock.on('connect', async () => {
      opened = true; this.sock = sock; this.backoff = 100;
      try { // handshake goes straight out; user commands keep waiting in the queue until ready
        if (this.o.password) await this._raw(['AUTH', this.o.password]);
        if (this.o.db) await this._raw(['SELECT', this.o.db]);
        if (this.name) await this._raw(['CLIENT', 'SETNAME', this.name]);
      } catch (e) { this.emit('error', e); }
      if (this.sock !== sock) return; // dropped during the handshake
      this.ready = true;
      const q = this.queue; this.queue = [];
      for (const c of q) this._send(c);
      this.emit('ready');
    });
    sock.on('data', (d) => { try { parser.push(d); } catch (e) { this.emit('error', e); sock.destroy(); } });
    sock.on('error', (e) => this.emit(opened ? 'error' : 'connect-error', e));
    sock.on('close', () => {
      const wasReady = this.ready;
      this.ready = false; if (this.sock === sock) this.sock = null;
      const lost = this.inflight; this.inflight = [];
      for (const c of lost) c.reject(new RedisError('connection lost'));
      if (this.closing) { this.emit('end'); return; }
      if (wasReady) this.emit('reconnecting');
      setTimeout(() => this._attempt(), this.backoff);
      this.backoff = Math.min(5000, this.backoff * 2);
    });
  }
  _raw(args) { return new Promise((resolve, reject) => { const c = { args, resolve, reject }; this.inflight.push(c); this.sock.write(encode(args)); }); }
  _send(c) { this.inflight.push(c); this.sock.write(encode(c.args)); }
  _reply(v) {
    const c = this.inflight.shift();
    if (!c) return;
    if (v instanceof RedisError) c.reject(v); else c.resolve(v);
  }
  call(...args) {
    if (this.closing) return Promise.reject(new RedisError('client closed'));
    return new Promise((resolve, reject) => {
      const c = { args, resolve, reject };
      if (this.ready && this.sock) this._send(c);
      else {
        if (this.queue.length >= this.maxQueue) return reject(new RedisError('offline queue full'));
        this.queue.push(c);
        if (!this.started) this.connect();
      }
    });
  }
  // several commands written in one go; resolves to an array of results (errors are returned, not thrown)
  pipeline(cmds) { return Promise.all(cmds.map((a) => this.call(...a).catch((e) => e))); }
  async quit() {
    this.closing = true;
    for (const c of this.queue) c.reject(new RedisError('client closed'));
    this.queue = [];
    if (this.sock) this.sock.destroy(); else this.emit('end');
  }
}

// XREAD / XREADGROUP reply → [{stream, entries: [[id, {field: value}]]}]
function parseXread(reply) {
  if (!reply) return [];
  return reply.map(([stream, entries]) => ({
    stream,
    entries: (entries || []).map(([id, kv]) => { const f = {}; if (kv) for (let k = 0; k < kv.length; k += 2) f[kv[k]] = kv[k + 1]; return [id, f]; }),
  }));
}

module.exports = { Redis, RedisError, Parser, encode, parseXread, parseUrl };
