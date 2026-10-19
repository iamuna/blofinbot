'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MemoryBus } = require('../src/core/bus');
const { Brain } = require('../src/agents/brain');
const { Coordinator } = require('../src/decision/coordinator');
const { Trader } = require('../src/exec/trader');
const { Accountant } = require('../src/exec/accountant');
const { quiet, baseCfg, tap, tmpDir, sleep } = require('./helpers');

test('end to end on paper: bars → brain → idea → coordinator/risk → order → trader → exit → accountant', async () => {
  const T0 = Date.UTC(2026, 9, 20, 12, 0); let now = T0;
  const bus = new MemoryBus({ now: () => now }), dataDir = tmpDir('e2e'), cfg = baseCfg();
  cfg.brain.warmup = false; cfg.extraStrategies = ['probe'];
  cfg.strategies = { probe: { mode: 'trade' } };
  cfg.trading = Object.assign(cfg.trading, { account: 'paper', paperEquity: 10000, cycleMs: 5 });
  await bus.kv.set('universe', { coins: [{ coin: 'BTC', instId: 'BTC-USDT', ct: 0.001, min: 1, binance: { symbol: 'BTCUSDT', scale: 1 } }, { coin: 'ETH', instId: 'ETH-USDT', ct: 0.01, min: 1, binance: { symbol: 'ETHUSDT', scale: 1 } }] });
  const ctx = { bus, cfg, dataDir, now: () => now, heartbeats: false, logSink: quiet };
  const agents = [await new Accountant(ctx).start(), await new Trader(ctx).start(), await new Coordinator(ctx).start(), await new Brain(ctx).start()];
  const got = tap(bus, ['idea', 'order', 'exec.fill', 'trade.closed', 'risk.decision']);
  try {
    for (let k = 0; k < 12; k++) {
      const t = T0 + k * 60000; const px = 80000 + 10 * Math.sin(k);
      now = t + 60000 + 200; // the minute [t, t+60s) has closed
      await bus.publish('md.book', { coin: 'BTC', ts: now, bids: [[px - 0.5, 5]], asks: [[px + 0.5, 5]], mid: px, spreadBps: 0.12 });
      for (const [coin, p] of [['BTC', px], ['ETH', 2400]]) await bus.publish('ref.bar', { coin, venue: 'binance', tf: '1m', t, o: p, h: p * 1.0002, l: p * 0.9998, c: p, v: 1, q: 1e6, buyQ: 5e5, n: 100 });
      await bus.drain(); await sleep(15); await bus.drain();
      await bus.publish('md.trade', { coin: 'BTC', trades: [[now, px, 0.01, 1]] });
      for (const a of agents) if (a.tick) await a.tick();
      await bus.drain();
    }
    await agents[0].snapshot(); await bus.drain();
    const n = (type) => got.filter((m) => m.type === type).length;
    assert.ok(n('idea') >= 3, `ideas ${n('idea')}`);
    assert.ok(n('order') >= 2, `orders ${n('order')}`);
    assert.ok(got.some((m) => m.type === 'exec.fill' && m.data.role === 'entry'));
    const closed = got.filter((m) => m.type === 'trade.closed').map((m) => m.data);
    assert.ok(closed.length >= 1 && closed.every((t) => ['time', 'target', 'stop'].includes(t.reason)), JSON.stringify(closed.map((t) => t.reason)));
    const acct = await bus.kv.get('account');
    const net = closed.reduce((a, t) => a + t.netUsd, 0);
    assert.ok(Math.abs(acct.cash - (10000 + net)) < 0.01, 'the accountant booked every closed trade');
    assert.strictEqual(acct.trades, closed.length);
  } finally { for (const a of agents.reverse()) await a.stop(); }
});
