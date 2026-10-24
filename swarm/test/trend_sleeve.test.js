'use strict';
// Trend sleeve (docs/TREND_SLEEVE_DESIGN.md): the ported engine, the swarm's limits on its weights, the shadow agent.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/sleeve/trend_engine');
const S = require('../src/sleeve/sleeve');
const { TrendSleeve } = require('../src/sleeve/agent');
const { MemoryBus } = require('../src/core/bus');
const { SIGNED } = require('../src/core/auth');
const { RULES: ISO } = require('../src/core/isolate');
const { REGISTRY } = require('../src/run');
const { quiet, baseCfg, tap, fakeHttp } = require('./helpers');

const LIMITS = require('../config/risk.json');
const H = 3600, D = 86400, T0 = Date.UTC(2023, 0, 2) / 1000; // a Monday

// deterministic trending random walks: drift switches sign every ~40 days, 1% hourly noise
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function synth(names, hours, seed = 1, start = T0) {
  const r = rng(seed);
  return names.map((coin, k) => {
    const c = { coin, t: [], o: [], h: [], l: [], c: [], funding: [] };
    let px = 100 * (k + 1), drift = 0;
    for (let i = 0; i < hours; i++) {
      if (i % (24 * 40) === 0) drift = (r() - 0.5) * 0.002;
      const o = px; px *= Math.exp(drift + (r() - 0.5) * 0.02);
      c.t.push(start + i * H); c.o.push(o); c.c.push(px); c.h.push(Math.max(o, px) * (1 + r() * 0.004)); c.l.push(Math.min(o, px) * (1 - r() * 0.004));
      if (i % 8 === 0) c.funding.push([start + i * H, (r() - 0.4) * 0.0004]);
    }
    return c;
  });
}

test('trend engine: Donchian states on closes, timeframes from 1h bars', () => {
  // up through the 3-bar channel → long; held until the close falls below the trailing midpoint; shorts only if allowed
  const c = [10, 11, 10.5, 12, 12.5, 13, 12.9, 11.5, 11, 9, 8.5, 8];
  assert.deepStrictEqual(Array.from(E.donchian(c, 3, false)), [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(Array.from(E.donchian(c, 3, true)).slice(9), [-1, -1, -1]);
  // weeks start Monday 00:00 UTC, months on the calendar; only complete bars
  const g = E.align(synth(['BTC'], 24 * 70));
  const w = E.resample(g, g.coins[0], '1w'), m = E.resample(g, g.coins[0], '1M');
  assert.strictEqual(w.c.length, 10);
  for (const end of w.end) assert.strictEqual(new Date((g.t[end] + H) * 1000).getUTCDay(), 1);
  assert.strictEqual(m.c.length, 2); // January and February 2023 are complete, March is not
  assert.strictEqual(new Date((g.t[m.end[0]] + H) * 1000).toISOString(), '2023-02-01T00:00:00.000Z');
});

test('trend engine: the weights obey the research limits; the executor without limits books exactly as the engine', () => {
  const coins = synth(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'LINK'], 24 * 500, 7);
  for (let i = 3000; i < 3030; i++) for (const k of ['o', 'h', 'l', 'c']) coins[2][k][i] = NaN; // a 30-hour data gap
  const grid = E.align(coins);
  const sim = E.simulate(grid, { keepWant: true });
  let maxGross = 0;
  for (let i = 0; i < grid.n; i++) { let g = 0; for (const w of sim.want) g += Math.abs(w[i]); maxGross = Math.max(maxGross, g); }
  assert.ok(maxGross <= 3 + 1e-6, `gross ${maxGross} ≤ 3`);
  assert.ok(sim.trades > 100 && Number.isFinite(sim.sharpe));
  const free = S.run(grid, sim, { unconstrained: true, capitalShare: 1 });
  // the same arithmetic in another order: equal up to floating point
  assert.ok(Math.abs(free.final / sim.final - 1) < 1e-7, `final ${free.final} = ${sim.final}`);
  assert.ok(Math.abs(free.sharpe - sim.sharpe) < 1e-7);
  assert.strictEqual(free.daily.length, sim.daily.length);
});

// legs of a book at current prices, as the risk engine counts them
function exposure(book, mkt) {
  let risk = 0, gross = 0, worst = 0; const coin = {};
  for (const [c, p] of Object.entries(book)) {
    const r = Math.abs(p.qty) * Math.abs(mkt[c].px - p.stop), n = Math.abs(p.qty) * mkt[c].px;
    risk += r; gross += n; worst = Math.max(worst, r); coin[c] = n;
    assert.ok(Math.sign(p.qty) * (mkt[c].px - p.stop) > 0, `${c}: stop on the losing side of the price`);
  }
  return { risk, gross, worst, coin };
}

test('sleeve plan: whatever the engine asks, the book stays inside every hard limit of risk.json', () => {
  const r = rng(3), names = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'LINK', 'SUI', 'PEPE', 'HYPE', 'ZEC'];
  for (let k = 0; k < 300; k++) {
    const eq = 10000, mkt = {}, w = {}, book = {};
    for (const c of names) {
      mkt[c] = { px: 1 + r() * 1000, sigma: 0.01 + r() * 0.08, beta: 0.5 + r() * 2 };
      w[c] = (r() - 0.5) * 2.4; // up to ±1.2 of the sleeve's capital per coin: far beyond what the engine makes
      if (r() < 0.4) { const s = r() < 0.5 ? 1 : -1, q = (s * eq * r() * 0.3) / mkt[c].px; book[c] = { qty: q, stop: mkt[c].px * (1 - s * (0.02 + r() * 0.5)) }; }
    }
    const others = r() < 0.5 ? [{ coin: 'BTC', side: 1, qty: (eq * 0.5) / mkt.BTC.px, px: mkt.BTC.px, stop: mkt.BTC.px * 0.97 }] : [];
    const rules = { capitalShare: 0.3 + r() * 0.7, stopK: 2 + r() * 8, riskShare: 0.3 + r() * 0.7 };
    const p = S.plan(w, book, mkt, { equity: eq, peak: eq, dayStart: eq }, LIMITS, others, rules);
    const x = exposure(p.book, mkt), budget = rules.riskShare * LIMITS.maxOpenRiskPct * eq;
    assert.ok(x.worst <= LIMITS.maxTradeRiskPct * eq * (1 + 1e-6), `risk per position ${x.worst}`);
    assert.ok(x.risk <= budget * (1 + 1e-6), `sleeve risk ${x.risk} ≤ budget ${budget}`);
    for (const l of p.legs) if (l.kind === 'open' || l.kind === 'add') if (l.qty) {
      const n = x.coin[l.coin] + others.filter((o) => o.coin === l.coin).reduce((a, o) => a + o.qty * o.px, 0);
      assert.ok(n <= LIMITS.maxCoinNotionalX * eq * (1 + 1e-6), `coin notional ${n}`);
      assert.ok(l.stop > 0 && ['approve', 'trim'].includes(l.verdict));
    }
    const grossAll = x.gross + others.reduce((a, o) => a + o.qty * o.px, 0), grew = p.legs.some((l) => (l.kind === 'open' || l.kind === 'add') && l.qty);
    if (grew) assert.ok(grossAll <= Math.max(LIMITS.maxGrossX * eq, exposure(book, mkt).gross + others.reduce((a, o) => a + o.qty * o.px, 0)) * (1 + 1e-6), `gross ${grossAll}`);
  }
});

test('sleeve plan: the risk ladders — no-new and proven-only allow reductions only, flatten and halt close everything, a drawdown halves the size', () => {
  const mkt = { BTC: { px: 100, sigma: 0.03 }, ETH: { px: 10, sigma: 0.04 } }, eq = 10000;
  const book = { BTC: { qty: 10, stop: 80 } }; // $1000 long
  const w = { BTC: 0.05, ETH: 0.05 }; // BTC to $250 (a reduction), ETH new ($250)
  const at = (a, s) => S.plan(w, book, mkt, a, LIMITS, [], { capitalShare: 0.5, stopK: 4, riskShare: 1 }, s);
  const normal = at({ equity: eq, peak: eq, dayStart: eq });
  assert.deepStrictEqual(normal.legs.filter((l) => l.qty).map((l) => [l.coin, l.kind]), [['BTC', 'reduce'], ['ETH', 'open']]);
  const noNew = at({ equity: eq, peak: eq, dayStart: eq / 0.965 }); // day −3.5%
  assert.strictEqual(noNew.mode, 'no-new');
  assert.deepStrictEqual(noNew.legs.filter((l) => l.qty).map((l) => l.coin), ['BTC']);
  assert.match(noNew.legs.find((l) => l.coin === 'ETH').reasons[0], /risk mode no-new/);
  const proven = at({ equity: eq, peak: eq / 0.84, dayStart: eq }); // drawdown 16%
  assert.ok(proven.provenOnly && proven.legs.every((l) => !(l.kind === 'open' && l.qty)));
  for (const a of [{ equity: eq, peak: eq, dayStart: eq / 0.94 }, { equity: eq, peak: eq / 0.79, dayStart: eq }]) {
    const p = at(a);
    assert.ok(['flatten', 'halt'].includes(p.mode));
    assert.deepStrictEqual(p.book, {}); assert.deepStrictEqual(p.legs.map((l) => [l.coin, l.kind]), [['BTC', 'close']]);
  }
  assert.deepStrictEqual(at({ equity: eq, peak: eq, dayStart: eq }, { halted: true }).book, {});
  const half = at({ equity: eq, peak: eq / 0.88, dayStart: eq }); // drawdown 12%: budgets halved
  const n = (p) => Math.abs(p.book.ETH.qty * 10);
  assert.ok(Math.abs(n(half) / n(normal) - 0.5) < 1e-9, `ETH ${n(half)} = half of ${n(normal)}`);
  // after a stop, no new position in that coin before 00:00 UTC
  const cool = S.plan({ ETH: 0.5 }, {}, { ETH: Object.assign({ cool: true }, mkt.ETH) }, { equity: eq, peak: eq, dayStart: eq }, LIMITS, [], {});
  assert.deepStrictEqual(cool.book, {}); assert.match(cool.legs[0].reasons[0], /stopped out today/);
});

test('sleeve stops: tightened (never loosened) to the budget at current prices; hit on the hour\'s low, gaps fill at the open', () => {
  const mkt = { BTC: { px: 200, sigma: 0.02 }, ETH: { px: 50, sigma: 0.03 } };
  const book = { BTC: { qty: 20, stop: 90 }, ETH: { qty: -100, stop: 80 } }; // risks $2200 and $3000 at today's prices
  const moves = S.fitStops(book, mkt, 10000, 300, 0.01);
  const x = exposure(book, mkt);
  assert.ok(x.worst <= 100 + 1e-6 && x.risk <= 300 + 1e-6, `${x.worst} ${x.risk}`);
  assert.strictEqual(moves.length, 2);
  assert.ok(book.BTC.stop > 90 && book.ETH.stop < 80);
  assert.deepStrictEqual(S.fitStops(book, mkt, 10000, 1e9, 1), [], 'never loosened');
  // step: a long whose stop is inside the hour's range exits at the stop; one gapped through exits at the open
  const st = S.newState({ equity0: 10000 }, T0);
  st.book = { BTC: { qty: 10, stop: 95 }, ETH: { qty: 100, stop: 9.5 } }; st.lastPx = { BTC: 100, ETH: 10 };
  const hour = { t: T0 + H, coins: { BTC: { o: 99, h: 100, l: 94, c: 96, pc: 100, fund: 0, w: 0.1, sigma: 0.03 }, ETH: { o: 9, h: 9.2, l: 8.8, c: 9.1, pc: 10, fund: 0, w: 0.1, sigma: 0.03 } } };
  S.step(st, hour, { limits: LIMITS, rules: { equity0: 10000 } });
  assert.strictEqual(st.ev.stops, 2);
  const cost = (10 * 95 + 100 * 9) * 7.5e-4;
  assert.ok(Math.abs(st.eq - (10000 + 10 * (95 - 100) + 100 * (9 - 10) - cost)) < 1e-9, `${st.eq}`);
  assert.deepStrictEqual(st.book, {}, 'stopped coins wait for the next day');
  assert.strictEqual(st.cool.BTC, (Math.floor((T0 + H) / D) + 1) * D);
});

test('sleeve backtest under risk.json: trades, never past a limit, ladders on its own account', () => {
  const grid = E.align(synth(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'], 24 * 450, 11));
  const sim = E.simulate(grid, { keepWant: true });
  const from = grid.t[0] + 400 * D, r = S.run(grid, sim, { limits: LIMITS, from });
  assert.ok(r.events.legs > 10, `${r.events.legs} rebalances`);
  assert.ok(r.events.maxRiskPct <= LIMITS.maxOpenRiskPct + 1e-9, `stop risk ${r.events.maxRiskPct}`);
  assert.ok(r.events.maxGross <= LIMITS.maxGrossX);
  // the state continues: a second run over the same grid adds nothing, a longer grid continues from it
  const st = JSON.parse(JSON.stringify(S.run(grid, sim, { limits: LIMITS, from, state: undefined }).state));
  const again = S.run(grid, sim, { limits: LIMITS, from, state: st });
  assert.strictEqual(again.final, r.final);
});

// BloFin's candle endpoint over synthetic coins: newest first, `after` = older than, confirmed flag in column 8
function blofin(coins, nowRef) {
  const by = new Map(coins.map((c) => [c.coin + '-USDT', c]));
  return fakeHttp([[/\/api\/v1\/market\/candles/, (url) => {
    const u = new URL(url), c = by.get(u.searchParams.get('instId')), lim = +u.searchParams.get('limit'), after = +u.searchParams.get('after') || Infinity;
    const rows = [];
    for (let i = c.t.length - 1; i >= 0 && rows.length < lim; i--) {
      const ms = c.t[i] * 1000;
      if (ms >= after || ms + H * 1000 > nowRef.now) continue;
      rows.push([String(ms), String(c.o[i]), String(c.h[i]), String(c.l[i]), String(c.c[i]), '1', '1', '1', '1']);
    }
    return { code: '0', data: rows };
  }]]);
}

test('trend sleeve agent: shadow only — weights and a shadow book every hour, kept across a restart, never an order', async () => {
  const names = ['BTC', 'ETH', 'SOL'], hours = 24 * 160, coins = synth(names, hours, 5);
  const clock = { now: (T0 + 150 * D) * 1000 + 5 * 60000 }; // 5 minutes past an hour
  const http = blofin(coins, clock), bus = new MemoryBus({ now: () => clock.now });
  await bus.kv.set('universe', { coins: names.map((c) => ({ coin: c, instId: c + '-USDT', vol7d: 1 })) });
  await bus.kv.set('account', { equity: 10000, peak: 10000, dayStart: 10000 });
  await bus.kv.set('positions', { open: [{ coin: 'BTC', side: 1, qty: 10, px: 100, stop: 97 }], working: [] });
  const got = tap(bus, ['sleeve.*', 'order', 'intent', 'risk.decision', 'sys.command']);
  const cfg = baseCfg();
  cfg.sleeves.trend = Object.assign({}, cfg.sleeves.trend, { mode: 'trade', historyDays: 150, warmDays: 60, shadowSince: new Date((T0 + 140 * D) * 1000).toISOString().slice(0, 10), tickMs: 3600e3 });
  const mk = () => new TrendSleeve({ bus, cfg, http, now: () => clock.now, heartbeats: false, logSink: quiet, paceMs: 0, riskLimits: LIMITS }, { name: 'trend-sleeve' });
  const a = mk(); await a.start();
  assert.strictEqual(a.mode, 'shadow', 'trade mode is not built: shadow');
  await a.tick(); await bus.drain();
  const tg = got.filter((m) => m.type === 'sleeve.target'), sv = got.filter((m) => m.type === 'sleeve.state');
  assert.strictEqual(tg.length, 1); assert.strictEqual(sv.length, 1);
  assert.strictEqual(tg[0].data.mode, 'shadow'); assert.strictEqual(tg[0].data.ts, Math.floor(clock.now / 3600e3) * 3600e3);
  assert.deepStrictEqual(Object.keys(sv[0].data.votes).sort(), names.slice().sort());
  assert.ok(sv[0].data.liveCheck && sv[0].data.liveCheck.others === 1, 'dry run against the live positions');
  assert.ok(Object.keys(tg[0].data.weights).length > 0, 'the trends show up as weights');
  const st1 = await bus.kv.get('sleeve:trend');
  assert.strictEqual(st1.t, Math.floor(clock.now / 3600e3) * 3600 - 3600);
  assert.strictEqual(st1.ev.hours, 10 * 24, 'the book started at shadowSince and caught up hour by hour');
  // same hour again: nothing new; next hour: one more step
  await a.tick(); await bus.drain();
  assert.strictEqual(got.filter((m) => m.type === 'sleeve.state').length, 1);
  await a.stop();
  clock.now += 3600e3;
  const b = mk(); await b.start(); await b.tick(); await bus.drain();
  const st2 = await bus.kv.get('sleeve:trend');
  assert.strictEqual(st2.ev.hours, st1.ev.hours + 1, 'the restarted agent continues the saved book');
  assert.ok(!got.some((m) => ['order', 'intent', 'risk.decision', 'sys.command'].includes(m.type)), 'it never sends an order or a command');
  await b.stop();
});

test('trend sleeve: registered, isolated like the brain, and it may say nothing that carries authority', () => {
  assert.ok(REGISTRY['trend-sleeve']);
  const r = ISO['trend-sleeve'];
  assert.deepStrictEqual(r.kvSet, ['sleeve:trend']);
  for (const t of r.types) assert.ok(!SIGNED.has(t), `${t} is not a signed type`);
  assert.ok(baseCfg().groups.brain.includes('trend-sleeve'), 'runs in the brain group (Linux: the brain user, no bus key)');
  assert.strictEqual(baseCfg().sleeves.trend.mode, 'shadow');
});
