'use strict';
/* Upswarm Phase 1 (upswarm/GUIDE.md §12): clustered t-stats, the sentinel, the coin-shock guard, the execution-cost
 * tracker and promotion rule v2. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { MemoryBus } = require('../src/core/bus');
const { stats, dailyStats, honestT, backtestGate, demoteCheck } = require('../src/factory/gate');
const { summarize } = require('../src/backtest/stats');
const { checkIdea } = require('../src/decision/sentinel');
const { DataGuard } = require('../src/market/data_guard');
const { CostTracker } = require('../src/exec/cost_tracker');
const { Coordinator } = require('../src/decision/coordinator');
const { Trader } = require('../src/exec/trader');
const { Accountant } = require('../src/exec/accountant');
const P2 = require('../src/factory/promote_v2');
const { quiet, baseCfg, tap, tmpDir, sleep } = require('./helpers');

const DAY = 86400000, T0 = Date.UTC(2026, 9, 1);
const idea = (id, strategy, coin, side, px, stop, extra) => Object.assign({ id, strategy, coin, side, t: 1, entry: { kind: 'maker', px, waitMin: 5, chase: true }, stop, target: null, trail: null, timeStopMin: 30, why: id }, extra);

test('clustered t: twenty trades in one hour are one bet, not twenty', () => {
  // 20 winners closing on the same day, then 9 quiet days with one small loss each
  const burst = Array.from({ length: 20 }, (_, k) => ({ r: 1, entryT: T0 + k * 60000, exitT: T0 + 3600000 + k * 60000 }));
  const rest = Array.from({ length: 9 }, (_, k) => ({ r: -0.5, entryT: T0 + (k + 1) * DAY, exitT: T0 + (k + 1) * DAY + 3600000 }));
  const all = burst.concat(rest), perTrade = stats(all.map((t) => t.r)), d = dailyStats(all);
  assert.ok(perTrade.t > 3, `per trade the record looks strong (t ${perTrade.t.toFixed(2)})`);
  assert.strictEqual(d.active, 10); assert.strictEqual(d.days, 10);
  assert.ok(d.t < 1.2, `by day it is one good day and nine small losses (t ${d.t.toFixed(2)})`);
  assert.strictEqual(honestT(all), d.t, 'the less extreme of the two');
  // days without a trade count as 0 up to `upto`
  assert.strictEqual(dailyStats(burst, T0 + 9 * DAY).days, 10);
  // the backtest rows carry tDay; the gate judges the lower t
  const trades = all.map((t) => ({ grossBps: t.r * 100 + 10, feeBps: 8, slipBps: 2, fundBps: 0, riskBps: 100, exitT: t.exitT, entryT: t.entryT, coin: 'X' }));
  const s = summarize(trades);
  assert.ok(s.tDay != null && s.tDay < s.tStat);
  const row = { all: Object.assign({}, s, { n: 400 }), cost15: { avgR: 0.1 }, thirds: [{ sumR: 1, avgR: 0.1 }, { sumR: 1, avgR: 0.1 }, { sumR: 1, avgR: 0.1 }] };
  assert.match(backtestGate(row, 1).why.join(), /daily-clustered/);
  // demotion judges trades by day too: 120 losers in two days are two bad days, not proof
  const two = Array.from({ length: 120 }, (_, k) => ({ r: k % 3 ? -1 : 1, entryT: T0, exitT: T0 + (k % 2) * DAY }));
  assert.strictEqual(demoteCheck(two, { all: { maxDDR: 1000 } }).demote, false);
  assert.strictEqual(demoteCheck(two.map((t) => t.r), { all: { maxDDR: 1000 } }).demote, true, 'plain R lists keep the old per-trade test');
});

test('sentinel: nonsense ideas and new coins never reach fusion', () => {
  const now = T0, inst = (c) => (c === 'NEW' ? { listedAt: now - 5 * DAY } : { listedAt: now - 400 * DAY });
  const ctx = { now, inst };
  assert.strictEqual(checkIdea(idea('a', 's', 'ETH', 1, 100, 98), ctx), null);
  assert.match(checkIdea(idea('b', 's', 'IRYS', -1, 0.1, 0.443, { target: -0.2 }), ctx), /target price -0.2/);
  assert.match(checkIdea(idea('c', 's', 'IRYS', -1, 0.1, 0.443), ctx), /343\.0% from the entry/);
  assert.match(checkIdea(idea('d', 's', 'ETH', 1, 100, 99.9), ctx), /less than 2× the 15 bps/);
  assert.match(checkIdea(idea('e', 's', 'NEW', 1, 100, 98), ctx), /listed 5 days ago/);
  assert.strictEqual(checkIdea(idea('f', 's', 'NEW', 1, 100, 98), { now, inst: () => ({}) }), null, 'an unknown listing date is not a reason');
  assert.match(checkIdea(idea('g', 's', 'ETH', 1, 100, 85), { now, inst, cfg: { sentinel: { maxStopDistPct: 0.1 } } }), /at most 10%/);
});

test('sentinel in the coordinator: a rejected idea is logged as a risk decision and sends no order', async () => {
  let now = Date.UTC(2026, 9, 24, 3);
  const bus = new MemoryBus({ now: () => now }), cfg = baseCfg();
  cfg.strategies = { s1: { mode: 'trade' } }; cfg.trading = { account: 'paper', cycleMs: 20 };
  await bus.kv.set('universe', { coins: ['ETH', 'IRYS'].map((c) => ({ coin: c, instId: `${c}-USDT`, ct: 0.01, min: 1 })) });
  const co = new Coordinator({ bus, cfg, dataDir: tmpDir('sentinel'), now: () => now, heartbeats: false, logSink: quiet });
  await co.start();
  try {
    const got = tap(bus, ['order', 'risk.decision']);
    co.account = { equity: 10000, dayStart: 10000, peak: 10000 }; co.positions = { ts: now, open: [], working: [] };
    await bus.publish('idea', Object.assign(idea('bad', 's1', 'IRYS', -1, 0.1, 0.443, { target: -0.2 }), { mode: 'trade', riskPct: 3.43 }));
    await bus.publish('idea', Object.assign(idea('good', 's1', 'ETH', 1, 100, 98), { mode: 'trade', riskPct: 0.02 }));
    await bus.drain(); await sleep(80); await bus.drain();
    const orders = got.filter((m) => m.type === 'order').map((m) => m.data.coin);
    assert.deepStrictEqual(orders, ['ETH']);
    const rej = got.find((m) => m.type === 'risk.decision' && m.data.id === 'bad');
    assert.strictEqual(rej.data.verdict, 'reject'); assert.match(rej.data.reasons[0], /^sentinel: target price/);
    assert.strictEqual(co.metrics.sentinelRejects, 1);
  } finally { await co.stop(); }
});

test('data guard: a coin that jumps in an hour gets no new risk for 24 h; calm coins stay tradable', async () => {
  let now = Date.UTC(2026, 9, 23, 0);
  const bus = new MemoryBus({ now: () => now }), dataDir = tmpDir('shock');
  await bus.kv.set('universe', { coins: [{ coin: 'IRYS' }, { coin: 'ETH' }] });
  const st = tap(bus, 'guard.status');
  const g = new DataGuard({ bus, cfg: baseCfg(), dataDir, now: () => now, heartbeats: false, logSink: quiet });
  await g.start();
  try {
    const bar = (coin, t, h, l) => bus.publish('md.bar', { coin, venue: 'blofin', tf: '1m', t, o: l, h, l, c: h, v: 1, q: 1 });
    const book = (coin, px) => bus.publish('md.book', { coin, ts: now, bids: [[px, 1]], asks: [[px * 1.0001, 1]], mid: px, spreadBps: 1 });
    // no history yet: the limit is 30% in an hour. ETH drifts 0.5%; IRYS goes 0.10 → 0.18 in 40 minutes
    for (let k = 0; k < 60; k++) {
      now += 60000;
      await bar('ETH', now - 60000, 2000 * (1 + 0.00008 * k), 2000 * (1 + 0.00008 * k) * 0.9995);
      await bar('IRYS', now - 60000, k < 20 ? 0.1 : 0.1 + 0.002 * (k - 19), k < 20 ? 0.0999 : 0.1 + 0.002 * (k - 20));
    }
    await book('ETH', 2010); await book('IRYS', 0.18); await bus.drain(); await g.evaluate(); await bus.drain();
    let s = st[st.length - 1].data.coins;
    assert.deepStrictEqual(s.ETH.reasons, []);
    assert.deepStrictEqual(s.IRYS.reasons, ['shock']); assert.match(s.IRYS.shock.why, /% range in an hour \(limit 30%\)/);
    // it survives a restart, and lasts 24 h
    await g.stop();
    const g2 = new DataGuard({ bus, cfg: baseCfg(), dataDir, now: () => now, heartbeats: false, logSink: quiet });
    await g2.start();
    await bar('IRYS', now, 0.18, 0.179); await book('IRYS', 0.18); await bar('ETH', now, 2010, 2009); await book('ETH', 2010); await bus.drain();
    await g2.evaluate(); await bus.drain();
    assert.deepStrictEqual(st[st.length - 1].data.coins.IRYS.reasons, ['shock']);
    now += 25 * 3600000;
    await bar('IRYS', now - 60000, 0.18, 0.179); await book('IRYS', 0.18); await bar('ETH', now - 60000, 2010, 2009); await book('ETH', 2010); await bus.drain();
    await g2.evaluate(); await bus.drain();
    assert.deepStrictEqual(st[st.length - 1].data.coins.IRYS.reasons, []);
    await g2.stop();
  } finally { await g.stop().catch(() => {}); }
});

test('cost tracker: implementation shortfall of entries and exits, in bps and in R', () => {
  const c = new CostTracker();
  c.onBook({ coin: 'ETH', mid: 2000 });
  c.onOrder({ id: 'o1', coin: 'ETH', side: 1, entry: { px: 1999 }, stop: 1980, strategies: [{ name: 's1' }] }, T0);
  // a maker buy filled at 1999.8, below the 2000 mid it was decided at: it earned 1 bp, paid a 2 bps fee
  const e = c.onFill({ orderId: 'o1', coin: 'ETH', side: 1, qty: 1, px: 1999.8, feeUsd: 1999.8 * 0.0002, kind: 'maker', role: 'entry', ts: T0 });
  assert.strictEqual(e.slipBps, -1); assert.strictEqual(e.feeBps, 2); assert.strictEqual(e.costBps, 1);
  assert.strictEqual(e.riskBps, 99); assert.ok(Math.abs(e.costR - 1 / 99) < 1e-4); assert.deepStrictEqual(e.strategies, ['s1']);
  // the stop exit: decided at the stop price 1980, filled 1979.6 (a sell 2 bps lower), taker fee 6 bps
  c.onPositions([{ coin: 'ETH', side: 1, entry: 1999.8, stop: 1980, target: null, orderId: 'o1', strategies: ['s1'] }]);
  const x = c.onFill({ orderId: 'o1', coin: 'ETH', side: -1, qty: 1, px: 1979.604, feeUsd: 1979.604 * 0.0006, kind: 'taker', role: 'exit', reason: 'stop', ts: T0 + 1 });
  assert.strictEqual(x.basis, 'stop price'); assert.strictEqual(x.slipBps, 2); assert.strictEqual(x.costBps, 8);
  assert.deepStrictEqual(c.model().ETH, { entryBps: 1, exitBps: 8, fills: 2 });
  assert.strictEqual(c.onFill({ orderId: 'unknown', coin: 'ETH', side: 1, qty: 1, px: 1, feeUsd: 0, kind: 'maker', role: 'entry', ts: 0 }), null);
});

test('cost tracker in the accountant: every paper fill becomes an exec.cost and a per-coin model', async () => {
  let now = Date.UTC(2026, 9, 24, 12);
  const bus = new MemoryBus({ now: () => now }), dataDir = tmpDir('cost'), cfg = baseCfg();
  cfg.strategies = { s1: { mode: 'trade' } }; cfg.trading = { account: 'paper', paperEquity: 10000, cycleMs: 20 };
  await bus.kv.set('universe', { coins: [{ coin: 'ETH', instId: 'ETH-USDT', ct: 0.01, min: 1 }] });
  const ctx = { bus, cfg, dataDir, now: () => now, heartbeats: false, logSink: quiet };
  const acc = await new Accountant(ctx).start(), tr = await new Trader(ctx).start(), co = await new Coordinator(ctx).start();
  try {
    const got = tap(bus, ['exec.cost']);
    await bus.publish('md.book', { coin: 'ETH', ts: now, bids: [[2000, 50]], asks: [[2000.2, 50]], mid: 2000.1, spreadBps: 1 });
    await bus.publish('idea', Object.assign(idea('i1', 's1', 'ETH', 1, 2000, 1980), { target: 2030, mode: 'trade', riskPct: 0.01 }));
    await bus.drain(); await sleep(60); await bus.drain();
    await bus.publish('md.trade', { coin: 'ETH', trades: [[now, 1999.9, 1, -1]] }); await bus.drain();
    await tr.publishPositions(); await bus.drain();
    await bus.publish('md.trade', { coin: 'ETH', trades: [[now, 2030.5, 1, 1]] }); await bus.drain();
    const recs = got.map((m) => m.data);
    assert.deepStrictEqual(recs.map((r) => [r.role, r.basis]), [['entry', 'mid at the order'], ['exit', 'target price']]);
    assert.ok(recs[0].slipBps < 0, 'a maker entry below the mid earns part of the spread');
    assert.strictEqual(recs[1].slipBps, 0); assert.strictEqual(recs[1].feeBps, 2);
    assert.ok((await bus.kv.get('execCost')).coins.ETH.fills === 2);
  } finally { await co.stop(); await tr.stop(); await acc.stop(); }
});

test('promotion rule v2: the long history selects, the live record only vetoes', () => {
  const now = T0 + 40 * DAY;
  const v = (name, avgR, years, sumR15 = 100) => ({ name, full: { n: 2000, avgR, sumR15 }, years });
  const sweep = {
    'ma-retest@720': v('ma-retest@720', 0.12, { 2022: 1, 2023: 1, 2024: 1, 2025: 1 }),
    'ma-retest@240': v('ma-retest@240', 0.027, { 2022: 1, 2023: 1, 2024: 1, 2025: -1 }),
    'ma-retest@1440': v('ma-retest@1440', 0.18, { 2022: 1, 2023: 1, 2024: 1, 2025: 1 }),
    'intraday-trend@30': v('intraday-trend@30', -0.04, { 2022: -1, 2023: -1, 2024: -1, 2025: -1 }, -500),
    'rsi-macd-trend@720': v('rsi-macd-trend@720', 0.08, { 2022: 1, 2023: -1, 2024: 1, 2025: 1 }),
  };
  const era = { 'ma-retest-1d': { cost15: { avgR: -0.17 } }, 'ma-retest-12h': { cost15: { avgR: 0.29 } } };
  // 30 losing days for rsi-macd-trend-12h on paper: the veto; intraday-trend's lucky shadow week cannot promote it
  const shadow = Array.from({ length: 30 }, (_, k) => ({ strategy: 'rsi-macd-trend-12h', r: k % 4 ? -1 : 0.5, entryT: T0 + k * DAY, exitT: T0 + k * DAY + 3600000 }))
    .concat(Array.from({ length: 40 }, (_, k) => ({ strategy: 'intraday-trend', r: 1.2, entryT: now - 3 * DAY + k * 60000, exitT: now - 2 * DAY })));
  const state = { strategyModes: { 'ma-retest-12h': 'shadow', 'ma-retest-4h': 'trade', 'ma-retest-1d': 'shadow', 'intraday-trend': 'trade', 'rsi-macd-trend-12h': 'trade', 'candle-x-1h': 'trade', 'old': 'off' } };
  const factory = { 'candle-x-1h': { all: { n: 2000, avgR: -0.15, tStat: -5 } } };
  const rows = P2.decide({ state, shadow, sweep, era, factory, now });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.strictEqual(by['ma-retest-12h'].verdict, 'trade');
  assert.match(by['ma-retest-4h'].why, /minimum edge/); assert.strictEqual(by['ma-retest-4h'].verdict, 'shadow');
  assert.match(by['ma-retest-1d'].why, /era test/);
  assert.strictEqual(by['intraday-trend'].verdict, 'shadow', 'a hot week does not beat five losing years');
  assert.match(by['rsi-macd-trend-12h'].why, /live veto: clustered t -/);
  assert.match(by['candle-x-1h'].why, /retirement candidate/);
  assert.strictEqual(by.old.verdict, 'off');
  assert.deepStrictEqual(rows.filter(P2.changed).map((r) => r.name).sort(), ['candle-x-1h', 'intraday-trend', 'ma-retest-12h', 'ma-retest-4h', 'rsi-macd-trend-12h']);
  assert.match(P2.markdown(rows, 'now', 'test'), /Trade by the rule: \*\*ma-retest-12h\*\*/);
  // the out-of-sample route needs 150 trades over 60 active days at clustered t ≥ 2.5
  const oos = Array.from({ length: 160 }, (_, k) => ({ strategy: 'new-1h', r: k % 3 ? 1 : -0.6, entryT: T0 - 80 * DAY + Math.floor(k / 2) * DAY, exitT: T0 - 80 * DAY + Math.floor(k / 2) * DAY + 3600000 }));
  assert.strictEqual(P2.decide({ state: { strategyModes: { 'new-1h': 'shadow' } }, shadow: oos, now }).find((r) => r.name === 'new-1h').verdict, 'trade');
});

test('promotion rule v2: the newest dated sweep in a history folder is used', () => {
  const dir = tmpDir('sweeps');
  for (const d of ['2026-10-20', '2026-10-23']) { fs.mkdirSync(path.join(dir, d)); fs.writeFileSync(path.join(dir, d, 'results.json'), '{"variants":{}}'); }
  fs.mkdirSync(path.join(dir, '2026-10-25'));
  assert.strictEqual(P2.sweepFile(dir), path.join(dir, '2026-10-23', 'results.json'));
});
