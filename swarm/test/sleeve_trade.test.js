'use strict';
/* Trend sleeve, phase 2 (docs/TREND_SLEEVE_DESIGN.md §5): the coordinator trades the sleeve's weights through its own
 * plan() and risk limits, the traders keep sleeve positions apart, and nothing unsigned or from the wrong source
 * becomes an order. All offline. */
const test = require('node:test');
const assert = require('node:assert');
const { MemoryBus } = require('../src/core/bus');
const { Coordinator } = require('../src/decision/coordinator');
const { Trader } = require('../src/exec/trader');
const { DemoTrader } = require('../src/exec/demo_trader');
const { Accountant } = require('../src/exec/accountant');
const auth = require('../src/core/auth');
const { createFakePlus } = require('./fake_blofin_plus');
const { quiet, baseCfg, tap, tmpDir } = require('./helpers');
const LIMITS = require('../config/risk.json');

const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'LINK', 'AVAX'];
const H = 3600000;

async function coordinator(o = {}) {
  let now = o.t0 || Date.UTC(2026, 9, 23, 5, 2);
  const bus = new MemoryBus({ now: () => now, key: o.key }), cfg = baseCfg();
  cfg.strategies = { s1: { mode: 'trade' } };
  cfg.trading = Object.assign({ account: 'paper', paperEquity: 10000, cycleMs: 20 }, o.trading || {});
  await bus.kv.set('universe', { coins: COINS.map((c) => ({ coin: c, instId: `${c}-USDT`, ct: 0.0001, min: 1 })) });
  const ctx = { bus, cfg, dataDir: o.dataDir || tmpDir('slv'), now: () => now, heartbeats: false, logSink: quiet, busKey: o.key };
  const co = await new Coordinator(ctx).start();
  co.account = { equity: 10000, dayStart: 10000, peak: 10000 };
  co.positions = { ts: now, open: [], working: [] };
  const R = {
    bus, cfg, ctx, co, get now() { return now; }, advance: (ms) => { now += ms; },
    // Ibrahim's /mode, through the Herald
    mode: async (m) => { await bus.publish('sys.command', { cmd: 'strategy-mode', strategy: 'sleeve:trend', mode: m, by: 'ibrahim' }, { src: 'herald' }); await bus.drain(); },
    books: async (px) => { for (const [c, p] of Object.entries(px)) await bus.publish('md.book', { coin: c, ts: now, bids: [[p * 0.9999, 1e9]], asks: [[p * 1.0001, 1e9]], mid: p, spreadBps: 2 }); await bus.drain(); },
    target: async (weights, sigma, src = 'trend-sleeve', ts = Math.floor(now / H) * H) => { await bus.publish('sleeve.target', { sleeve: 'trend', ts, mode: 'shadow', weights, sigma: sigma || {}, capitalShare: 0.5 }, { src }); await bus.drain(); },
  };
  return R;
}

// what the account would hold once every order of the hour filled: the other legs, plus the sleeve's book after its legs
function after(open, working, orders, px) {
  const legs = [...working.filter((w) => !w.reduceOnly)], sl = {};
  for (const p of open) { if (p.owner === 'sleeve:trend') sl[p.coin] = { q: p.side * p.qty, stop: p.stop }; else legs.push(p); }
  for (const o of orders) {
    const h = sl[o.coin] || { q: 0, stop: o.stop };
    h.q += o.side * o.qty; if (!o.reduceOnly) h.stop = o.stop; sl[o.coin] = h;
  }
  for (const [c, h] of Object.entries(sl)) if (Math.abs(h.q) > 1e-12) legs.push({ coin: c, side: Math.sign(h.q), qty: Math.abs(h.q), px: px[c], stop: h.stop, sleeve: true });
  return legs;
}
function breaches(legs, eq, beta) {
  const out = [], tol = 1e-6 * eq;
  const risk = legs.reduce((a, p) => a + p.qty * Math.abs(p.px - p.stop), 0), gross = legs.reduce((a, p) => a + p.qty * p.px, 0);
  const btc = legs.reduce((a, p) => a + p.side * p.qty * p.px * beta(p.coin), 0);
  if (risk > LIMITS.maxOpenRiskPct * eq + tol) out.push(`open risk ${(risk / eq).toFixed(4)}`);
  if (gross > LIMITS.maxGrossX * eq + tol) out.push(`gross ${(gross / eq).toFixed(3)}`);
  if (Math.abs(btc) > LIMITS.maxBtcBetaX * eq + tol) out.push(`net BTC ${(btc / eq).toFixed(3)}`);
  const by = {}; for (const p of legs) by[p.coin] = (by[p.coin] || 0) + p.qty * p.px;
  for (const [c, n] of Object.entries(by)) if (n > LIMITS.maxCoinNotionalX * eq + tol) out.push(`${c} notional ${(n / eq).toFixed(3)}`);
  for (const p of legs) if (p.sleeve && p.qty * Math.abs(p.px - p.stop) > LIMITS.maxTradeRiskPct * eq + tol) out.push(`${p.coin} position risk ${(p.qty * Math.abs(p.px - p.stop) / eq).toFixed(4)}`);
  return out;
}

test('sleeve trade: a sleeve leg never takes the account past any risk.json limit, with ideas and orders in flight', async () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 60; k++) {
    const R = await coordinator();
    try {
      await R.mode('trade');
      const px = Object.fromEntries(COINS.map((c) => [c, +(10 + rnd() * 1000).toFixed(2)]));
      await R.books(px);
      R.co.betas = Object.fromEntries(COINS.map((c) => [c, 0.5 + rnd() * 2]));
      // other strategies: a random book inside the limits, some of it working, some in flight
      const open = [], working = [];
      for (const c of COINS) if (rnd() < 0.4) {
        const side = rnd() < 0.6 ? 1 : -1, n = 1000 + rnd() * 3500, stop = px[c] * (1 - side * (0.003 + rnd() * 0.02));
        (rnd() < 0.7 ? open : working).push({ coin: c, side, qty: n / px[c], px: px[c], stop, last: px[c], strategies: ['s1'], orderId: `o-${c}` });
      }
      // the sleeve already holds some coins (the ones nobody else holds)
      for (const c of COINS) if (rnd() < 0.3 && !open.concat(working).some((p) => p.coin === c)) {
        const side = rnd() < 0.8 ? 1 : -1, n = 200 + rnd() * 800;
        open.push({ coin: c, side, qty: n / px[c], px: px[c], stop: px[c] * (1 - side * 0.25), last: px[c], strategies: ['sleeve:trend'], owner: 'sleeve:trend', orderId: `s-${c}` });
      }
      const eq = 10000, ok = breaches(after(open, working, [], px), eq, (c) => R.co.beta(c)).length === 0;
      if (!ok) continue; // the generated book must start inside the limits
      R.co.positions = { ts: R.now, open, working };
      const fly = rnd() < 0.5 && COINS.find((c) => !open.concat(working).some((p) => p.coin === c));
      if (fly) R.co.inflight.set('ord-x', { orderId: 'ord-x', coin: fly, side: 1, qty: 1500 / px[fly], px: px[fly], stop: px[fly] * 0.99, t: R.now });
      const got = tap(R.bus, ['order', 'stop.move']);
      // the engine asks for anything: big weights, both sides
      const weights = {}, sigma = {};
      for (const c of COINS) { if (rnd() < 0.8) weights[c] = (rnd() < 0.75 ? 1 : -1) * rnd() * 2.5; sigma[c] = 0.01 + rnd() * 0.08; }
      await R.target(weights, sigma);
      const orders = got.filter((m) => m.type === 'order').map((m) => m.data);
      const workAll = working.concat(fly ? [R.co.inflight.get('ord-x')] : []);
      const legs = after(open, workAll, orders, px), bad = breaches(legs, eq, (c) => R.co.beta(c));
      assert.deepStrictEqual(bad, [], `case ${k}: ${bad.join(', ')}`);
      for (const m of got) assert.strictEqual(m.src, 'risk');
      for (const o of orders) {
        assert.strictEqual(o.owner, 'sleeve:trend'); assert.deepStrictEqual(o.strategies.map((s) => s.name), ['sleeve:trend']);
        assert.deepStrictEqual([o.entry.kind, o.entry.waitMin, o.entry.chase, o.entry.fallback], ['maker', 30, true, 'taker'], 'chase 30 min, then market');
        assert.ok(o.side * (px[o.coin] - o.stop) > 0, 'every leg has a stop on the right side');
        if (o.reduceOnly) assert.ok(open.some((p) => p.owner === 'sleeve:trend' && p.coin === o.coin && p.side === -o.side), 'reduce-only only against a sleeve position');
        else assert.ok(R.co.inflight.has(o.id), 'an add is counted in flight');
      }
    } finally { await R.co.stop(); }
  }
});

test('sleeve trade: shadow by default; wrong source, stale or repeated targets, and a non-Ibrahim mode change never trade', async () => {
  const R = await coordinator();
  try {
    const got = tap(R.bus, ['order', 'stop.move']);
    await R.books({ ETH: 2000, SOL: 100 });
    await R.target({ ETH: 0.5, SOL: 0.4 }, { ETH: 0.03, SOL: 0.05 });
    assert.strictEqual(got.length, 0, 'mode shadow (the default): no order');
    assert.strictEqual(R.co.modes['sleeve:trend'], 'shadow');
    // the promotion gate (state-sync) may set idea strategies, never a sleeve
    await R.bus.publish('sys.command', { cmd: 'strategy-mode', strategy: 'sleeve:trend', mode: 'trade', by: 'supervisor' }, { src: 'state-sync' }); await R.bus.drain();
    assert.strictEqual(R.co.modes['sleeve:trend'], 'shadow');
    await R.mode('trade');
    assert.strictEqual(R.co.modes['sleeve:trend'], 'trade');
    await R.target({ ETH: 0.5, SOL: 0.4 }, { ETH: 0.03, SOL: 0.05 }, 'brain'); // someone else in the untrusted zone
    await R.target({ ETH: 0.5, SOL: 0.4 }, { ETH: 0.03, SOL: 0.05 }, 'strategy:x');
    await R.target({ ETH: 0.5 }, {}, 'trend-sleeve', R.now - 2 * H); // two hours old
    assert.strictEqual(got.length, 0, 'only the sleeve itself, and only a current hour');
    await R.target({ ETH: 0.5, SOL: 0.4 }, { ETH: 0.03, SOL: 0.05 });
    const n = got.length;
    assert.ok(n >= 1, 'the current hour from the sleeve trades');
    await R.target({ ETH: 0.5, SOL: 0.4 }, { ETH: 0.03, SOL: 0.05 }); // the same hour again
    assert.strictEqual(got.length, n, 'each hour is planned once');
    assert.ok(R.co.metrics.sleeveRefused >= 2 && R.co.metrics.sleeveStale >= 2);
  } finally { await R.co.stop(); }
});

test('sleeve trade: with the bus key, an unsigned order or stop.move — from the sleeve or claiming to be the risk agent — never reaches a position', async () => {
  const key = Buffer.from('k'.repeat(40)), bus = new MemoryBus({ key }), cfg = baseCfg();
  const t = await new Trader({ bus, cfg, dataDir: tmpDir('slvsig'), busKey: key, heartbeats: false, logSink: quiet }).start();
  try {
    await bus.publish('md.book', { coin: 'ETH', ts: Date.now(), bids: [[1999, 100]], asks: [[2001, 100]], mid: 2000, spreadBps: 10 });
    const order = (id) => ({ id, owner: 'sleeve:trend', coin: 'ETH', side: 1, qty: 1, entry: { kind: 'taker', px: 2000 }, stop: 1500, timeStopMin: 0, strategies: [{ name: 'sleeve:trend', ideaId: id }] });
    await bus.publish('order', order('from-sleeve'), { src: 'trend-sleeve', key: null });
    await bus.publish('order', order('forged'), { src: 'risk', key: null });
    await bus.drain();
    assert.deepStrictEqual(Object.keys(t.S.positions), [], 'unsigned orders are dropped');
    await bus.publish('order', order('real'), { src: 'risk' }); await bus.drain();
    assert.ok(t.S.positions['sleeve:trend:ETH'], 'a signed order from the risk agent trades');
    await bus.publish('stop.move', { coin: 'ETH', owner: 'sleeve:trend', stop: 1990 }, { src: 'risk', key: null }); await bus.drain();
    await bus.publish('stop.move', { coin: 'ETH', owner: 'sleeve:trend', stop: 1990 }, { src: 'trend-sleeve' }); await bus.drain(); // signed, wrong source
    assert.strictEqual(t.S.positions['sleeve:trend:ETH'].stop, 1500);
    assert.ok(t.metrics.unsignedDropped >= 3);
  } finally { await t.stop(); }
});

async function paperRig() {
  const R = await coordinator();
  const tr = await new Trader(R.ctx).start(), acc = await new Accountant(R.ctx).start();
  R.tr = tr; R.acc = acc;
  // the coordinator hears the trader's reports
  R.sync = async () => { await tr.publishPositions(); await R.bus.drain(); };
  const stop = R.co.stop.bind(R.co);
  R.stopAll = async () => { await stop(); await tr.stop(); await acc.stop(); };
  return R;
}

test('sleeve trade (paper): open, grow at an average entry, reduce-only partial booked as sleeve:trend, stop.move only toward the price, ideas apart', async () => {
  const R = await paperRig();
  try {
    const got = tap(R.bus, ['order', 'trade.closed', 'exec.fill', 'stop.move', 'order.end']);
    await R.mode('trade');
    await R.books({ ETH: 2000 });
    await R.target({ ETH: 0.4 }, { ETH: 0.03 });
    const o1 = got.find((m) => m.type === 'order').data;
    assert.strictEqual(o1.reduceOnly, false);
    // nothing fills at the bid within 30 min: then market (the fallback)
    R.advance(31 * 60000); await R.books({ ETH: 2000 }); await R.tr.tick(); await R.bus.drain();
    let p = R.tr.S.positions['sleeve:trend:ETH'];
    assert.ok(p, 'filled at market after the chase'); assert.strictEqual(p.owner, 'sleeve:trend');
    assert.ok(Math.abs(p.qty - o1.qty) < 1e-12); assert.strictEqual(p.timeStopMin, 0);
    await R.sync();
    // an idea trade on the same coin is kept apart on paper (the trader keys by owner) — fusion sees ETH as busy, though
    assert.ok(R.co.positions.open.some((x) => x.owner === 'sleeve:trend' && x.coin === 'ETH'));
    // next hour: the engine wants more; the price moved up
    R.advance(H - 31 * 60000); await R.books({ ETH: 2100 });
    await R.target({ ETH: 0.8 }, { ETH: 0.03 });
    const o2 = got.filter((m) => m.type === 'order').pop().data;
    assert.ok(o2.id !== o1.id && o2.side === 1 && !o2.reduceOnly, 'an add');
    await R.bus.publish('md.trade', { coin: 'ETH', trades: [[R.now, 2099.5, 1, -1]] }); await R.bus.drain(); // a sell through the bid fills the maker add
    p = R.tr.S.positions['sleeve:trend:ETH'];
    const q = o1.qty + o2.qty;
    assert.ok(Math.abs(p.qty - q) < 1e-9, 'grown');
    assert.ok(p.entry > 2000 && p.entry < 2100, `average entry ${p.entry}`);
    assert.strictEqual(p.stop, o2.stop, 'the whole position takes the new stop');
    await R.sync();
    // hour 3: the engine wants less → a reduce-only leg; its share is booked as a trade of sleeve:trend
    R.advance(H); await R.books({ ETH: 2050 });
    await R.target({ ETH: 0.2 }, { ETH: 0.03 });
    const o3 = got.filter((m) => m.type === 'order').pop().data;
    assert.ok(o3.reduceOnly && o3.side === -1, 'a reduce-only sell');
    await R.bus.publish('md.trade', { coin: 'ETH', trades: [[R.now, 2051, 1, 1]] }); await R.bus.drain();
    const tc = got.filter((m) => m.type === 'trade.closed').pop().data;
    assert.deepStrictEqual([tc.reason, tc.partial, tc.strategies.map((s) => s.name)], ['rebalance', true, ['sleeve:trend']]);
    assert.ok(Math.abs(tc.qty - o3.qty) < 1e-9 && Math.abs(R.tr.S.positions['sleeve:trend:ETH'].qty - (q - o3.qty)) < 1e-9);
    assert.strictEqual(R.co.alloc.stats('sleeve:trend').n, 0, 'the allocator ignores sleeves');
    await R.acc.snapshot();
    assert.strictEqual((await R.bus.kv.get('account')).byStrategy['sleeve:trend'].trades, 1, 'the accountant books the money');
    // stop.move: tighter is taken, looser or past the price is refused
    p = R.tr.S.positions['sleeve:trend:ETH']; const s0 = p.stop;
    await R.bus.publish('stop.move', { coin: 'ETH', owner: 'sleeve:trend', stop: s0 - 10 }, { src: 'risk' }); await R.bus.drain();
    assert.strictEqual(p.stop, s0, 'never loosened');
    await R.bus.publish('stop.move', { coin: 'ETH', owner: 'sleeve:trend', stop: 2060 }, { src: 'risk' }); await R.bus.drain();
    assert.strictEqual(p.stop, s0, 'never past the price');
    await R.bus.publish('stop.move', { coin: 'ETH', owner: 'sleeve:trend', stop: s0 + 50 }, { src: 'risk' }); await R.bus.drain();
    assert.strictEqual(p.stop, s0 + 50);
    // no break-even, trail or time stop on a sleeve position: a long run does nothing, only the stop exits
    R.advance(48 * H); await R.bus.publish('md.trade', { coin: 'ETH', trades: [[R.now, 2400, 1, 1]] }); await R.bus.drain(); await R.tr.tick();
    assert.strictEqual(R.tr.S.positions['sleeve:trend:ETH'].stop, s0 + 50);
    // an idea order on ETH is not blocked by the sleeve's position at the trader (paper keys by owner)
    await R.books({ ETH: 2400 });
    await R.bus.publish('order', { id: 'idea-1', coin: 'ETH', side: -1, qty: 0.1, entry: { kind: 'taker', px: 2400 }, stop: 2420, target: null, trail: null, timeStopMin: 30, strategies: [{ name: 's1', ideaId: 'i1' }] }, { src: 'risk' }); await R.bus.drain();
    assert.ok(R.tr.S.positions.ETH && R.tr.S.positions['sleeve:trend:ETH'], 'both held on paper');
    // the stop: the sleeve's coin cools down until 00:00 UTC
    await R.bus.publish('md.trade', { coin: 'ETH', trades: [[R.now, s0 + 40, 1, -1]] }); await R.bus.drain();
    assert.ok(!R.tr.S.positions['sleeve:trend:ETH']);
    assert.strictEqual(got.filter((m) => m.type === 'trade.closed').pop().data.reason, 'stop');
    assert.ok(R.co.sleeveCool.ETH > R.now);
  } finally { await R.stopAll(); }
});

test('sleeve trade (paper): no-new allows only reductions; flatten and halt close sleeve positions and the sleeve sends nothing', async () => {
  const R = await paperRig();
  try {
    const got = tap(R.bus, ['order', 'trade.closed', 'sys.command']);
    await R.mode('trade');
    await R.books({ ETH: 2000, SOL: 100 });
    await R.target({ ETH: 0.4, SOL: 0.3 }, { ETH: 0.03, SOL: 0.05 });
    for (const m of got.filter((x) => x.type === 'order')) await R.bus.publish('md.trade', { coin: m.data.coin, trades: [[R.now, m.data.coin === 'ETH' ? 1999 : 99.9, 1, -1]] });
    await R.bus.drain(); await R.sync();
    assert.deepStrictEqual(Object.keys(R.tr.S.positions).sort(), ['sleeve:trend:ETH', 'sleeve:trend:SOL']);
    // a day loss of 3%: no new risk — the add is refused, the reduction goes through
    R.advance(H); await R.books({ ETH: 2000, SOL: 100 });
    R.co.account = { equity: 9690, dayStart: 10000, peak: 10000 };
    const before = got.filter((m) => m.type === 'order').length;
    await R.target({ ETH: 0.9, SOL: 0.05 }, { ETH: 0.03, SOL: 0.05 });
    const legs = got.filter((m) => m.type === 'order').slice(before).map((m) => m.data);
    assert.deepStrictEqual(legs.map((o) => [o.coin, o.reduceOnly]), [['SOL', true]]);
    // halt (drawdown 20%): the coordinator orders a flatten, the trader closes the sleeve, the sleeve plans nothing
    R.co.account = { equity: 7900, dayStart: 7950, peak: 10000 };
    await R.co.watch(); await R.bus.drain();
    assert.ok(got.some((m) => m.type === 'sys.command' && m.data.cmd === 'flatten'));
    assert.deepStrictEqual(Object.keys(R.tr.S.positions), [], 'flatten closed every sleeve position');
    assert.ok(got.filter((m) => m.type === 'trade.closed').every((m) => m.data.strategies[0].name === 'sleeve:trend'));
    R.advance(H); await R.books({ ETH: 2000, SOL: 100 }); await R.sync();
    const n = got.filter((m) => m.type === 'order').length;
    await R.target({ ETH: 0.5, SOL: 0.5 }, { ETH: 0.03, SOL: 0.05 });
    assert.strictEqual(got.filter((m) => m.type === 'order').length, n, 'halted: nothing until Ibrahim resumes');
  } finally { await R.stopAll(); }
});

test('sleeve trade (demo): one owner per coin — the sleeve skips coins idea trades hold, and the demo trader refuses a second owner', async () => {
  const R = await coordinator({ trading: { account: 'demo' } });
  try {
    const got = tap(R.bus, ['order']);
    await R.mode('trade');
    await R.books({ ETH: 2000, SOL: 100 });
    R.co.positions = { ts: R.now, open: [{ coin: 'ETH', side: 1, qty: 0.5, px: 2000, stop: 1980, last: 2000, strategies: ['s1'], orderId: 'idea' }], working: [] };
    await R.target({ ETH: 0.4, SOL: 0.3 }, { ETH: 0.03, SOL: 0.05 });
    assert.deepStrictEqual(got.map((m) => m.data.coin), ['SOL'], 'ETH belongs to an idea trade');
  } finally { await R.co.stop(); }
});

test('demo trader: a sleeve position grows and shrinks on BloFin with its stop resized; another owner gets coin busy; flatten closes it', async () => {
  const fake = createFakePlus({ key: 'k', secret: 's', pass: 'p', equity: 10000, postOnlyCross: 'reject' });
  fake.addInstrument('ETH-USDT', { contractValue: 0.01, lotSize: 1, minSize: 1, tickSize: 0.01 }, 2000);
  const bus = new MemoryBus(), cfg = baseCfg(); cfg.trading = { account: 'demo' };
  let vms = 0;
  const t = await new DemoTrader({ bus, cfg, dataDir: tmpDir('slvdemo'), fetchImpl: fake.fetchImpl, apiKey: 'k', apiSecret: 's', passphrase: 'p', sleep: async (ms) => { vms += ms; }, nowMs: () => Date.now() + vms, tickMs: 3600000, heartbeats: false, logSink: quiet }).start();
  const got = tap(bus, ['trade.closed', 'order.end', 'exec.fill']);
  const order = (id, extra) => bus.publish('order', Object.assign({ id, owner: 'sleeve:trend', coin: 'ETH', instId: 'ETH-USDT', side: 1, qty: 1, entry: { kind: 'taker', px: 2000 }, stop: 1500, target: null, trail: null, timeStopMin: 0, strategies: [{ name: 'sleeve:trend', ideaId: id }] }, extra), { src: 'risk' });
  const book = () => bus.publish('md.book', { coin: 'ETH', ts: Date.now(), bids: [[1999.99, 1000]], asks: [[2000.01, 1000]], mid: 2000, spreadBps: 0.1 });
  const settle = async (k = 3) => { for (let i = 0; i < k; i++) { await t.loop(); await bus.drain(); } };
  try {
    await t.loop(); await book();
    await order('s1'); await bus.drain(); await settle();
    let p = t.S.positions.ETH;
    assert.ok(p && p.owner === 'sleeve:trend' && p.contracts === 100, 'opened 1 ETH = 100 contracts');
    const sl = () => Object.values(fake.tpsl).filter((x) => x.state === 'live');
    assert.deepStrictEqual(sl().map((x) => x.size), ['100']);
    // grow by 0.5 ETH: average entry, one stop for 150 contracts
    await order('s2', { qty: 0.5, stop: 1600 }); await bus.drain(); await settle();
    p = t.S.positions.ETH;
    assert.strictEqual(p.contracts, 150); assert.strictEqual(p.stop, 1600);
    assert.deepStrictEqual(sl().map((x) => x.size), ['150'], 'the old stop is replaced, not doubled');
    // an idea trade cannot share the coin (BloFin nets it)
    await bus.publish('order', { id: 'idea', coin: 'ETH', instId: 'ETH-USDT', side: -1, qty: 0.2, entry: { kind: 'taker', px: 2000 }, stop: 2050, target: null, trail: null, timeStopMin: 30, strategies: [{ name: 's1', ideaId: 'i' }] }, { src: 'risk' }); await bus.drain();
    assert.strictEqual(got.find((m) => m.type === 'order.end' && m.data.id === 'idea').data.outcome, 'coin busy');
    // reduce 0.7 ETH, reduce-only on BloFin: booked as a partial sleeve trade, stop resized to 80
    await order('s3', { side: -1, qty: 0.7, reduceOnly: true }); await bus.drain(); await settle();
    const placed = Object.values(fake.orders).filter((o) => o.reduceOnly && o.orderType === 'market');
    assert.ok(placed.length >= 1, 'sent reduce-only');
    p = t.S.positions.ETH;
    assert.strictEqual(p.contracts, 80);
    const tc = got.filter((m) => m.type === 'trade.closed').map((m) => m.data);
    assert.strictEqual(tc.length, 1, 'the reduction is not mistaken for a stop');
    assert.deepStrictEqual([tc[0].reason, tc[0].partial, tc[0].strategies[0].name], ['rebalance', true, 'sleeve:trend']);
    assert.ok(Math.abs(tc[0].qty - 0.7) < 1e-9);
    assert.deepStrictEqual(sl().map((x) => x.size), ['80']);
    // stop.move toward the price replaces the exchange stop; away from it is refused
    await bus.publish('stop.move', { coin: 'ETH', owner: 'sleeve:trend', stop: 1550 }, { src: 'risk' }); await bus.drain();
    assert.strictEqual(t.S.positions.ETH.stop, 1600);
    await bus.publish('stop.move', { coin: 'ETH', owner: 'sleeve:trend', stop: 1700 }, { src: 'risk' }); await bus.drain();
    assert.strictEqual(t.S.positions.ETH.stop, 1700); assert.deepStrictEqual(sl().map((x) => x.slTriggerPrice), ['1700.00']);
    // flatten closes it
    await bus.publish('sys.command', { cmd: 'flatten', by: 'risk', why: 'test' }, { src: 'risk' }); await bus.drain();
    await settle(4);
    assert.deepStrictEqual(Object.keys(t.S.positions), []);
    assert.strictEqual(fake.pos['ETH-USDT'], undefined);
    const last = got.filter((m) => m.type === 'trade.closed').pop().data;
    assert.strictEqual(last.reason, 'flatten'); assert.ok(Math.abs(last.qty - 0.8) < 1e-9);
  } finally { await t.stop(); }
});

test('sleeve trade: the Herald knows sleeve:trend for /mode, and signs-off stop.move as an authority type', () => {
  assert.ok(auth.SIGNED.has('stop.move'));
  const { Herald } = require('../src/ops/herald');
  const h = Object.create(Herald.prototype); h.cfg = baseCfg(); h.hb = {};
  assert.ok(h.knownStrategies().has('sleeve:trend'));
});
