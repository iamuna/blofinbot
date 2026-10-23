'use strict';
// The brain in its own locked-down process (core/isolate.js): what the Windows PC relies on to keep agent-written
// strategy code away from the tokens and the bus key.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { MemoryBus } = require('../src/core/bus');
const { IsolatedAgent, permissionFlag } = require('../src/core/isolate');
const { quiet, baseCfg, tap, tmpDir, sleep } = require('./helpers');

const FIX = path.join(__dirname, 'fixtures');
const probe = { file: path.join(FIX, 'isolated_probe.js'), export: 'Probe' };
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(25); } return false; }

test('isolate: --permission from Node 22.13 / 23.5, the experimental flag before', () => {
  assert.strictEqual(permissionFlag('24.1.0'), '--permission');
  assert.strictEqual(permissionFlag('22.13.0'), '--permission');
  assert.strictEqual(permissionFlag('22.12.0'), '--experimental-permission');
  assert.strictEqual(permissionFlag('23.4.0'), '--experimental-permission');
});

test('isolate: the brain process reads no secrets, starts nothing, and can only say what a brain may say', async () => {
  const dataDir = tmpDir('iso'), secret = path.join(dataDir, 'secrets.json');
  fs.writeFileSync(secret, '{"GITHUB_TOKEN":"x"}');
  const saved = { t: process.env.TELEGRAM_BOT_TOKEN, k: process.env.SWARM_BUS_KEY_FILE };
  process.env.TELEGRAM_BOT_TOKEN = 'secret-token'; process.env.SWARM_BUS_KEY_FILE = secret;
  const bus = new MemoryBus(), cfg = Object.assign(baseCfg(), { probe: { secretFile: secret } });
  await bus.kv.set('universe', { coins: [{ coin: 'ETH' }] });
  const got = tap(bus, ['order', 'sys.command', 'sys.log', 'sys.heartbeat']);
  const host = new IsolatedAgent({ bus, cfg, dataDir, heartbeats: false, logSink: quiet }, { name: 'brain', module: probe, allowRead: [FIX] });
  try {
    await host.start();
    assert.ok(await until(() => got.some((m) => m.type === 'sys.log' && /^probe /.test(m.data.msg))), 'the probe reported');
    const rep = got.find((m) => m.type === 'sys.log' && /^probe /.test(m.data.msg));
    const r = JSON.parse(rep.data.msg.slice(6));
    assert.strictEqual(r.read, 'ERR_ACCESS_DENIED', 'cannot read the secrets file');
    assert.strictEqual(r.spawn, 'ERR_ACCESS_DENIED', 'cannot start programs');
    assert.deepStrictEqual(r.env, [], 'no tokens in its environment');
    assert.deepStrictEqual(r.universe, { coins: [{ coin: 'ETH' }] }, 'reads kv');
    assert.deepStrictEqual([rep.src, rep.data.agent], ['brain', 'brain'], 'speaks only under its own name');
    assert.ok(!got.some((m) => m.type === 'order' || m.type === 'sys.command'), 'no order, no command');
    assert.ok(!got.some((m) => m.type === 'sys.heartbeat' && m.data.agent === 'trader'), 'no heartbeat for another agent');
    assert.strictEqual(await bus.kv.get('positions'), null, 'cannot write positions');
    assert.deepStrictEqual(await bus.kv.get('betas'), { ETH: 1.2 }, 'writes its own kv key');
    assert.ok(host.metrics.refused >= 4, `refused ${host.metrics.refused}`);
    await bus.publish('md.book', { coin: 'ETH', ts: 1, bids: [[1, 1]], asks: [[1.01, 1]], mid: 1.005, spreadBps: 100 });
    assert.ok(await until(() => got.some((m) => m.type === 'sys.log' && m.data.msg === 'book ETH')), 'subscriptions reach it');
  } finally {
    await host.stop();
    if (saved.t === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = saved.t;
    if (saved.k === undefined) delete process.env.SWARM_BUS_KEY_FILE; else process.env.SWARM_BUS_KEY_FILE = saved.k;
  }
  assert.ok(host.child.exitCode !== null || host.child.signalCode !== null, 'the child process is gone');
});

test('isolate: without the lock-down the agent is not started (fail closed), and not restarted', async () => {
  const dataDir = tmpDir('iso2'), bus = new MemoryBus(), cfg = baseCfg();
  const logs = tap(bus, 'sys.log');
  // allowing the data folder breaks the lock-down the child checks for
  const host = new IsolatedAgent({ bus, cfg, dataDir, heartbeats: false, logSink: quiet }, { name: 'brain', module: probe, allowRead: [FIX, dataDir], restartMs: 50 });
  try {
    await host.start();
    assert.ok(await until(() => host.status === 'degraded'));
    assert.match(host.statusWhy, /isolation incomplete: may read/);
    await sleep(300); await bus.drain();
    assert.ok(!logs.some((m) => /^probe /.test(m.data.msg)), 'the agent code never ran');
    assert.strictEqual(host.restarts, 0);
  } finally { await host.stop(); }
});
