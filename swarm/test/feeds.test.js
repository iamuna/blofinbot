'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MemoryBus } = require('../src/core/bus');
const { BlofinFeed } = require('../src/market/blofin_feed');
const { BinanceFeed } = require('../src/market/binance_feed');
const { FakeWS, fakeHttp, quiet, baseCfg, sleep, tap } = require('./helpers');

const UNI = { ts: 1, stale: false, source: 'test', added: [], removed: [], coins: [
  { coin: 'BTC', instId: 'BTC-USDT', ct: 0.001, binance: { symbol: 'BTCUSDT', scale: 1 } },
  { coin: 'PEPE', instId: 'PEPE-USDT', ct: 1000, binance: { symbol: '1000PEPEUSDT', scale: 1000 } },
] };
async function setup(Agent, http) {
  FakeWS.reset();
  const bus = new MemoryBus();
  await bus.kv.set('universe', UNI);
  const got = tap(bus, ['md.*', 'ref.*']);
  const a = new Agent({ bus, cfg: baseCfg(), dataDir: '/tmp', WebSocket: FakeWS, http: http || fakeHttp([]), heartbeats: false, logSink: process.env.DBG ? console.log : quiet, minOpenGapMs: 0, restDelayMs: 0, paceMs: 0 });
  await a.start();
  await sleep(20);
  return { bus, a, got, ws: FakeWS.all };
}

test('BloFin feed: subscribes, converts contracts to base units, batches trades, throttles books', async () => {
  const candles = { code: '0', data: [['1792400040000', '80100', '80200', '80000', '80150', '10', '0.01', '801.5', '1'], ['1792400100000', '1', '1', '1', '1', '1', '1', '1', '0']] };
  const { bus, a, got, ws } = await setup(BlofinFeed, fakeHttp([[/candles/, candles]]));
  try {
    assert.strictEqual(ws.length, 1);
    const sub = JSON.parse(ws[0].sent[0]);
    assert.strictEqual(sub.op, 'subscribe'); assert.strictEqual(sub.args.length, 10);
    const w = ws[0];
    w.push({ arg: { channel: 'trades', instId: 'BTC-USDT' }, data: [{ instId: 'BTC-USDT', tradeId: '1', price: '80000', size: '5', side: 'buy', ts: '1792400000100' }, { instId: 'BTC-USDT', tradeId: '2', price: '79999', size: '2', side: 'sell', ts: '1792400000050' }] });
    w.push({ arg: { channel: 'books5', instId: 'PEPE-USDT' }, data: { asks: [['0.0000041', '3']], bids: [['0.0000039', '2']], ts: '1792400000200', seqId: 5 } });
    w.push({ arg: { channel: 'books5', instId: 'PEPE-USDT' }, data: [{ asks: [['0.0000040002', '3']], bids: [['0.0000040000', '2']], ts: '1792400000300' }] });
    w.push({ arg: { channel: 'tickers', instId: 'BTC-USDT' }, data: [{ instId: 'BTC-USDT', last: '80000', bidPrice: '79999.9', askPrice: '80000.1', bidSize: '100', askSize: '50', volCurrency24h: '2000', ts: '1792400000300' }] });
    w.push({ arg: { channel: 'funding-rate', instId: 'BTC-USDT' }, data: [{ instId: 'BTC-USDT', fundingRate: '0.0001', fundingTime: '1792425600000' }] });
    w.push({ arg: { channel: 'candle1m', instId: 'BTC-USDT' }, data: [['1792399980000', '80000', '80100', '79900', '80050', '12', '0.012', '960.6', '1']] });
    w.push({ arg: { channel: 'candle1m', instId: 'BTC-USDT' }, data: [['1792400040000', '80050', '80060', '80040', '80055', '1', '0.001', '80', '0']] });
    w.push({ arg: { channel: 'candle1m', instId: 'BTC-USDT' }, data: [['1792400100000', '80055', '80060', '80040', '80058', '1', '0.001', '80', '0']] }); // new minute, old one never confirmed → REST
    w.push('pong');
    await sleep(1300); await bus.drain();
    const trades = got.filter((m) => m.type === 'md.trade');
    assert.strictEqual(trades.length, 1);
    assert.deepStrictEqual(trades[0].data.trades, [[1792400000050, 79999, 0.002, -1], [1792400000100, 80000, 0.005, 1]]);
    const books = got.filter((m) => m.type === 'md.book');
    assert.strictEqual(books.length, 1, 'two book updates in one second → one md.book');
    assert.deepStrictEqual(books[0].data.bids, [[0.000004, 2000]]);
    assert.ok(Math.abs(books[0].data.spreadBps - 0.5) < 0.01);
    const tick = got.find((m) => m.type === 'md.ticker').data;
    assert.strictEqual(tick.bidSz, 0.1); assert.strictEqual(tick.vol24hQ, 160000000);
    assert.strictEqual(got.find((m) => m.type === 'md.funding').data.rate, 0.0001);
    const bars = got.filter((m) => m.type === 'md.bar').map((m) => [m.data.t, m.data.c, m.data.v, !!m.data.backfill]);
    assert.deepStrictEqual(bars, [[1792399980000, 80050, 0.012, false], [1792400040000, 80150, 0.01, true]]);
    assert.strictEqual(a.metrics.msgs, 8, "the pong is swallowed by the socket");
  } finally { await a.stop(); }
});

test('BloFin feed: resubscribes when the universe changes', async () => {
  const { bus, a } = await setup(BlofinFeed);
  try {
    await bus.publish('uni.list', Object.assign({}, UNI, { coins: UNI.coins.slice(0, 1) }));
    await bus.drain(); await sleep(30);
    const open = FakeWS.all.filter((w) => w.readyState === 1);
    assert.strictEqual(open.length, 1);
    assert.strictEqual(JSON.parse(open[0].sent[0]).args.length, 5);
    assert.strictEqual(FakeWS.all[0].readyState, 3, 'old connection closed');
  } finally { await a.stop(); }
});

test('Binance feed: flow buckets, closed klines, liquidations and marks in BloFin units', async () => {
  const http = fakeHttp([[/openInterest\?symbol=BTCUSDT/, { openInterest: '100' }], [/openInterest\?symbol=1000PEPEUSDT/, { openInterest: '5000000' }]]);
  const { bus, a, got, ws } = await setup(BinanceFeed, http);
  try {
    assert.strictEqual(ws.length, 1);
    assert.match(ws[0].url, /market\/stream\?streams=!forceOrder@arr\/!markPrice@arr@1s\/btcusdt@aggTrade\/btcusdt@kline_1m\/1000pepeusdt@aggTrade/);
    const w = ws[0];
    const agg = (s, p, q, m, T) => ({ stream: `${s.toLowerCase()}@aggTrade`, data: { e: 'aggTrade', s, p: String(p), q: String(q), m, T } });
    w.push(agg('BTCUSDT', 80000, 0.5, false, 1792400000100));
    w.push(agg('BTCUSDT', 80010, 0.25, true, 1792400000500));
    w.push(agg('1000PEPEUSDT', 0.004, 1000000, false, 1792400000600));
    w.push({ stream: 'btcusdt@kline_1m', data: { e: 'kline', s: 'BTCUSDT', k: { t: 1792399980000, s: 'BTCUSDT', o: '1', h: '2', l: '0.5', c: '1.5', v: '10', q: '15', Q: '9', n: 120, x: false } } });
    w.push({ stream: '1000pepeusdt@kline_1m', data: { e: 'kline', s: '1000PEPEUSDT', k: { t: 1792399980000, s: '1000PEPEUSDT', o: '0.004', h: '0.0041', l: '0.0039', c: '0.004', v: '2000000', q: '8000', Q: '5000', n: 50, x: true } } });
    w.push({ stream: '!forceOrder@arr', data: { e: 'forceOrder', E: 1792400000700, o: { s: '1000PEPEUSDT', S: 'SELL', q: '1000000', p: '0.0039', ap: '0.0039', z: '1000000', T: 1792400000690 } } });
    w.push({ stream: '!markPrice@arr@1s', data: [{ e: 'markPriceUpdate', s: 'BTCUSDT', p: '80005', i: '80000', r: '0.0001', T: 1792425600000 }, { e: 'markPriceUpdate', s: '1000PEPEUSDT', p: '0.004', i: '0.004', r: '-0.0002', T: 1792425600000 }] });
    await a.chain; await a.flushFlow(); await a.flushMark(); await a.pollOI(); await bus.drain();
    const flow = got.find((m) => m.type === 'ref.flow').data;
    assert.deepStrictEqual(flow.coins.BTC, { buyQ: 40000, sellQ: 20003, n: 2, last: 80010, hi: 80010, lo: 80000 });
    assert.strictEqual(flow.coins.PEPE.last, 0.000004); assert.strictEqual(flow.coins.PEPE.buyQ, 4000);
    const bars = got.filter((m) => m.type === 'ref.bar');
    assert.strictEqual(bars.length, 1, 'only closed klines');
    assert.strictEqual(bars[0].data.c, 0.000004); assert.strictEqual(bars[0].data.v, 2e9); assert.strictEqual(bars[0].data.buyQ, 5000);
    const liq = got.find((m) => m.type === 'ref.liq').data;
    assert.deepStrictEqual([liq.coin, liq.side, liq.qty, liq.quote], ['PEPE', 'long', 1e9, 3900]);
    assert.ok(Math.abs(liq.px - 0.0000039) < 1e-15);
    const mark = got.find((m) => m.type === 'ref.mark').data;
    assert.strictEqual(mark.coins.BTC.funding, 0.0001); assert.ok(Math.abs(mark.coins.PEPE.mark - 0.000004) < 1e-15);
    const oi = got.find((m) => m.type === 'ref.oi').data;
    assert.deepStrictEqual(oi.coins.BTC, { oi: 100, oiQ: 8000500 }); assert.strictEqual(oi.coins.PEPE.oi, 5e9);
  } finally { await a.stop(); }
});
