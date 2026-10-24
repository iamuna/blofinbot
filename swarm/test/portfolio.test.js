'use strict';
// Upswarm Phase 2 (upswarm/GUIDE.md §6–7): the portfolio constructor, the conductor, risk v2's weekly cap, the shadow agent.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/sleeve/trend_engine');
const S = require('../src/sleeve/sleeve');
const PC = require('../src/portfolio/constructor');
const CD = require('../src/portfolio/conductor');
const { PortfolioAgent } = require('../src/portfolio/agent');
const { RiskEngine } = require('../src/decision/risk');
const { Accountant } = require('../src/exec/accountant');
const { MemoryBus } = require('../src/core/bus');
const { REGISTRY } = require('../src/run');
const { quiet, baseCfg, tap, tmpDir } = require('./helpers');

const LIMITS = require('../config/risk.json');
const H = 3600, D = 86400, T0 = Date.UTC(2023, 0, 2) / 1000; // a Monday
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

test('constructor + trend sleeve alone reproduce the sleeve backtest, leg for leg', () => {
  const grid = E.align(synth(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'LINK'], 24 * 500, 11));
  const sim = E.simulate(grid, { keepWant: true });
  const rules = Object.assign({}, baseCfg().sleeves.trend.rules), from = grid.t[24 * 200];
  const direct = S.run(grid, sim, Object.assign({}, rules, { limits: LIMITS, from }));
  // the same hours through the constructor: the sleeve's USD targets → combine (share 1, dial 1, the new caps open)
  // → weights of the whole account → the planner with capital share 1
  const R = Object.assign({}, S.RULES, rules), pr = PC.planRules(rules), open = { portVolTargetPct: Infinity, maxClusterGrossFrac: 1 };
  const ref = grid.coins.find((g) => g.coin === 'BTC'), beta = S.betas(grid, ref, R.betaDays), st = S.newState(pr);
  for (const g of grid.coins) for (let i = 0; i < grid.n && grid.t[i] < from; i++) if (g.c[i] > 0) st.lastPx[g.coin] = g.c[i];
  let legs = 0;
  for (let i = 1; i < grid.n; i++) {
    if (grid.t[i] < from) continue;
    const h = S.hourOf(grid, i, sim.want, sim.targets.vols, beta, ref), t = {};
    for (const [c, x] of Object.entries(h.coins)) if (x.w) t[c] = x.w * R.capitalShare * st.eq;
    const w = PC.weightsOf(PC.combine({ 'sleeve:trend': t }, { equity: st.eq, rules: open }).book, st.eq);
    for (const [c, x] of Object.entries(h.coins)) x.w = w[c] || 0;
    legs += S.step(st, h, { limits: LIMITS, rules: pr }).legs.filter((l) => l.qty).length;
  }
  assert.ok(direct.events.legs > 50, `the sleeve traded (${direct.events.legs} legs)`);
  assert.strictEqual(legs, direct.events.legs);
  assert.ok(Math.abs(st.eq / direct.state.eq - 1) < 1e-9, `equity ${st.eq} = ${direct.state.eq}`);
  assert.strictEqual(st.ev.stops, direct.events.stops);
});

test('constructor: sleeves net by size; volatility is only scaled down; one correlated group is capped', () => {
  // two sleeves on BTC in opposite directions net out; ideas sized so each stop costs 0.25% of equity
  const ideas = PC.ideaTargets([{ strategy: 'a', coin: 'BTC', side: 1, entry: { px: 100 }, stop: 98 }, { strategy: 'a', coin: 'ETH', side: -1, entry: { px: 10 }, stop: 10.5 }, { strategy: 'b', coin: 'X', side: 1, entry: { px: 1 }, stop: 0.5 }], 10000);
  assert.deepStrictEqual(ideas, { a: { BTC: 1250, ETH: -500 } }, 'the idea with a 50% stop is ignored');
  let c = PC.combine({ a: { BTC: 1250 }, b: { BTC: -1000 } }, { equity: 10000, sigma: { BTC: 0.03 } });
  assert.ok(Math.abs(c.book.BTC - 250) < 1e-9); assert.strictEqual(c.volScale, 1);
  // a big book: 3 × $8k at 4% daily σ, correlated 0.5 → forecast vol far above 10% → scaled down to exactly 10%
  c = PC.combine({ s: { A: 8000, B: 8000, C: -8000 } }, { equity: 10000, sigma: { A: 0.04, B: 0.04, C: 0.04 } });
  assert.ok(c.volBefore > 0.5 && Math.abs(c.vol - 0.10) < 1e-9, `${c.volBefore} → ${c.vol}`);
  const small = PC.combine({ s: { A: 100 } }, { equity: 10000, sigma: { A: 0.04 } });
  assert.strictEqual(small.book.A, 100, 'never scaled up');
  // returns: A, B, C move together (one group), D on its own → the group is cut to 40% of the gross
  const r = rng(3), ret = { A: [], B: [], C: [], D: [] };
  for (let d = 0; d < 60; d++) { const m = (r() - 0.5) * 0.06; for (const k of ['A', 'B', 'C']) ret[k].push([d, m + (r() - 0.5) * 0.005]); ret.D.push([d, (r() - 0.5) * 0.06]); }
  // three groups: A+B+C together, D and E on their own → the group is cut to 40% of the gross
  for (let d = 0; d < 60; d++) (ret.E = ret.E || []).push([d, (r() - 0.5) * 0.06]);
  c = PC.combine({ s: { A: 1000, B: 1000, C: 1000, D: 1000, E: 1000 } }, { equity: 100000, sigma: { A: 0.03, B: 0.03, C: 0.03, D: 0.03, E: 0.03 }, returns: ret });
  assert.strictEqual(c.clusterOf.B, c.clusterOf.A); assert.strictEqual(c.clusterOf.C, c.clusterOf.A); assert.notStrictEqual(c.clusterOf.D, c.clusterOf.A);
  const g = (Math.abs(c.book.A) + Math.abs(c.book.B) + Math.abs(c.book.C)), tot = g + Math.abs(c.book.D) + Math.abs(c.book.E);
  assert.ok(Math.abs(g / tot - 0.4) < 1e-6, `group share ${g / tot}`); assert.strictEqual(c.book.D, 1000);
  assert.match(c.reasons.join(), /of the gross > 40%/);
  // two groups: neither can be under 40%, so the cap is 50%
  const two = PC.combine({ s: { A: 1000, B: 1000, C: 1000, D: 1000 } }, { equity: 100000, sigma: { A: 0.03, B: 0.03, C: 0.03, D: 0.03 }, returns: ret });
  assert.ok(Math.abs(Math.abs(two.book.A) * 3 / (Math.abs(two.book.A) * 3 + 1000) - 0.5) < 1e-6);
});

test('conductor: the dial scales down only; the weekly cap; CUSUM halves a failing sleeve and then proposes shadow', () => {
  const calm = Array.from({ length: 60 }, (_, k) => [k, k % 2 ? 0.003 : -0.002]);
  assert.strictEqual(CD.dial({ daily: calm }).dial, 1, 'quiet book: full size');
  const wild = Array.from({ length: 60 }, (_, k) => [k, k % 2 ? 0.03 : -0.03]);
  const d = CD.dial({ daily: wild });
  assert.ok(d.dial < 0.25 + 1e-9 && d.dial >= 0.25, 'floored at 0.25'); assert.match(d.reasons[0], /realised volatility/);
  assert.strictEqual(CD.dial({ daily: calm, ladderScale: 0.5 }).dial, 0.5);
  const stop = CD.dial({ daily: calm, week: { pnlPct: -0.03 } });
  assert.strictEqual(stop.noNew, true); assert.match(stop.reasons.join(), /no new risk until Monday/);
  assert.strictEqual(CD.dial({ daily: calm, week: { pnlPct: 0, lastPct: -0.05 } }).dial, 0.5);
  assert.strictEqual(new Date(CD.weekStart(Date.UTC(2026, 9, 24, 7))).toISOString(), '2026-10-19T00:00:00.000Z');
  // a sleeve expected to make +0.3 R a day (sd 2) that loses 2 R every day: an alarm about every 8 days → shadow
  let st = null, alarms = 0;
  for (let day = 0; day < 30; day++) { const o = CD.cusumStep(st, day, -2, { mu: 0.3, sd: 2 }); st = o.state; if (o.alarm) alarms++; }
  assert.ok(alarms >= 2);
  assert.deepStrictEqual(CD.shareOf(1, { alarms: st.alarms.slice(-1) }, 30 * 86400000), { share: 0.5, alarms: 1, shadow: false });
  assert.strictEqual(CD.shareOf(1, st, 30 * 86400000).shadow, true);
  // a healthy one never alarms; each day counts once
  st = null; for (let day = 0; day < 200; day++) { const o = CD.cusumStep(st, day, day % 2 ? 2.3 : -1.7, { mu: 0.3, sd: 2 }); st = o.state; assert.strictEqual(o.alarm, false); }
  assert.strictEqual(CD.cusumStep(st, 199, -100, { mu: 0.3, sd: 2 }).alarm, false);
});

test('risk v2 weekly cap: off until the keys are in the signed risk.json; the accountant keeps the week', async () => {
  const a = { equity: 9700, peak: 10000, dayStart: 9800, weekStart: 10000, lastWeekPct: -0.05 };
  assert.strictEqual(new RiskEngine(LIMITS).mode(a).mode, 'normal', 'today\'s risk.json has no weekly keys');
  const v2 = new RiskEngine(Object.assign({}, LIMITS, { weekLossStopPct: 0.025, weekLossHalvePct: 0.04 })).mode(a);
  assert.strictEqual(v2.mode, 'no-new'); assert.strictEqual(v2.budgetScale, 0.5); assert.match(v2.reasons.join(), /no new trades until Monday/);
  // the accountant: weekStart at Monday 00:00 UTC, last week's result when a new week begins
  let now = Date.UTC(2026, 9, 25, 23, 59); // Sunday
  const bus = new MemoryBus({ now: () => now }), cfg = baseCfg(); cfg.trading = { account: 'paper', paperEquity: 10000 };
  const acc = await new Accountant({ bus, cfg, dataDir: tmpDir('week'), now: () => now, heartbeats: false, logSink: quiet }).start();
  try {
    await acc.snapshot();
    assert.strictEqual((await bus.kv.get('account')).weekStart, 10000);
    await bus.publish('trade.closed', { orderId: 'o1', coin: 'ETH', side: 1, qty: 1, entry: 100, exit: 97, netUsd: -300, feeUsd: 1, fundUsd: 0, r: -1, reason: 'stop', strategies: [{ name: 's' }] }); await bus.drain();
    now = Date.UTC(2026, 9, 26, 0, 1); // Monday
    await acc.snapshot();
    const x = await bus.kv.get('account');
    assert.strictEqual(x.weekStart, 9700); assert.strictEqual(x.lastWeekPct, -0.03);
  } finally { await acc.stop(); }
});

test('portfolio agent: a shadow book from the trend sleeve and the ideas in trade — and never an order', async () => {
  let now = Date.UTC(2026, 9, 24, 10, 0);
  const bus = new MemoryBus({ now: () => now }), cfg = baseCfg();
  cfg.blofin.rest = null; // no seeding in the test
  await bus.kv.set('strategyModes', { 'ma-retest-12h': 'trade', 'candle-x': 'shadow' });
  const got = tap(bus, ['portfolio.target', 'portfolio.state', 'order', 'intent', 'sys.command']);
  const pa = await new PortfolioAgent({ bus, cfg, dataDir: tmpDir('pf'), now: () => now, heartbeats: false, logSink: quiet }).start();
  try {
    const hour = Date.UTC(2026, 9, 24, 10, 0);
    for (let k = 0; k < 60; k++) for (const [coin, px] of [['BTC', 80000], ['ETH', 4000], ['SOL', 200]]) {
      await bus.publish('md.bar', { coin, venue: 'blofin', tf: '1m', t: hour + k * 60000, o: px, h: px * 1.001, l: px * 0.999, c: px * (1 + k * 1e-5), v: 1, q: 1 });
    }
    await bus.publish('sleeve.target', { sleeve: 'trend', ts: hour + 3600000, mode: 'shadow', weights: { BTC: 0.4, ETH: -0.2 }, sigma: { BTC: 0.025, ETH: 0.035 }, capitalShare: 0.5 }, { src: 'trend-sleeve' });
    await bus.publish('sleeve.target', { sleeve: 'trend', ts: hour + 3600000, mode: 'shadow', weights: { DOGE: 3 }, sigma: {}, capitalShare: 0.5 }, { src: 'brain' }); // only the sleeve may ask
    await bus.publish('idea', { id: 'i1', strategy: 'ma-retest-12h', coin: 'SOL', side: 1, t: hour + 600000, entry: { px: 200, waitMin: 3 }, stop: 190, timeStopMin: 2880, mode: 'trade', riskPct: 0.05 });
    await bus.publish('idea', { id: 'i2', strategy: 'candle-x', coin: 'SOL', side: -1, t: hour + 600000, entry: { px: 200, waitMin: 3 }, stop: 204, timeStopMin: 60, mode: 'shadow', riskPct: 0.02 });
    await bus.drain();
    now = hour + 3600000 + 13 * 60000; await pa.tick(); await bus.drain();
    const tgt = got.filter((m) => m.type === 'portfolio.target').pop().data, st = got.filter((m) => m.type === 'portfolio.state').pop().data;
    assert.deepStrictEqual(Object.keys(tgt.bySleeve).sort(), ['BTC', 'ETH', 'SOL']);
    assert.ok(tgt.bySleeve.SOL['ma-retest-12h'] > 0 && !tgt.bySleeve.SOL['candle-x'], 'only strategies in trade join the book');
    assert.ok(Math.abs(tgt.bySleeve.SOL['ma-retest-12h'] - 500) < 1e-6, '$10k × 0.25% ÷ a 5% stop');
    assert.ok(!tgt.book.DOGE, 'a target from anyone but the trend sleeve is ignored');
    assert.strictEqual(st.mode, 'shadow'); assert.ok(Object.keys(st.holdings).length >= 2, JSON.stringify(st.legs));
    assert.ok(!got.some((m) => ['order', 'intent', 'sys.command'].includes(m.type)), 'the shadow book sends nothing');
    // the idea ends: the next hour the book lets SOL go
    await bus.publish('shadow.end', { id: 'i1', strategy: 'ma-retest-12h', coin: 'SOL', outcome: 'unfilled' }); await bus.drain();
    for (let k = 0; k < 60; k++) for (const [coin, px] of [['BTC', 80000], ['ETH', 4000], ['SOL', 200]]) await bus.publish('md.bar', { coin, venue: 'blofin', tf: '1m', t: hour + 3600000 + k * 60000, o: px, h: px, l: px, c: px, v: 1, q: 1 });
    await bus.drain();
    now = hour + 2 * 3600000 + 13 * 60000; await pa.tick(); await bus.drain();
    const st2 = got.filter((m) => m.type === 'portfolio.state').pop().data;
    assert.ok(!st2.holdings.SOL, 'SOL closed when its only idea ended');
    assert.ok((await bus.kv.get('portfolio')).doneHour === hour + 3600000);
  } finally { await pa.stop(); }
  assert.ok(REGISTRY.portfolio, 'the runner knows the agent');
  assert.deepStrictEqual(baseCfg().groups.decision, ['coordinator', 'portfolio']);
});
