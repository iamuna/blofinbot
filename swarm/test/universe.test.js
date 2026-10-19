'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { MemoryBus } = require('../src/core/bus');
const { UniverseAgent } = require('../src/market/universe');
const { fakeHttp, makeZip, tmpDir, quiet, baseCfg } = require('./helpers');

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0), DAY = 86400000, today0 = Date.UTC(2026, 9, 19);
const day = (k) => new Date(NOW - k * DAY).toISOString().slice(0, 10);
// coin: [blofin last, bid, ask, binance symbol, binance price, 7-day avg quote volume]
const M = {
  BTC: [80000, 79999, 80001, 'BTCUSDT', 80010, 9e9],
  ETH: [2400, 2399.9, 2400.1, 'ETHUSDT', 2400.5, 7e9],
  PEPE: [0.0000040, 0.0000039999, 0.0000040001, '1000PEPEUSDT', 0.0040002, 2e8],
  LOW: [1, 0.9999, 1.0001, 'LOWUSDT', 1, 5e6],
  WIDE: [1, 0.999, 1.001, 'WIDEUSDT', 1, 5e7],
  MID: [2, 1.9999, 2.0001, 'MIDUSDT', 2, 1.5e7],
  TSLA: [400, 399.9, 400.1, null, 0, 0],
};
function routes(o = {}) {
  const inst = Object.keys(M).map((c) => ({ instId: `${c}-USDT`, baseCurrency: c, quoteCurrency: 'USDT', contractValue: '0.1', lotSize: '1', minSize: '1', tickSize: '0.0001', maxLeverage: '50', contractType: 'linear', state: 'live' }));
  inst.push({ instId: 'OLD-USDT', baseCurrency: 'OLD', contractValue: '1', lotSize: '1', minSize: '1', tickSize: '0.1', contractType: 'linear', state: 'suspend' });
  const tick = Object.entries(M).map(([c, x]) => ({ instId: `${c}-USDT`, last: String(x[0]), bidPrice: String(x[1]), askPrice: String(x[2]), volCurrency24h: String(1e6 / x[0]) }));
  const syms = Object.values(M).filter((x) => x[3]);
  const r = [
    [/blofin.*instruments/, { code: '0', data: inst }],
    [/blofin.*market\/tickers/, { code: '0', data: tick }],
  ];
  if (o.binanceDown) r.push([/fapi\.binance/, new Error('HTTP 451 restricted location')]);
  else {
    r.push([/exchangeInfo/, { symbols: syms.map((x) => ({ symbol: x[3], status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT' })) }]);
    r.push([/ticker\/24hr/, syms.map((x) => ({ symbol: x[3], lastPrice: String(x[4]), quoteVolume: String(x[5]) }))]);
    r.push([/klines\?symbol=/, (url) => {
      const s = /symbol=([A-Z0-9]+)/.exec(url)[1], x = syms.find((y) => y[3] === s);
      return Array.from({ length: 8 }, (_, k) => [today0 - (7 - k) * DAY, '1', '1', '1', '1', '1', 0, String(k === 7 ? 1 : x[5])]);
    }]);
  }
  if (o.archive) r.push([/data\.binance\.vision/, (url) => {
    const s = /klines\/([A-Z0-9]+)\//.exec(url)[1], x = syms.find((y) => y[3] === s);
    if (!x) return null;
    return makeZip('k.csv', `open_time,open,high,low,close,volume,close_time,quote_volume\n${today0},1,1,1,${x[4]},1,0,${x[5]}\n`);
  }]);
  else r.push([/data\.binance\.vision/, new Error('archive unreachable')]);
  return r;
}
async function run(o = {}) {
  const dataDir = o.dataDir || tmpDir('uni'), cfg = baseCfg();
  cfg.universe.fallback = ['BTC', 'ETH', 'NOPE'];
  if (o.prev) { fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true }); fs.writeFileSync(path.join(dataDir, 'state', 'universe.json'), JSON.stringify(o.prev)); }
  const bus = new MemoryBus({ now: () => NOW });
  const pubs = []; bus.subscribe('uni.list', (m) => pubs.push(m.data));
  const http = fakeHttp(routes(o));
  const a = new UniverseAgent({ bus, cfg, dataDir, http, now: () => NOW, heartbeats: false, logSink: quiet, paceMs: 0 });
  await a.start(); await a.stop(); await bus.drain();
  return { list: pubs[pubs.length - 1], pubs, http, dataDir, kv: await bus.kv.get('universe') };
}

test('selects coins over $20M on Binance with tight BloFin spreads', async () => {
  const { list, kv } = await run();
  assert.deepStrictEqual(list.coins.map((c) => c.coin), ['BTC', 'ETH', 'PEPE']);
  const pepe = list.coins.find((c) => c.coin === 'PEPE');
  assert.deepStrictEqual(pepe.binance, { symbol: '1000PEPEUSDT', scale: 1000 });
  assert.strictEqual(pepe.vol7d, 2e8); assert.strictEqual(pepe.ct, 0.1);
  assert.strictEqual(list.stale, false); assert.strictEqual(list.source, 'binance api');
  assert.deepStrictEqual(kv.coins.map((c) => c.coin), ['BTC', 'ETH', 'PEPE']);
});

test('a listed coin stays until it falls below $14M (hysteresis)', async () => {
  const prev = { ts: NOW - 3600000, coins: [{ coin: 'MID' }, { coin: 'BTC' }, { coin: 'LOW' }], stale: false };
  const { list } = await run({ prev });
  assert.deepStrictEqual(list.coins.map((c) => c.coin), ['BTC', 'ETH', 'PEPE', 'MID']);
  assert.deepStrictEqual(list.removed, ['LOW']);
  assert.deepStrictEqual(list.added.sort(), ['ETH', 'PEPE']);
});

test('falls back to the Binance archive when the API is blocked, and caches it', async () => {
  const r1 = await run({ binanceDown: true, archive: true });
  assert.deepStrictEqual(r1.list.coins.map((c) => c.coin), ['BTC', 'ETH', 'PEPE']);
  assert.match(r1.list.source, /archive/);
  assert.strictEqual(r1.list.coins.find((c) => c.coin === 'PEPE').binance.scale, 1000);
  const fetched = r1.http.calls.filter((u) => /binance\.vision/.test(u)).length;
  const r2 = await run({ binanceDown: true, archive: true, dataDir: r1.dataDir });
  const again = r2.http.calls.filter((u) => /binance\.vision/.test(u)).length;
  assert.ok(again < fetched / 3, `cached archive days are not fetched again (${again} vs ${fetched})`);
});

test('with no volume source it keeps the saved list, or uses the configured fallback', async () => {
  const { list } = await run({ binanceDown: true });
  assert.deepStrictEqual(list.coins.map((c) => c.coin), ['BTC', 'ETH']);
  assert.strictEqual(list.stale, true); assert.match(list.source, /fallback/);
  const prev = { ts: NOW - 3600000, coins: [{ coin: 'MID', instId: 'MID-USDT' }, { coin: 'GONE', instId: 'GONE-USDT' }] };
  const r = await run({ binanceDown: true, prev });
  assert.strictEqual(r.pubs[0].stale, true, 'the saved list is published at start, marked stale');
  assert.deepStrictEqual(r.list.coins.map((c) => c.coin), ['MID']);
  assert.match(r.list.source, /kept previous/);
});

test('symbol mapping checks the price scale', () => {
  assert.strictEqual(UniverseAgent.scaleFor(0.004, 0.000004), 1000);
  assert.strictEqual(UniverseAgent.scaleFor(3, 1), null);
  assert.deepStrictEqual(UniverseAgent.symbolCandidates('1000BONK').slice(-1), ['BONKUSDT']);
});
