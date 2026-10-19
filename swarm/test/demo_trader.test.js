'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MemoryBus } = require('../src/core/bus');
const { DemoTrader } = require('../src/exec/demo_trader');
const { createFakePlus } = require('./fake_blofin_plus');
const { quiet, baseCfg, tap, tmpDir } = require('./helpers');

async function rig(dataDir) {
  const fake = createFakePlus({ key: 'k', secret: 's', pass: 'p', equity: 10000, postOnlyCross: 'reject' });
  fake.addInstrument('ETH-USDT', { contractValue: 0.01, lotSize: 1, minSize: 1, tickSize: 0.01 }, 2000);
  return { fake, dataDir: dataDir || tmpDir('demo') };
}
async function trader(R, bus) {
  const cfg = baseCfg(); cfg.trading = { account: 'demo' };
  let vms = 0; // the client's request pacing waits on a private clock instead of sleeping
  const t = new DemoTrader({ bus, cfg, dataDir: R.dataDir, fetchImpl: R.fake.fetchImpl, apiKey: 'k', apiSecret: 's', passphrase: 'p', sleep: async (ms) => { vms += ms; }, nowMs: () => Date.now() + vms, tickMs: 3600000, heartbeats: false, logSink: quiet });
  await t.start();
  return t;
}
const book = (bus, bid, ask) => bus.publish('md.book', { coin: 'ETH', ts: Date.now(), bids: [[bid, 100]], asks: [[ask, 100]], mid: (bid + ask) / 2, spreadBps: 0.1 });
const order = (bus, id, extra) => bus.publish('order', Object.assign({ id, coin: 'ETH', instId: 'ETH-USDT', side: 1, qty: 1, entry: { kind: 'maker', px: 2000, waitMin: 5, chase: true }, stop: 1980, target: 2030, trail: null, timeStopMin: 120, strategies: [{ name: 's1', ideaId: id }] }, extra), { src: 'risk' });

test('demo trader: post-only entry → exchange stop + target → stop triggers on BloFin → trade closed', async () => {
  const R = await rig(), bus = new MemoryBus();
  const got = tap(bus, ['exec.fill', 'trade.closed', 'order.end']);
  const t = await trader(R, bus);
  try {
    await book(bus, 1999.99, 2000.01); await order(bus, 'o1'); await bus.drain();
    await t.loop();
    const placed = Object.values(R.fake.orders);
    assert.strictEqual(placed.length, 1); assert.deepStrictEqual([placed[0].orderType, placed[0].price, placed[0].size], ['post_only', 1999.99, 100]);
    await R.fake.market('ETH-USDT', 1999.5, 1999.5, 2000); // trades through the bid → filled
    await t.loop(); await bus.drain();
    assert.strictEqual(got.find((m) => m.type === 'exec.fill').data.role, 'entry');
    const sl = Object.values(R.fake.tpsl);
    assert.strictEqual(sl.length, 1); assert.deepStrictEqual([sl[0].side, sl[0].slTriggerPrice, sl[0].slOrderPrice, sl[0].reduceOnly, sl[0].size], ['sell', '1980.00', '-1', 'true', '100']);
    const tp = Object.values(R.fake.orders).find((o) => o.reduceOnly && o.state === 'live');
    assert.deepStrictEqual([tp.side, tp.price, tp.orderType], ['sell', 2030, 'post_only']);
    assert.strictEqual(t.S.positions.ETH.sl.state, 'LIVE');
    await R.fake.market('ETH-USDT', 1975, 1975, 1999); // the exchange-side stop triggers while the bot is idle
    assert.strictEqual(R.fake.pos['ETH-USDT'], undefined, 'BloFin closed the position by itself');
    await t.loop(); await bus.drain();
    const tc = got.find((m) => m.type === 'trade.closed').data;
    assert.strictEqual(tc.reason, 'stop'); assert.ok(tc.exit < 1980 && tc.exit > 1970); assert.ok(tc.r < -1);
    assert.strictEqual(tp.state, 'canceled', 'the target order is cancelled after the stop');
    assert.deepStrictEqual(Object.keys(t.S.positions), []);
  } finally { await t.stop(); }
});

test('demo trader: a lost answer after BloFin accepted the order never creates a duplicate', async () => {
  const R = await rig(), bus = new MemoryBus();
  const t = await trader(R, bus);
  try {
    await t.loop(); // init
    await book(bus, 1999.99, 2000.01); await order(bus, 'o2'); await bus.drain();
    R.fake.inject('POST /api/v1/trade/order', 'drop-after');
    await t.loop();
    const e = t.S.entries.o2;
    assert.strictEqual(e.attempts[0].state, 'UNKNOWN');
    await t.loop(); await t.loop();
    assert.strictEqual(Object.values(R.fake.orders).length, 1, 'one order on BloFin');
    assert.strictEqual(e.attempts.length, 1); assert.strictEqual(e.attempts[0].state, 'LIVE');
  } finally { await t.stop(); }
});

test('demo trader: restart keeps the position; a missing stop is put back; flatten closes with a reduce-only market order', async () => {
  const R = await rig(), bus = new MemoryBus();
  const got = tap(bus, ['trade.closed']);
  let t = await trader(R, bus);
  await book(bus, 1999.99, 2000.01); await order(bus, 'o3', { target: null }); await bus.drain();
  await t.loop(); await R.fake.market('ETH-USDT', 1999.5, 1999.5, 2000); await t.loop();
  assert.ok(t.S.positions.ETH);
  await t.stop();
  // a new process on the same state
  t = await trader(R, bus);
  try {
    assert.ok(t.S.positions.ETH, 'state survived the restart');
    for (const id of Object.keys(R.fake.tpsl)) delete R.fake.tpsl[id]; // someone removed the stop in the app
    await t.loop(); t.lastSlow = 0; await t.loop(); // the next full read sees the stop is missing
    t.lastSlow = 0; await t.loop();
    assert.strictEqual(Object.keys(R.fake.tpsl).length, 1, 'the stop is back on BloFin');
    assert.strictEqual(t.metrics.stopReplaced, 1);
    await bus.publish('sys.command', { cmd: 'flatten', by: 'risk', why: 'test' }); await bus.drain();
    await book(bus, 1999.99, 2000.01); await t.loop(); await t.loop(); await bus.drain();
    const tc = got.find((m) => m.type === 'trade.closed').data;
    assert.strictEqual(tc.reason, 'flatten');
    assert.strictEqual(R.fake.pos['ETH-USDT'], undefined);
    assert.strictEqual(Object.keys(R.fake.tpsl).length, 0, 'the stop is cancelled after the close');
  } finally { await t.stop(); }
});

test('demo trader: refuses a key that can move money', async () => {
  const R = await rig(), bus = new MemoryBus();
  R.fake.setKeyInfo({ permissions: 'read,trade,withdraw' });
  const t = await trader(R, bus);
  try {
    await t.loop();
    assert.strictEqual(t.ready, false); assert.match(t.statusWhy, /money-moving/);
  } finally { await t.stop(); }
});
