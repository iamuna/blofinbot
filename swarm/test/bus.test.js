'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MemoryBus, RedisBus } = require('../src/core/bus');
const { Parser, Redis, encode } = require('../src/core/resp');
const S = require('../src/core/schemas');
const { startRedis, sleep } = require('./helpers');

const bar = (coin, t) => ({ coin, venue: 'blofin', tf: '1m', t, o: 1, h: 1, l: 1, c: 1, v: 1, q: 1 });

test('schemas reject malformed data and unknown types', () => {
  assert.throws(() => S.check('md.bar', { coin: 'BTC' }), /missing field/);
  assert.throws(() => S.check('md.bar', Object.assign(bar('BTC', 1), { c: NaN })), /not finite/);
  assert.throws(() => S.check('md.nope', {}), /unknown message type/);
  assert.ok(S.check('md.bar', bar('BTC', 1)));
  assert.deepStrictEqual(S.expand(['ref.flow', 'uni.*']).sort(), ['ref.flow', 'uni.list']);
});

test('RESP parser handles replies split across chunks', () => {
  const got = []; const p = new Parser((v) => got.push(v));
  const wire = Buffer.from('+OK\r\n:42\r\n$5\r\nhello\r\n$-1\r\n*2\r\n$1\r\na\r\n*1\r\n:7\r\n-ERR boom\r\n');
  for (let i = 0; i < wire.length; i += 3) p.push(wire.subarray(i, i + 3));
  assert.deepStrictEqual(got.slice(0, 5), ['OK', 42, 'hello', null, ['a', [7]]]);
  assert.match(got[5].message, /ERR boom/);
  assert.strictEqual(encode(['SET', 'k', 'é']).toString(), '*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$2\r\né\r\n');
});

test('memory bus: order, patterns, replay, dead letters, drain', async () => {
  const bus = new MemoryBus();
  const seen = [], dead = [];
  bus.subscribe('md.*', async (m) => { await sleep(Math.random() * 3); seen.push(m.data.t); });
  bus.subscribe('sys.dead', (m) => dead.push(m.data));
  bus.subscribe('md.bar', (m) => { if (m.data.t === 2) throw new Error('bad bar'); }, { group: 'picky' });
  for (let t = 1; t <= 5; t++) await bus.publish('md.bar', bar('BTC', t), { src: 'test' });
  await bus.drain();
  assert.deepStrictEqual(seen, [1, 2, 3, 4, 5]);
  assert.strictEqual(dead.length, 1); assert.strictEqual(dead[0].agent, 'picky'); assert.match(dead[0].error, /bad bar/);
  const late = []; bus.subscribe('md.bar', (m) => late.push(m.data.t), { from: '0' });
  await bus.drain();
  assert.deepStrictEqual(late, [1, 2, 3, 4, 5]);
  await assert.rejects(bus.publish('md.bar', { coin: 'BTC' }), /missing field/);
});

test('redis bus: publish/subscribe, kv, durable resume, range', async (t) => {
  const R = await startRedis();
  if (!R) return t.skip('redis-server not installed');
  const prefix = 'swt' + Date.now();
  const bus = await new RedisBus({ url: R.url, prefix }).connect();
  try {
    const got = [];
    const s1 = bus.subscribe(['md.bar', 'md.ticker'], (m) => got.push(m.type + ':' + (m.data.t || m.data.ts)), { group: 'live' });
    await sleep(150);
    await bus.publish('md.bar', bar('BTC', 1));
    await bus.publish('md.ticker', { coin: 'BTC', ts: 2, last: 1, bid: 1, ask: 1 });
    await bus.publish('md.bar', bar('BTC', 3));
    for (let k = 0; k < 40 && got.length < 3; k++) await sleep(50);
    assert.deepStrictEqual(got, ['md.bar:1', 'md.ticker:2', 'md.bar:3']);
    await s1.stop();

    await bus.kv.set('universe', { coins: ['BTC'] });
    assert.deepStrictEqual(await bus.kv.get('universe'), { coins: ['BTC'] });

    // durable: a consumer group that was down receives what it missed
    const a = []; const d1 = bus.subscribe('md.bar', (m) => a.push(m.data.t), { group: 'rec', durable: true });
    await sleep(150);
    await bus.publish('md.bar', bar('ETH', 10));
    for (let k = 0; k < 40 && a.length < 1; k++) await sleep(50);
    await d1.stop();
    await bus.publish('md.bar', bar('ETH', 11)); await bus.publish('md.bar', bar('ETH', 12));
    const b = []; const d2 = bus.subscribe('md.bar', (m) => b.push(m.data.t), { group: 'rec', durable: true });
    for (let k = 0; k < 60 && b.length < 2; k++) await sleep(50);
    await d2.stop();
    assert.deepStrictEqual(a, [10]); assert.deepStrictEqual(b, [11, 12]);

    const all = await bus.range('md.bar');
    assert.deepStrictEqual(all.map((m) => m.data.t), [1, 3, 10, 11, 12]);
  } finally { await bus.close(); await R.stop(); }
});

test('redis client reconnects after the server restarts', async (t) => {
  if (process.env.REDIS_URL) return t.skip('external redis');
  const R = await startRedis();
  if (!R) return t.skip('redis-server not installed');
  const c = new Redis({ url: R.url });
  await c.connect();
  assert.strictEqual(await c.call('PING'), 'PONG');
  await R.stop();
  const { spawn } = require('child_process');
  const p = spawn('redis-server', ['--port', String(R.port), '--save', '', '--appendonly', 'no', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  try {
    let ok = false;
    for (let k = 0; k < 60 && !ok; k++) { try { ok = (await c.call('PING')) === 'PONG'; } catch (e) { await sleep(100); } }
    assert.ok(ok, 'PING works again after restart');
  } finally { await c.quit(); p.kill('SIGKILL'); }
});
