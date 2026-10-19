'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { MemoryBus } = require('../src/core/bus');
const { DataGuard } = require('../src/market/data_guard');
const { Recorder, readRecording } = require('../src/market/recorder');
const { tmpDir, quiet, baseCfg, tap } = require('./helpers');

test('data guard: fresh, stale, wide spread, venue divergence', async () => {
  let now = 1792400000000;
  const bus = new MemoryBus({ now: () => now });
  await bus.kv.set('universe', { coins: [{ coin: 'BTC' }, { coin: 'ETH' }, { coin: 'SOL' }] });
  const st = tap(bus, 'guard.status');
  const g = new DataGuard({ bus, cfg: baseCfg(), now: () => now, heartbeats: false, logSink: quiet });
  await g.start();
  const book = (coin, bid, ask) => bus.publish('md.book', { coin, ts: now, bids: [[bid, 1]], asks: [[ask, 1]], mid: (bid + ask) / 2, spreadBps: ((ask - bid) / ((ask + bid) / 2)) * 1e4 });
  const bar = (coin) => bus.publish('md.bar', { coin, venue: 'blofin', tf: '1m', t: now - 60000, o: 1, h: 1, l: 1, c: 1, v: 1, q: 1 });
  await book('BTC', 79999, 80001); await bar('BTC');
  await book('ETH', 2390, 2410); await bar('ETH'); // 84 bps spread
  await book('SOL', 100, 100.02); await bar('SOL');
  await bus.publish('ref.flow', { ts: now - 1000, coins: { BTC: { buyQ: 1, sellQ: 1, n: 1, last: 80010, hi: 1, lo: 1 }, SOL: { buyQ: 1, sellQ: 1, n: 1, last: 102, hi: 1, lo: 1 } } });
  await bus.drain(); await g.evaluate(); await bus.drain();
  let s = st[st.length - 1].data.coins;
  assert.deepStrictEqual([s.BTC.tradable, s.BTC.refOk, s.BTC.reasons], [true, true, []]);
  assert.deepStrictEqual(s.ETH.reasons, ['wide-spread']); assert.strictEqual(s.ETH.refOk, false);
  assert.deepStrictEqual(s.SOL.reasons, ['price-divergence']);
  now += 40000; // nothing new for 40 s
  await g.evaluate(); await bus.drain();
  s = st[st.length - 1].data.coins;
  assert.ok(s.BTC.reasons.includes('blofin-stale')); assert.strictEqual(s.BTC.refOk, false);
  const kv = await bus.kv.get('guard');
  assert.strictEqual(kv.spreads.BTC, 0.25);
  await g.stop();
});

test('recorder: writes by UTC hour, compresses old hours, reads back in time order', async () => {
  const dataDir = tmpDir('rec');
  let now = Date.UTC(2026, 9, 19, 10, 59, 59);
  const bus = new MemoryBus({ now: () => now });
  const cfg = baseCfg();
  const r = new Recorder({ bus, cfg, dataDir, now: () => now, heartbeats: false, logSink: quiet });
  await r.start();
  const trade = (ts, px) => bus.publish('md.trade', { coin: 'BTC', trades: [[ts, px, 1, 1]] }, { ts });
  await trade(Date.UTC(2026, 9, 19, 10, 59, 58), 1);
  await bus.publish('ref.flow', { ts: Date.UTC(2026, 9, 19, 10, 59, 59), coins: {} }, { ts: Date.UTC(2026, 9, 19, 10, 59, 59) });
  await trade(Date.UTC(2026, 9, 19, 11, 0, 1), 2);
  await bus.drain(); r.flush();
  assert.ok(fs.existsSync(path.join(dataDir, 'rec', '2026-10-19', '10', 'md.trade.jsonl')));
  assert.ok(fs.existsSync(path.join(dataDir, 'rec', '2026-10-19', '11', 'md.trade.jsonl')));
  now = Date.UTC(2026, 9, 19, 12, 15);
  r.compress();
  assert.ok(fs.existsSync(path.join(dataDir, 'rec', '2026-10-19', '10', 'md.trade.jsonl.gz')));
  assert.ok(!fs.existsSync(path.join(dataDir, 'rec', '2026-10-19', '10', 'md.trade.jsonl')));
  // a late line for an hour that is already compressed becomes a second gzip member
  await trade(Date.UTC(2026, 9, 19, 10, 30), 0.5); await bus.drain(); r.flush(); r.compress();
  const gz = zlib.gunzipSync(fs.readFileSync(path.join(dataDir, 'rec', '2026-10-19', '10', 'md.trade.jsonl.gz'))).toString().trim().split('\n');
  assert.strictEqual(gz.length, 2);
  const back = [];
  for await (const m of readRecording(dataDir, { types: ['md.*', 'ref.flow'] })) back.push([m.type, m.ts]);
  assert.deepStrictEqual(back.map((x) => x[0]), ['md.trade', 'md.trade', 'ref.flow', 'md.trade']);
  assert.deepStrictEqual(back.map((x) => x[1]), [Date.UTC(2026, 9, 19, 10, 30), Date.UTC(2026, 9, 19, 10, 59, 58), Date.UTC(2026, 9, 19, 10, 59, 59), Date.UTC(2026, 9, 19, 11, 0, 1)]);
  const only11 = []; for await (const m of readRecording(dataDir, { from: Date.UTC(2026, 9, 19, 11) })) only11.push(m.ts);
  assert.deepStrictEqual(only11, [Date.UTC(2026, 9, 19, 11, 0, 1)]);
  now = Date.UTC(2026, 11, 30); r.housekeep();
  assert.ok(!fs.existsSync(path.join(dataDir, 'rec', '2026-10-19')), 'recordings older than keepDays are deleted');
  await r.stop();
});
