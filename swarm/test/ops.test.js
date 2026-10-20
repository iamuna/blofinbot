'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { MemoryBus } = require('../src/core/bus');
const { Herald } = require('../src/ops/herald');
const { Watchdog } = require('../src/ops/watchdog');
const { Guardian } = require('../src/ops/guardian');
const { StateSync } = require('../src/ops/state_sync');
const { quiet, baseCfg, tap, tmpDir, sleep } = require('./helpers');

test('herald: sends alerts, rate-limits repeats, takes commands only from Ibrahim\'s chat', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'T'; process.env.TELEGRAM_CHAT_ID = '42';
  const sent = [], updates = [[{ update_id: 1, message: { chat: { id: 99 }, text: '/flatten' } }, { update_id: 2, message: { chat: { id: 42 }, text: '/pause' } }, { update_id: 3, message: { chat: { id: 42 }, text: '/status' } }]];
  const fakeFetch = async (url, o) => {
    const body = JSON.parse(o.body);
    if (url.endsWith('/sendMessage')) { sent.push(body.text); return { json: async () => ({ ok: true, result: {} }) }; }
    if (url.endsWith('/getUpdates')) { await sleep(5); return { json: async () => ({ ok: true, result: updates.shift() || [] }) }; }
    throw new Error(url);
  };
  const bus = new MemoryBus();
  const cmds = tap(bus, 'sys.command');
  const h = new Herald({ bus, cfg: baseCfg(), fetch: fakeFetch, heartbeats: false, logSink: quiet });
  await h.start();
  try {
    await bus.publish('sys.alert', { text: 'brain has not reported for 95 s', key: 'down:brain' });
    await bus.publish('sys.alert', { text: 'brain has not reported for 110 s', key: 'down:brain' });
    await bus.publish('risk.state', { ts: 1, mode: 'normal', budgetScale: 1, reasons: [] });
    await bus.publish('risk.state', { ts: 2, mode: 'no-new', budgetScale: 1, reasons: ['day loss 3.1% ≥ 3%'] });
    await bus.drain(); await sleep(60); await bus.drain();
    assert.strictEqual(sent.filter((t) => /brain/.test(t)).length, 1, 'the same alert key is sent once per 10 minutes');
    assert.ok(sent.some((t) => /normal → no-new/.test(t)));
    assert.deepStrictEqual(cmds.map((m) => [m.src, m.data.cmd, m.data.by]), [['herald', 'pause', 'ibrahim']], 'the stranger\'s /flatten was ignored');
    assert.ok(sent.some((t) => /^Account \(/.test(t)), '/status answers (it once collided with the agent\'s own status field)');
  } finally { await h.stop(); delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID; }
});

test('watchdog: an agent that stops reporting raises an alert, and its return too', async () => {
  let now = 1e12;
  const bus = new MemoryBus({ now: () => now }), cfg = baseCfg();
  cfg.groups = { g: ['brain', 'trader', 'watchdog'] };
  const alerts = tap(bus, 'sys.alert');
  const w = new Watchdog({ bus, cfg, dataDir: tmpDir('wd'), now: () => now, heartbeats: false, logSink: quiet });
  await w.start();
  await bus.publish('sys.heartbeat', { agent: 'brain', pid: 1, status: 'ok', startedAt: 0, metrics: {} });
  await bus.publish('sys.heartbeat', { agent: 'trader', pid: 1, status: 'ok', startedAt: 0, metrics: {} });
  await bus.drain(); now += 60000;
  await bus.publish('sys.heartbeat', { agent: 'brain', pid: 1, status: 'ok', startedAt: 0, metrics: {} });
  await bus.drain(); now += 40000; await w.check(); await bus.drain();
  assert.deepStrictEqual(alerts.map((m) => m.data.key), ['down:trader']);
  await bus.publish('sys.heartbeat', { agent: 'trader', pid: 2, status: 'ok', startedAt: 0, metrics: {} }); await bus.drain();
  assert.strictEqual(alerts.pop().data.key, 'up:trader');
  await w.stop();
});

test('guardian: changed risk limits without a new signature stop trading', async () => {
  const dir = tmpDir('gd'), riskFile = path.join(dir, 'risk.json'), sigFile = path.join(dir, 'risk.sha256');
  fs.writeFileSync(riskFile, JSON.stringify({ liveEnabled: false, maxOpenRiskPct: 0.06 }));
  fs.writeFileSync(sigFile, crypto.createHash('sha256').update(fs.readFileSync(riskFile)).digest('hex') + '  risk.json\n');
  const bus = new MemoryBus(), cfg = baseCfg(); cfg.guardian = { signatureFile: sigFile };
  const cmds = tap(bus, ['sys.command', 'sys.alert']);
  const g = new Guardian({ bus, cfg, riskFile, heartbeats: false, logSink: quiet });
  await g.start(); await bus.drain();
  assert.strictEqual(cmds.length, 0); assert.strictEqual(g.metrics.signed, true);
  fs.writeFileSync(riskFile, JSON.stringify({ liveEnabled: true, maxOpenRiskPct: 0.6 }));
  await g.check(); await bus.drain();
  assert.deepStrictEqual(cmds.map((m) => m.data.cmd || 'alert'), ['flatten', 'pause', 'alert']);
  cfg.trading = { account: 'live' }; fs.writeFileSync(sigFile, crypto.createHash('sha256').update(fs.readFileSync(riskFile)).digest('hex'));
  g.tripped = false; await g.check(); assert.strictEqual(g.status, 'ok', 'signed and enabled: live allowed');
  await g.stop();
});

test('state sync: writes state, summary and trade logs locally without a token', async () => {
  delete process.env.GITHUB_TOKEN;
  const bus = new MemoryBus(), dataDir = tmpDir('ss');
  await bus.kv.set('account', { mode: 'paper', equity: 10010, equity0: 10000, dayPnlPct: 0.001, dd: 0, trades: 1, fees: 1, funding: 0 });
  await bus.kv.set('positions', { open: [{ coin: 'ETH', side: 1, strategies: ['s1'] }], working: [] });
  const s = new StateSync({ bus, cfg: baseCfg(), dataDir, heartbeats: false, logSink: quiet });
  await s.start();
  await bus.publish('trade.closed', { orderId: 'o', coin: 'ETH', side: 1, qty: 1, entry: 1, exit: 1.1, netUsd: 10, r: 1, reason: 'target', strategies: [{ name: 's1' }] });
  await bus.publish('sys.heartbeat', { agent: 'brain', pid: 1, status: 'ok', startedAt: 0, metrics: {} });
  await bus.drain(); await s.sync();
  const d = path.join(dataDir, 'state-repo');
  assert.match(fs.readFileSync(path.join(d, 'summary.md'), 'utf8'), /\+ETH \(s1\)/);
  assert.strictEqual(fs.readFileSync(path.join(d, 'trades.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8')).account.equity, 10010);
  assert.strictEqual(s.status, 'degraded');
  await s.stop();
});
