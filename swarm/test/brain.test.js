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

test('features: long timeframes seeded with their own bars; the 1-minute replay does not count them twice', () => {
  const { FeatureState } = require('../src/analysis/features');
  const fs1 = new FeatureState({ tfs: [1, 60, 1440] }), D = 86400000, H = 3600000;
  const days = []; for (let i = 0; i < 250; i++) days.push({ t: i * D, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1, q: 100 });
  assert.strictEqual(fs1.seed('X', 1440, days), 250);
  const h = fs1.history('X', 1440);
  assert.strictEqual(h.len, 250); assert.strictEqual(h.at(0).t, 249 * D);
  // 1-minute bars from inside the last seeded day are skipped for 1d; the next day builds normally
  let evs = [];
  for (let m = 0; m < 60 * 24 * 2; m++) evs = evs.concat(fs1.onBar1m('X', { t: 249 * D + m * 60000, o: 400, h: 401, l: 399, c: 400, v: 1, q: 10 }));
  const daily = evs.filter((e) => e.tf === 1440);
  assert.deepStrictEqual(daily.map((e) => e.t), [250 * D], 'only the new day closes');
  assert.strictEqual(daily[0].f.bars, 251);
  assert.ok(Number.isFinite(daily[0].f.ema50) && daily[0].f.atr > 0);
  assert.strictEqual(fs1.seed('X', 60, []), 0);
});

test('brain: 12h and daily bars are built from 4h bars in UTC; an incomplete bucket is dropped', () => {
  const { aggregate } = require('../src/agents/brain');
  const H4 = 4 * 3600000, D = 86400000;
  const h4 = []; for (let i = 1; i < 6 * 3 + 2; i++) h4.push({ t: i * H4, o: i, h: i + 0.5, l: i - 0.5, c: i + 0.2, v: 1, q: 10 }); // starts at 04:00: day 0 incomplete
  const days = aggregate(h4, 240, 1440);
  assert.deepStrictEqual(days.map((d) => d.t), [D, 2 * D]);
  assert.deepStrictEqual([days[0].o, days[0].c, days[0].q], [6, 11.2, 60]);
  const halves = aggregate(h4, 240, 720);
  assert.strictEqual(halves[0].t, 12 * 3600000); assert.strictEqual(halves.length, 5);
  const gap = h4.filter((b) => b.t !== 8 * H4); // a missing 4h bar inside day 1
  assert.deepStrictEqual(aggregate(gap, 240, 1440).map((d) => d.t), [2 * D]);
});

test('brain on 8 GB: keepBars bars per timeframe, and seed4hBars pages back through BloFin so 1d starts with 720 days', async () => {
  const bus = new MemoryBus({ now: () => T0 });
  const cfg = baseCfg(); cfg.brain.warmup = false; cfg.brain.keepBars = 1000; cfg.brain.seed4hBars = 4320; cfg.strategies = {};
  const b = new Brain({ bus, cfg, now: () => T0, heartbeats: false, logSink: quiet, strategies: [], paceMs: 0 });
  await b.start();
  try {
    assert.strictEqual(b.fs.keep, 1000);
    const H4 = 240 * MIN, end = Math.floor(T0 / 86400000) * 86400000, calls = [];
    // a fake BloFin: 4h bars before `after` (or before the end), newest last, at most `limit`, 3,000 in all
    const get = async (bar, limit, after) => {
      calls.push([bar, limit, after || null]);
      const out = [];
      for (let t = (after || end) - H4; out.length < limit && t >= end - 3000 * H4; t -= H4) out.unshift({ t, o: 1, h: 1.01, l: 0.99, c: 1, v: 1, q: 1 });
      return out;
    };
    const h4 = await b.pages(get, '4H', 4320);
    assert.strictEqual(h4.length, 3000, 'stops when BloFin has no older bars');
    assert.deepStrictEqual(calls.map((c) => c[1]), [1440, 1440, 1440, 1320], 'pages of at most 1440, the last asks only for what is missing');
    assert.ok(h4.every((x, k) => k === 0 || x.t - h4[k - 1].t === H4), 'one series, oldest first, no duplicates');
    calls.length = 0;
    await b.seedLong('BTC', [], get);
    assert.strictEqual(b.fs.history('BTC', 1440).len, 500, '3,000 4h bars = 500 daily bars (was at most 240)');
    assert.strictEqual(b.fs.history('BTC', 720).len, 1000, '12h: as many as keepBars');
  } finally { await b.stop(); }
});
