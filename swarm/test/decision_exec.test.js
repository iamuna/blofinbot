'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { MemoryBus } = require('../src/core/bus');
const { fuse } = require('../src/decision/fusion');
const { Allocator } = require('../src/decision/allocator');
const { RiskEngine } = require('../src/decision/risk');
const { Coordinator } = require('../src/decision/coordinator');
const { Trader } = require('../src/exec/trader');
const { Accountant } = require('../src/exec/accountant');
const { quiet, baseCfg, tap, tmpDir, sleep } = require('./helpers');
const LIMITS = require('../config/risk.json');

const idea = (id, strategy, coin, side, px, stop, extra) => Object.assign({ id, strategy, coin, side, t: 1, entry: { kind: 'maker', px, waitMin: 5, chase: true }, stop, target: null, trail: null, timeStopMin: 30, why: id }, extra);

test('fusion: same side stacks under the leader, opposite sides cancel or net, busy coins skipped', () => {
  const budget = (s) => ({ a: 0.004, b: 0.002, c: 0.001, z: 0 })[s];
  const { intents, dropped } = fuse([
    idea('1', 'a', 'BTC', 1, 100, 99), idea('2', 'b', 'BTC', 1, 100.2, 98),
    idea('3', 'a', 'ETH', 1, 10, 9.9), idea('4', 'b', 'ETH', -1, 10, 10.1),
    idea('5', 'a', 'SOL', -1, 5, 5.1), idea('6', 'c', 'SOL', 1, 5, 4.9),
    idea('7', 'b', 'XRP', 1, 1, 0.99), idea('8', 'z', 'DOGE', 1, 1, 0.99),
  ], { budget, busy: new Set(['XRP']) });
  const by = Object.fromEntries(intents.map((i) => [i.coin, i]));
  assert.strictEqual(by.BTC.lead, 'a'); assert.strictEqual(by.BTC.stop, 99); assert.ok(Math.abs(by.BTC.riskPct - 0.006) < 1e-12, 'stack capped at 1.5× the leader');
  assert.ok(Math.abs(by.ETH.riskPct - 0.002) < 1e-12, 'a 2:1 majority trades the difference'); assert.strictEqual(by.ETH.side, 1);
  assert.strictEqual(by.SOL.side, -1);
  assert.ok(!by.XRP && !by.DOGE);
  assert.ok(dropped.some((d) => d.why === 'strategy has no budget'));
  const { intents: none } = fuse([idea('9', 'a', 'BTC', 1, 1, 0.9), idea('10', 'a', 'BTC', -1, 1, 1.1)], { budget });
  assert.strictEqual(none.length, 0, 'equal opposite ideas cancel');
});

test('allocator: start budget, Kelly fraction once proven, zero when not positive', () => {
  const a = new Allocator({ startPct: 0.0025, capPct: 0.01 });
  assert.strictEqual(a.budget('new'), 0.0025);
  for (let k = 0; k < 200; k++) a.record('good', k % 2 ? 1.15 : -1.05); // mean 0.05, sd ≈ 1.1
  const b = a.budget('good');
  assert.ok(b > 0.0060 && b < 0.0072, `≈ 0.69% (${b})`);
  for (let k = 0; k < 150; k++) a.record('bad', k % 2 ? 1 : -1.1);
  assert.strictEqual(a.budget('bad'), 0);
  a.scale = 0.5; assert.strictEqual(a.budget('new'), 0.00125);
  assert.deepStrictEqual(a.size({ entry: { px: 100 }, stop: 99, riskPct: 0.01 }, 10000), { qty: 100, riskUsd: 100, notional: 10000 });
});

test('risk engine: ladders and per-order limits', () => {
  const r = new RiskEngine(LIMITS);
  const acct = (equity, dayStart, peak) => ({ equity, dayStart, peak });
  assert.strictEqual(r.mode(acct(100, 100, 100)).mode, 'normal');
  assert.strictEqual(r.mode(acct(96.9, 100, 100)).mode, 'no-new');
  assert.strictEqual(r.mode(acct(94.9, 100, 100)).mode, 'flatten');
  const m = r.mode(acct(88, 88, 100)); assert.deepStrictEqual([m.mode, m.budgetScale, m.provenOnly], ['normal', 0.5, false]);
  assert.strictEqual(r.mode(acct(84, 84, 100)).provenOnly, true);
  assert.strictEqual(r.mode(acct(79, 79, 100)).mode, 'halt');
  const it = { coin: 'ETH', side: 1, entry: { px: 100 }, stop: 99 };
  const s = { equity: 10000, mode: 'normal', positions: [], working: [], beta: () => 1, book: () => ({ spreadBps: 1, bids: [[99.99, 1000]], asks: [[100, 1000]] }), inst: () => ({ min: 1, ct: 0.01 }) };
  assert.strictEqual(r.check(it, { qty: 25 }, s).verdict, 'approve');
  const big = r.check(it, { qty: 500 }, s);
  assert.strictEqual(big.verdict, 'trim'); assert.strictEqual(big.qty, 100); assert.match(big.reasons[0], /book depth|risk per trade|coin notional/);
  const full = Object.assign({}, s, { positions: [{ coin: 'BTC', side: 1, qty: 1, px: 1000, stop: 400 }] }); // 6% open risk already
  assert.strictEqual(r.check(it, { qty: 25 }, full).verdict, 'reject');
  assert.strictEqual(r.check(it, { qty: 25 }, Object.assign({}, s, { book: () => ({ spreadBps: 12, bids: [[1, 1]], asks: [[1, 1]] }) })).verdict, 'reject');
  assert.strictEqual(r.check(it, { qty: 25 }, Object.assign({}, s, { inWindow: true })).reasons[0], 'news window');
  const beta = Object.assign({}, s, { positions: [{ coin: 'SOL', side: 1, qty: 190, px: 100, stop: 99.9 }], beta: (c) => (c === 'SOL' ? 1 : 1.5) }); // 19k × 1 = 1.9× BTC exposure
  const bt = r.check(it, { qty: 25 }, beta);
  assert.strictEqual(bt.verdict, 'trim'); assert.ok(Math.abs(bt.qty - 1000 / 150) < 1e-9, 'room for 0.1× equity of BTC exposure at beta 1.5');
});

async function rig() {
  let now = Date.UTC(2026, 9, 20, 12);
  const bus = new MemoryBus({ now: () => now }), dataDir = tmpDir('trade'), cfg = baseCfg();
  cfg.strategies = { s1: { mode: 'trade' }, s2: { mode: 'shadow' } };
  cfg.trading = { account: 'paper', paperEquity: 10000, cycleMs: 20 };
  await bus.kv.set('universe', { coins: [{ coin: 'ETH', instId: 'ETH-USDT', ct: 0.01, min: 1 }] });
  const ctx = { bus, cfg, dataDir, now: () => now, heartbeats: false, logSink: quiet };
  const acc = await new Accountant(ctx).start(), tr = await new Trader(ctx).start(), co = await new Coordinator(ctx).start();
  const book = (bid, ask) => bus.publish('md.book', { coin: 'ETH', ts: now, bids: [[bid, 50]], asks: [[ask, 50]], mid: (bid + ask) / 2, spreadBps: ((ask - bid) / bid) * 1e4 });
  const trade = (px) => bus.publish('md.trade', { coin: 'ETH', trades: [[now, px, 1, -1]] });
  return { bus, cfg, ctx, acc, tr, co, book, trade, advance: (ms) => { now += ms; }, get now() { return now; }, stop: async () => { await co.stop(); await tr.stop(); await acc.stop(); } };
}

test('pipeline: idea → intent → risk → order → paper fill → target → trade closed → account', async () => {
  const R = await rig();
  try {
    const got = tap(R.bus, ['intent', 'risk.decision', 'order', 'exec.fill', 'trade.closed', 'order.end']);
    await R.book(2000, 2000.2);
    await R.bus.publish('idea', Object.assign(idea('i1', 's1', 'ETH', 1, 2000, 1980), { target: 2030, mode: 'trade', riskPct: 0.01 }));
    await R.bus.publish('idea', Object.assign(idea('i2', 's2', 'ETH', 1, 2000, 1980), { mode: 'shadow', riskPct: 0.01 }));
    await R.bus.drain(); await sleep(60); await R.bus.drain();
    const ord = got.find((m) => m.type === 'order');
    assert.ok(ord, 'an order was sent'); assert.strictEqual(ord.src, 'risk');
    assert.ok(Math.abs(ord.data.qty - 1.25) < 1e-9, '0.25% of $10,000 over a $20 stop = 1.25 ETH');
    assert.strictEqual(got.filter((m) => m.type === 'intent').length, 1, 'the shadow strategy does not trade');
    await R.trade(2000); await R.bus.drain();
    assert.ok(!got.some((m) => m.type === 'exec.fill'), 'a print AT the price does not fill');
    await R.trade(1999.9); await R.bus.drain();
    const fill = got.find((m) => m.type === 'exec.fill');
    assert.deepStrictEqual([fill.data.role, fill.data.kind, fill.data.px], ['entry', 'maker', 2000]);
    await R.trade(2030.5); await R.bus.drain();
    const tc = got.find((m) => m.type === 'trade.closed').data;
    assert.deepStrictEqual([tc.reason, tc.exit, tc.exitKind], ['target', 2030, 'maker']);
    const fees = 1.25 * 2000 * 0.0002 + 1.25 * 2030 * 0.0002;
    assert.ok(Math.abs(tc.netUsd - (37.5 - fees)) < 1e-9);
    await R.acc.snapshot(); await R.bus.drain();
    const a = await R.bus.kv.get('account');
    assert.ok(Math.abs(a.equity - (10000 + tc.netUsd)) < 0.01); assert.strictEqual(a.trades, 1);
    assert.deepStrictEqual((await R.bus.kv.get('strategyResults')).s1.length, 1);
  } finally { await R.stop(); }
});

test('trader: unfilled orders end, stops exit at the bid, flatten closes everything, foreign orders ignored', async () => {
  const R = await rig();
  try {
    const got = tap(R.bus, ['exec.fill', 'trade.closed', 'order.end', 'sys.log']);
    await R.book(100, 100.01);
    const order = (id, extra) => R.bus.publish('order', Object.assign({ id, coin: 'ETH', side: 1, qty: 2, entry: { kind: 'maker', px: 100, waitMin: 1, chase: true }, stop: 99, target: null, trail: null, timeStopMin: 60, strategies: [{ name: 's1', ideaId: id }] }, extra), { src: 'risk' });
    await order('o1'); await R.bus.drain();
    R.advance(61000); await R.tr.tick(); await R.bus.drain();
    assert.strictEqual(got.find((m) => m.type === 'order.end').data.outcome, 'unfilled');
    await R.bus.publish('order', { id: 'evil', coin: 'ETH', side: 1, qty: 1000, entry: { kind: 'taker', px: 100 }, stop: 50, timeStopMin: 1, strategies: [] }, { src: 'brain' });
    await R.bus.drain();
    assert.ok(!R.tr.S.orders.evil, 'orders from anyone but the risk agent are ignored');
    await R.book(100, 100.01); // fresh prices (the last book is 61 s old: a taker order waits for a fresh one)
    await order('o2', { entry: { kind: 'taker', px: 100 } }); await R.bus.drain();
    const f = got.filter((m) => m.type === 'exec.fill')[0].data;
    assert.ok(Math.abs(f.px - 100.01 * 1.00015) < 1e-9, 'taker pays the ask plus slippage');
    await R.book(98.95, 98.97); await R.trade(98.96); await R.bus.drain();
    const tc = got.find((m) => m.type === 'trade.closed').data;
    assert.strictEqual(tc.reason, 'stop'); assert.ok(tc.exit <= 99);
    await order('o3', { entry: { kind: 'taker', px: 99 }, stop: 98 }); await R.bus.drain();
    await R.bus.publish('sys.command', { cmd: 'flatten', by: 'risk', why: 'test' }, { src: 'risk' }); await R.bus.drain();
    assert.strictEqual(got.filter((m) => m.type === 'trade.closed').pop().data.reason, 'flatten');
    assert.deepStrictEqual(Object.keys(R.tr.S.positions), []);
  } finally { await R.stop(); }
});

test('coordinator: the ideas of one bar close share the limits (orders in flight count), until the trader reports', async () => {
  let now = Date.UTC(2026, 9, 23, 3);
  const bus = new MemoryBus({ now: () => now }), cfg = baseCfg();
  cfg.strategies = { s1: { mode: 'trade' } }; cfg.trading = { account: 'paper', cycleMs: 20 };
  await bus.kv.set('universe', { coins: ['BTC', 'ETH', 'SOL', 'XRP'].map((c) => ({ coin: c, instId: `${c}-USDT`, ct: 0.01, min: 1 })) });
  const co = new Coordinator({ bus, cfg, dataDir: tmpDir('inflight'), now: () => now, heartbeats: false, logSink: quiet });
  await co.start();
  try {
    const got = tap(bus, ['order', 'risk.decision']);
    co.account = { equity: 10000, dayStart: 10000, peak: 10000 };
    co.positions = { ts: now, open: [{ coin: 'BTC', side: 1, qty: 1, px: 1000, stop: 440, orderId: 'old' }], working: [] }; // 5.6% of 6% open risk used
    for (const c of ['ETH', 'SOL', 'XRP']) await bus.publish('idea', Object.assign(idea(`i-${c}`, 's1', c, 1, 100, 99), { mode: 'trade', riskPct: 0.01 }));
    await bus.drain(); await sleep(80); await bus.drain();
    const orders = got.filter((m) => m.type === 'order').map((m) => m.data);
    const risk = orders.reduce((a, o) => a + o.qty * Math.abs(o.entry.px - o.stop), 0);
    assert.ok(risk <= 40 + 1e-9, `the three orders together stay within the $40 left (${risk})`);
    assert.deepStrictEqual(orders.map((o) => o.qty), [25, 15], 'first gets its 0.25%, the second the rest');
    assert.match(got.filter((m) => m.type === 'risk.decision').pop().data.reasons.join(), /total open risk/);
    assert.strictEqual(co.inflight.size, 2);
    // a new idea on a coin with an order in flight is not sized again
    await bus.publish('idea', Object.assign(idea('i-ETH-2', 's1', 'ETH', 1, 100, 99), { mode: 'trade', riskPct: 0.01 }));
    await bus.drain(); await sleep(80); await bus.drain();
    assert.strictEqual(got.filter((m) => m.type === 'order').length, 2);
    // the trader reports one as working: it counts there instead; a later report without the other ends it
    now += 1000;
    await bus.publish('positions', { ts: now, open: co.positions.open, working: [{ coin: 'ETH', side: 1, qty: 25, px: 100, stop: 99, orderId: orders[0].id }] });
    await bus.drain();
    assert.deepStrictEqual([...co.inflight.keys()], [orders[1].id]);
    now += 5000;
    await bus.publish('positions', { ts: now, open: co.positions.open, working: [] });
    await bus.drain();
    assert.strictEqual(co.inflight.size, 0);
  } finally { await co.stop(); }
});

test('coordinator: the loss ladder flattens; only Ibrahim (via the Herald) can resume after a halt', async () => {
  const R = await rig();
  try {
    const cmds = tap(R.bus, 'sys.command');
    R.co.account = { equity: 7900, dayStart: 8000, peak: 10000 };
    await R.co.watch(); await R.bus.drain();
    assert.ok(cmds.some((m) => m.data.cmd === 'flatten'));
    assert.strictEqual(R.co.halted, true);
    R.co.account = { equity: 10000, dayStart: 10000, peak: 10000 };
    await R.bus.publish('sys.command', { cmd: 'resume', by: 'ibrahim' }, { src: 'agent-manager' }); await R.bus.drain();
    assert.strictEqual(R.co.halted, true, 'a resume from another agent is ignored');
    await R.bus.publish('sys.command', { cmd: 'resume', by: 'ibrahim' }, { src: 'herald' }); await R.bus.drain();
    assert.strictEqual(R.co.halted, false);
  } finally { await R.stop(); }
});
