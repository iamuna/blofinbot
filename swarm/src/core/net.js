/* Network helpers: JSON over HTTPS with retries, and a WebSocket that keeps itself alive.
 * No dependencies: Node 22's global fetch and WebSocket.
 */
'use strict';
const { EventEmitter } = require('events');
const zlib = require('zlib');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error { constructor(msg, status, body) { super(msg); this.status = status; this.body = body; } }

// GET JSON with retries on network errors, 429 and 5xx. 4xx (other than 429) fails at once.
async function getJSON(url, o = {}) {
  const retries = o.retries == null ? 3 : o.retries, fetchImpl = o.fetch || fetch;
  let last;
  for (let a = 0; a <= retries; a++) {
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': 'blofin-swarm/0.1', Accept: 'application/json' }, signal: AbortSignal.timeout(o.timeoutMs || 15000) });
      if (r.status === 429 || r.status >= 500) { last = new HttpError(`HTTP ${r.status} ${url}`, r.status); await sleep(o.backoffMs || 1000 * (a + 1)); continue; }
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new HttpError(`HTTP ${r.status} ${url} ${t.slice(0, 200)}`, r.status, t); }
      return await r.json();
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      last = e;
      if (a < retries) await sleep(o.backoffMs || 800 * (a + 1));
    }
  }
  throw last;
}
async function getBuffer(url, o = {}) {
  const fetchImpl = o.fetch || fetch;
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'blofin-swarm/0.1' }, signal: AbortSignal.timeout(o.timeoutMs || 30000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(`HTTP ${r.status} ${url}`, r.status);
  return Buffer.from(await r.arrayBuffer());
}

// first file of a .zip archive (stored or deflated), read through the central directory
function unzipFirst(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('zip: bad central directory');
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('zip: bad local header');
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error('zip: unsupported compression ' + method);
}

/* A WebSocket that reconnects with backoff, keeps itself alive and limits how fast it opens connections.
 *   events: open, message(text), close(code, reason), error(err)
 * pingText: sent when nothing has arrived for pingAfterMs (BloFin wants the text "ping"; the "pong" is swallowed).
 * Silence longer than idleMs, or a connection older than maxAgeMs, forces a reconnect.
 */
const lastOpenByHost = new Map();
class KeepAliveSocket extends EventEmitter {
  constructor(o) {
    super();
    this.url = o.url; this.WS = o.WebSocket || globalThis.WebSocket;
    this.pingText = o.pingText || null; this.pingAfterMs = o.pingAfterMs || 20000; this.idleMs = o.idleMs || 60000;
    this.maxAgeMs = o.maxAgeMs || 23 * 3600 * 1000; this.minOpenGapMs = o.minOpenGapMs == null ? 1100 : o.minOpenGapMs;
    this.now = o.now || Date.now; this.ws = null; this.stopped = false; this.backoff = 1000; this.lastMsg = 0; this.openedAt = 0; this.pinged = 0;
    this.stats = { opens: 0, closes: 0, messages: 0, errors: 0 };
    this.on('error', () => {});
  }
  start() { this.stopped = false; this._open(); this.timer = setInterval(() => this._check(), 2000); return this; }
  stop() { this.stopped = true; clearInterval(this.timer); clearTimeout(this.retry); if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } } this.ws = null; }
  get isOpen() { return !!this.ws && this.ws.readyState === 1; }
  send(text) { if (this.isOpen) { this.ws.send(text); return true; } return false; }
  async _open() {
    if (this.stopped) return;
    const host = new URL(this.url).host, gap = (lastOpenByHost.get(host) || 0) + this.minOpenGapMs - Date.now();
    lastOpenByHost.set(host, Date.now() + Math.max(0, gap));
    if (gap > 0) await sleep(gap);
    if (this.stopped) return;
    let ws;
    try { ws = new this.WS(this.url); } catch (e) { this.stats.errors++; this.emit('error', e); return this._scheduleRetry(); }
    this.ws = ws;
    ws.onopen = () => { this.stats.opens++; this.openedAt = this.lastMsg = this.now(); this.backoff = 1000; this.pinged = 0; this.emit('open'); };
    ws.onmessage = (ev) => {
      this.lastMsg = this.now(); this.pinged = 0; this.stats.messages++;
      const text = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
      if (this.pingText && text === 'pong') return;
      this.emit('message', text);
    };
    ws.onerror = (e) => { this.stats.errors++; this.emit('error', e && e.message ? new Error(e.message) : new Error('websocket error')); };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null; this.closingSince = 0; this.stats.closes++;
      this.emit('close', ev && ev.code, ev && ev.reason);
      this._scheduleRetry();
    };
  }
  _scheduleRetry() {
    if (this.stopped) return;
    const wait = this.backoff * (0.8 + Math.random() * 0.4);
    this.backoff = Math.min(30000, this.backoff * 2);
    this.retry = setTimeout(() => this._open(), wait);
  }
  _check() {
    const t = this.now();
    if (this.ws && this.closingSince && t - this.closingSince > 10000) { // close() never completed: drop it
      const ws = this.ws; this.ws = null; this.closingSince = 0; ws.onclose = ws.onmessage = ws.onerror = null;
      this.stats.closes++; this.emit('close', 0, 'close timeout'); this._scheduleRetry(); return;
    }
    if (!this.isOpen) return;
    const quiet = t - this.lastMsg;
    if (this.pingText && quiet > this.pingAfterMs && !this.pinged) { this.pinged = t; this.send(this.pingText); }
    if (quiet > this.idleMs || t - this.openedAt > this.maxAgeMs) { this.closingSince = t; try { this.ws.close(); } catch (e) { /* ignore */ } }
  }
}

module.exports = { getJSON, getBuffer, unzipFirst, KeepAliveSocket, HttpError, sleep };
