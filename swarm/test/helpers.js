'use strict';
const { spawn, execFileSync } = require('child_process');
const net = require('net'), os = require('os'), fs = require('fs'), path = require('path'), zlib = require('zlib');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasRedis() { try { execFileSync('redis-server', ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return false; } }
async function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); }); }
// a throwaway redis-server, or the one in REDIS_URL (CI service container)
async function startRedis() {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL, stop: async () => {}, external: true };
  if (!hasRedis()) return null;
  const port = await freePort();
  const p = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  for (let k = 0; k < 50; k++) { if (await canConnect(port)) break; await sleep(100); }
  return { url: `redis://127.0.0.1:${port}`, port, proc: p, stop: async () => { p.kill('SIGKILL'); await sleep(50); } };
}
function canConnect(port) { return new Promise((res) => { const s = net.createConnection({ port, host: '127.0.0.1' }); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); }); }

// Minimal stand-in for the browser-style WebSocket the agents use
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWS.all.push(this); setImmediate(() => { if (this.readyState === 0) { this.readyState = 1; if (this.onopen) this.onopen({}); } }); }
  send(t) { this.sent.push(t); }
  close() { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose({ code: 1000, reason: '' }); }
  push(obj) { if (this.onmessage) this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
}
FakeWS.all = [];
FakeWS.reset = () => { FakeWS.all = []; };

function fakeHttp(routes) {
  const calls = [];
  const find = (url) => { for (const [re, v] of routes) if (re.test(url)) return v; return undefined; };
  return {
    calls,
    getJSON: async (url) => { calls.push(url); const v = find(url); if (v === undefined) throw new Error('no route ' + url); if (v instanceof Error) throw v; return typeof v === 'function' ? v(url) : v; },
    getBuffer: async (url) => { calls.push(url); const v = find(url); if (v instanceof Error) throw v; if (v === undefined || v === null) return null; return typeof v === 'function' ? v(url) : v; },
  };
}

// a one-file .zip (deflated), like Binance's archive files
function makeZip(name, content) {
  const data = Buffer.from(content), comp = zlib.deflateRawSync(data), nameB = Buffer.from(name);
  const crc = crc32(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(0, 42);
  const local = Buffer.concat([lh, nameB, comp]), central = Buffer.concat([cd, nameB]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), `swarm-${tag}-`)); }
// collects everything published on a memory bus
function tap(bus, patterns) { const got = []; bus.subscribe(patterns, (m) => { got.push(m); }); return got; }
const quiet = () => {};
const baseCfg = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'swarm.json'), 'utf8'));

module.exports = { sleep, startRedis, hasRedis, FakeWS, fakeHttp, makeZip, tmpDir, tap, quiet, baseCfg };
