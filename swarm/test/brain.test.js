'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MemoryBus } = require('../src/core/bus');
const { Brain } = require('../src/agents/brain');
const { EventCalendar } = require('../src/agents/event_calendar');
const { quiet, baseCfg, tap, sleep, fakeHttp, tmpDir } = require('./helpers');

const MIN = 60000, T0 = Date.UTC(2026, 9, 20, 10, 0);
const UNI = { ts: 1, stale: false, source: 't', added: [], removed: [], coins: [
  { coin: 'BTC', instId: 'BTC-USDT', ct: 0.001, binance: { symbol: 'BTCUSDT', scale: 1 } },
  { coin: 'ETH', instId: 'ETH-USDT', ct: 0.01, binance: { symbol: 'ETHUSDT', scale: 1 } },
  { coin: 'XMR', instId: 'XMR-USDT', ct: 0.1, binance: null },
] };
// takes every green 1-minute bar: target +0.1%, stop −0.5%
const greedy = { name: 'greedy', version: 1, tfs: [1], params: {}, onBar: (ev) => (ev.bar.c > ev.bar.o ? { coin: ev.coin, side: 1, entry: { kind: 'taker', px: ev.bar.c }, stop: ev.bar.c * 0.995, target: ev.bar.c * 1.001, timeStopMin: 30, why: 'green' } : null) };

test('brain: minute batches (Binance first, BloFin fallback with BloFin flow), features, ideas, shadow trades', async () => {
  let now = T0;
  const bus = new MemoryBus({ now: () => now });
  await bus.kv.set('universe', UNI);
  const got = tap(bus, ['feat.bar', 'idea', 'shadow.*', 'regime.state']);
  const cfg = baseCfg(); cfg.brain.warmup = false; cfg.strategies = { greedy: { mode: 'shadow' } };
  const b = new Brain({ bus, cfg, now: () => now, heartbeats: false, logSink: quiet, strategies: [greedy] });
  await b.start();
  const bar = (type, coin, t, o, c, extra) => bus.publish(type, Object.assign({ coin, venue: type === 'ref.bar' ? 'binance' : 'blofin', tf: '1m', t, o, h: Math.max(o, c) * 1.0005, l: Math.min(o, c) * 0.9995, c, v: 1, q: 1000 }, type === 'ref.bar' ? { buyQ: 600, n: 10 } : {}, extra));
  for (let k = 0; k < 20; k++) {
    const t = T0 + k * MIN; now = t + MIN + 500;
    const up = k % 2 === 0;
    await bar('ref.bar', 'ETH', t, 2000 + k, up ? 2001 + k : 1999 + k);
    await bus.publish('md.trade', { coin: 'XMR', trades: [[t + 5000, 300, 1, 1], [t + 9000, 300, 3, -1]] });
    await bar('md.bar', 'XMR', t, 300, 300.5);
    await bar('ref.bar', 'BTC', t, 80000 + k, up ? 80010 + k : 79990 + k);
    await bus.drain(); // every coin is in → the minute is processed at once
  }
  await bus.drain();
  assert.strictEqual(b.metrics.bars_binance, 40); assert.strictEqual(b.metrics.bars_blofin, 20);
  const xmr = b.fs.history('XMR', 1).last;
  assert.strictEqual(xmr.bq, 250, 'BloFin flow: 1 of 4 units bought by takers → 25% of the bar volume');
  assert.strictEqual(b.fs.history('BTC', 1).last.bq, 600);
  const feats = got.filter((m) => m.type === 'feat.bar');
  assert.ok(feats.some((m) => m.data.tf === 5 && m.data.coin === 'ETH' && m.data.src === 'binance'));
  assert.ok(feats.some((m) => m.data.tf === 15 && m.data.coin === 'XMR' && m.data.src === 'blofin'));
  const ideas = got.filter((m) => m.type === 'idea');
  assert.ok(ideas.length >= 3); assert.ok(ideas.every((m) => m.data.mode === 'shadow' && m.data.strategy === 'greedy'));
  assert.ok(got.some((m) => m.type === 'shadow.trade' && m.data.reason === 'target'), 'shadow trades close on later live bars');
  assert.ok(got.some((m) => m.type === 'regime.state'));
  await b.stop();
});

test('brain: a minute is processed after 6 s even if a coin never sends a bar, BTC first', async () => {
  let now = T0;
  const bus = new MemoryBus({ now: () => now });
  await bus.kv.set('universe', UNI);
  const cfg = baseCfg(); cfg.brain.warmup = false; cfg.strategies = {};
  const order = [];
  const spy = { name: 'spy', tfs: [1], params: {}, onBar: (ev) => { order.push(ev.coin); return null; } };
  const b = new Brain({ bus, cfg, now: () => now, heartbeats: false, logSink: quiet, strategies: [spy] });
  await b.start();
  await bus.publish('ref.bar', { coin: 'ETH', venue: 'binance', tf: '1m', t: T0, o: 1, h: 1, l: 1, c: 1, v: 1, q: 1, buyQ: 1, n: 1 });
  await bus.publish('ref.bar', { coin: 'BTC', venue: 'binance', tf: '1m', t: T0, o: 1, h: 1, l: 1, c: 1, v: 1, q: 1, buyQ: 1, n: 1 });
  await bus.drain();
  assert.deepStrictEqual(order, []);
  now += 7000; b.flushDue();
  assert.deepStrictEqual(order, ['BTC', 'ETH']);
  await b.stop();
});

test('brain: no ideas inside an event window or on coins the guard stopped', async () => {
  let now = T0;
  const bus = new MemoryBus({ now: () => now });
  await bus.kv.set('universe', UNI);
  await bus.kv.set('events', { windows: [{ start: T0, end: T0 + 3 * MIN, title: 'USD CPI' }] });
  await bus.kv.set('guard', { coins: { ETH: { tradable: false, refOk: true, reasons: ['wide-spread'] } } });
  const cfg = baseCfg(); cfg.brain.warmup = false;
  const always = { name: 'always', tfs: [1], params: {}, onBar: (ev) => ({ coin: ev.coin, side: 1, entry: { kind: 'taker', px: ev.bar.c }, stop: ev.bar.c * 0.99, target: null, timeStopMin: 1 }) };
  const ideas = tap(bus, 'idea');
  const b = new Brain({ bus, cfg, now: () => now, heartbeats: false, logSink: quiet, strategies: [always] });
  await b.start();
  for (let k = 0; k < 6; k++) {
    now = T0 + (k + 1) * MIN + 100;
    for (const c of ['BTC', 'ETH']) await bus.publish('ref.bar', { coin: c, venue: 'binance', tf: '1m', t: T0 + k * MIN, o: 1, h: 1, l: 1, c: 1, v: 1, q: 1, buyQ: 1, n: 1 });
    await bus.publish('md.bar', { coin: 'XMR', venue: 'blofin', tf: '1m', t: T0 + k * MIN, o: 1, h: 1, l: 1, c: 1, v: 1, q: 1 });
    await bus.drain();
  }
  const coins = ideas.map((m) => m.data.coin);
  assert.ok(!coins.includes('ETH'), 'guard said ETH is not tradable');
  assert.ok(ideas.every((m) => m.data.t >= T0 + 3 * MIN), 'nothing while inside the CPI window');
  assert.ok(coins.includes('BTC'));
  await b.stop();
});

test('event calendar: high-impact USD events become windows; a failed feed keeps the saved list', async () => {
  const now = Date.UTC(2026, 9, 20, 8);
  const feed = [{ title: 'CPI m/m', country: 'USD', date: '2026-10-20T08:30:00-04:00', impact: 'High' }, { title: 'Retail', country: 'EUR', date: '2026-10-20T09:00:00+00:00', impact: 'High' }, { title: 'Speech', country: 'USD', date: '2026-10-20T15:00:00+00:00', impact: 'Low' }];
  const dataDir = tmpDir('ev');
  const run = async (http) => {
    const bus = new MemoryBus({ now: () => now });
    const a = new EventCalendar({ bus, cfg: baseCfg(), dataDir, http, now: () => now, heartbeats: false, logSink: quiet });
    await a.start(); await a.stop();
    return (await bus.kv.get('events')).windows;
  };
  const w = await run(fakeHttp([[/faireconomy/, feed]]));
  assert.strictEqual(w.length, 1);
  assert.deepStrictEqual([w[0].title, w[0].start, w[0].end], ['USD CPI m/m', Date.UTC(2026, 9, 20, 12, 25), Date.UTC(2026, 9, 20, 12, 40)]);
  const w2 = await run(fakeHttp([[/faireconomy/, new Error('down')]]));
  assert.deepStrictEqual(w2, w);
});
