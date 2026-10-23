/* Trend sleeve: the swarm's rules on top of the trend engine's weights (docs/TREND_SLEEVE_DESIGN.md).
 *
 * The engine (trend_engine.js) says, every hour, what fraction of its capital each coin should hold. A swarm
 * account may only hold what config/risk.json allows, and every position needs a stop. plan() turns one hour's
 * weights into rebalance legs that respect every hard limit, using the coordinator's own RiskEngine unchanged:
 *   1. risk ladders (RiskEngine.mode on the account): halt / flatten → close everything; no-new or proven-only →
 *      reductions only; drawdown ≥ 10% → weights × budgetScale;
 *   2. capital share: the sleeve trades capitalShare × account equity (the rest is left to the other strategies);
 *   3. stops: every position has a protective stop stopK daily standard deviations from the price at which it was
 *      opened or last grown (optionally trailed); the sleeve's total stop risk is kept within riskShare ×
 *      maxOpenRiskPct by scaling every weight by the same factor, so the portfolio keeps its shape;
 *   4. hysteresis: a coin trades only outside the engine's band (25% of its target, ≥ 0.5% of the capital);
 *   5. every leg that adds risk goes through RiskEngine.check for the whole resulting position, against every other
 *      leg (the sleeve's other coins and the other strategies' positions): risk per trade, total open risk, coin
 *      notional, gross, net BTC exposure, spread and book depth, exchange minimum, data guard, news windows.
 *      A trim keeps the trimmed size; a reject keeps what is held. Legs that only reduce risk always pass, as a
 *      reduce-only order would.
 * step() advances the sleeve's book one hour: stops are checked on the hour's high/low (gaps fill at the open),
 * costs and funding are paid, the ladders see the account, then plan() trades at the close. run() is step() over a
 * history (the backtest); the agent calls step() every hour (the live shadow book).
 * Pure: no I/O.
 */
'use strict';
const { RiskEngine } = require('../decision/risk');
const E = require('./trend_engine');

const RULES = {
  capitalShare: 0.5, // fraction of account equity the sleeve trades
  stopK: 8, // protective stop distance in daily standard deviations (90-day realised volatility ÷ √365)
  trailStops: false, // true: stops also follow the price every hour (only ever tighter); false: set when a position opens or grows
  riskShare: 1, // the sleeve's stops may risk at most this share of risk.json maxOpenRiskPct (lower it once other strategies trade)
  band: 0.25, minTradePct: 0.005, // the engine's hysteresis (minTradePct of the sleeve's capital)
  fee: 0.00059, // per side on rebalances: chase the best price 30 min, then market (measured 5.9 bps)
  stopCostBps: 7.5, // a stop is a market order: taker 6 + slippage 1.5
  cooldown: 'day', // after a stop: no new position in that coin before the next 00:00 UTC
  equity0: 10000, // the backtest's account (USD)
  betaDays: 30, // rolling daily beta to BTC for the BTC-exposure limit (clamped 0.5 – 3, as the coordinator does)
};

/* One hour's decision.
 * w:      {coin: weight}  the engine's weights, as fractions of the sleeve's capital
 * book:   {coin: {qty (signed, base units), stop}}  what the sleeve holds
 * mkt:    {coin: {px, sigma (daily vol, fraction), beta?, cool? (true: in cooldown)}}
 * account {equity, peak, dayStart}, limits (risk.json), others: [{coin, side, qty, px, stop}] other strategies' legs
 * s:      optional RiskEngine state extras: book(coin), inst(coin), tradable(coin), inWindow, halted, paused
 * → {mode, scale, riskPct, legs: [{coin, kind, from, to, qty, px, stop, verdict, reasons}], book (after the legs)}
 */
function plan(w, book, mkt, account, limits, others = [], rules = {}, s = {}) {
  const R = Object.assign({}, RULES, rules), risk = new RiskEngine(limits);
  const rm = risk.mode(account, { halted: s.halted, paused: s.paused }), eq = account && account.equity;
  const legs = [], out = {};
  for (const [c, p] of Object.entries(book)) if (p.qty) out[c] = { qty: p.qty, stop: p.stop };
  const closeAll = rm.mode === 'halt' || rm.mode === 'flatten', reduceOnly = rm.mode !== 'normal' || rm.provenOnly;
  // target notionals (USD), the sleeve's capital share and the drawdown ladder's scale
  const cap = R.capitalShare * (eq > 0 ? eq : 0), want = {};
  for (const [c, x] of Object.entries(w)) { const m = mkt[c]; if (m && m.px > 0 && Number.isFinite(x) && !closeAll) want[c] = x * cap * rm.budgetScale; }
  // the sleeve's own stop-risk budget: scale every target by one factor
  let need = 0;
  for (const [c, n] of Object.entries(want)) need += Math.abs(n) * R.stopK * mkt[c].sigma;
  const budget = R.riskShare * limits.maxOpenRiskPct * (eq > 0 ? eq : 0), scale = need > budget ? budget / need : 1;
  for (const c of Object.keys(want)) want[c] *= scale;
  const coins = new Set([...Object.keys(want), ...Object.keys(out)]);
  const reduce = [], add = [];
  for (const c of coins) {
    const m = mkt[c], h = out[c] ? out[c].qty : 0;
    if (!m || !(m.px > 0)) continue; // no price: leave it
    const cur = h * m.px, tgt = want[c] || 0, gap = tgt - cur;
    if (!closeAll && (Math.abs(gap) < R.minTradePct * cap || (Math.abs(gap) < R.band * Math.abs(tgt) && tgt !== 0 && Math.sign(tgt) === Math.sign(cur)))) continue;
    if (cur && (Math.sign(tgt) !== Math.sign(cur) || Math.abs(tgt) < Math.abs(cur))) reduce.push({ c, tgt: Math.sign(tgt) === Math.sign(cur) ? tgt : 0, cur, m });
    if (tgt && (Math.sign(tgt) !== Math.sign(cur) || Math.abs(tgt) > Math.abs(cur))) add.push({ c, tgt, cur, m });
  }
  // reductions first: they free room for the additions
  for (const r of reduce) {
    const q = r.tgt / r.m.px, from = out[r.c].qty;
    if (q) out[r.c].qty = q; else delete out[r.c];
    legs.push({ coin: r.c, kind: q ? 'reduce' : 'close', from, to: q, qty: q - from, px: r.m.px, stop: q ? out[r.c].stop : null, verdict: 'approve', reasons: closeAll ? [`risk mode ${rm.mode}`] : [] });
  }
  add.sort((a, b) => Math.abs(b.tgt - b.cur) - Math.abs(a.tgt - a.cur));
  for (const a of add) {
    const from = out[a.c] ? out[a.c].qty : 0, side = Math.sign(a.tgt);
    if (reduceOnly) { legs.push({ coin: a.c, kind: from ? 'add' : 'open', from, to: from, qty: 0, px: a.m.px, stop: null, verdict: 'reject', reasons: [`risk mode ${rm.mode}${rm.provenOnly ? ' (proven strategies only)' : ''}`] }); continue; }
    if (a.m.cool) { legs.push({ coin: a.c, kind: from ? 'add' : 'open', from, to: from, qty: 0, px: a.m.px, stop: null, verdict: 'reject', reasons: ['stopped out today: waiting for 00:00 UTC'] }); continue; }
    const stop = a.m.px * (1 - side * R.stopK * a.m.sigma);
    if (!(stop > 0)) { legs.push({ coin: a.c, kind: 'open', from, to: from, qty: 0, px: a.m.px, stop: null, verdict: 'reject', reasons: ['stop would be at or below zero'] }); continue; }
    // the whole resulting position is checked, against every other leg
    const legsNow = [...others, ...Object.entries(out).filter(([c]) => c !== a.c).map(([c, p]) => ({ coin: c, side: Math.sign(p.qty), qty: Math.abs(p.qty), px: mkt[c] ? mkt[c].px : 0, stop: p.stop }))];
    const st = Object.assign({ equity: eq, mode: 'normal', positions: legsNow, working: [], beta: (c) => (c === 'BTC' ? 1 : mkt[c] && Number.isFinite(mkt[c].beta) ? Math.min(3, Math.max(0.5, mkt[c].beta)) : 1) }, s);
    const d = risk.check({ coin: a.c, side, entry: { px: a.m.px }, stop }, { qty: Math.abs(a.tgt) / a.m.px }, st);
    if (d.verdict === 'reject') { legs.push({ coin: a.c, kind: from ? 'add' : 'open', from, to: from, qty: 0, px: a.m.px, stop: null, verdict: 'reject', reasons: d.reasons }); continue; }
    const q = side * d.qty;
    if (from && Math.sign(from) === side && Math.abs(q) <= Math.abs(from)) { legs.push({ coin: a.c, kind: 'add', from, to: from, qty: 0, px: a.m.px, stop: null, verdict: 'reject', reasons: d.reasons.concat('trimmed below what is held') }); continue; }
    out[a.c] = { qty: q, stop };
    legs.push({ coin: a.c, kind: from ? 'add' : 'open', from, to: q, qty: q - from, px: a.m.px, stop, verdict: d.verdict, reasons: d.reasons });
  }
  // at today's prices the stops may now be further away than when they were set: tighten them (never loosen) so no
  // position risks more than maxTradeRiskPct and the sleeve no more than its budget — the furthest stops (in daily
  // standard deviations) move first, so the positions with the most profit behind them give back the least
  for (const m of fitStops(out, mkt, eq, budget, limits.maxTradeRiskPct)) legs.push(Object.assign({ kind: 'stop', qty: 0, verdict: 'approve', reasons: ['stop tightened: risk budget at current prices'] }, m));
  let riskUsd = 0; for (const [c, p] of Object.entries(out)) if (mkt[c]) riskUsd += Math.abs(p.qty) * Math.abs(mkt[c].px - p.stop);
  return { mode: rm.mode, budgetScale: rm.budgetScale, provenOnly: !!rm.provenOnly, scale, riskPct: eq > 0 ? riskUsd / eq : 0, legs, book: out };
}

// book's stops at current prices → within maxTradePct of equity each and `budget` (USD) together; returns the moves
function fitStops(book, mkt, eq, budget, maxTradePct) {
  const list = [];
  for (const [c, p] of Object.entries(book)) {
    const m = mkt[c]; if (!m || !(m.px > 0) || !(m.sigma > 0) || !p.qty) continue;
    const q = Math.abs(p.qty), s = Math.sign(p.qty), dist = s * (m.px - p.stop); // ≤ 0: the price is through the stop
    if (!(dist > 0)) continue;
    list.push({ c, p, q, s, m, dist: Math.min(dist, (maxTradePct * eq) / q), unit: m.sigma * m.px });
  }
  const total = (D) => list.reduce((a, x) => a + x.q * Math.min(x.dist, D * x.unit), 0);
  let D = Infinity;
  if (total(Infinity) > budget) { let lo = 0, hi = Math.max(...list.map((x) => x.dist / x.unit)); for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (total(mid) > budget) hi = mid; else lo = mid; } D = lo; }
  const moves = [];
  for (const x of list) {
    const nd = Math.min(x.dist, D * x.unit), ns = x.m.px - x.s * nd;
    if (x.s * (ns - x.p.stop) > x.m.px * 1e-9) { moves.push({ coin: x.c, from: x.p.qty, to: x.p.qty, px: x.m.px, stop: ns, was: x.p.stop }); x.p.stop = ns; }
  }
  return moves;
}

// stops only tighten: long stops rise to px − k·σ·px, short stops fall to px + k·σ·px
function trail(book, mkt, k) {
  for (const [c, p] of Object.entries(book)) {
    const m = mkt[c]; if (!m || !(m.px > 0) || !(m.sigma > 0)) continue;
    const ns = m.px * (1 - Math.sign(p.qty) * k * m.sigma);
    if (Math.sign(p.qty) * (ns - p.stop) > 0) p.stop = ns;
  }
}

// rolling beta of daily returns to a reference (BTC), on the hourly grid
function betas(grid, ref, days) {
  const rd = ref ? E.resample(grid, ref, '1d') : null, refRet = new Map();
  if (rd) for (let k = 1; k < rd.c.length; k++) refRet.set(Math.floor(grid.t[rd.end[k]] / E.D), Math.log(rd.c[k] / rd.c[k - 1]));
  return grid.coins.map((g) => {
    if (!rd || g === ref) return null;
    const d = E.resample(grid, g, '1d'), v = new Float64Array(d.c.length).fill(NaN), xs = [], ys = [];
    for (let k = 1; k < d.c.length; k++) {
      const x = refRet.get(Math.floor(grid.t[d.end[k]] / E.D)), y = Math.log(d.c[k] / d.c[k - 1]);
      xs.push(Number.isFinite(x) ? x : NaN); ys.push(y);
      if (xs.length > days) { xs.shift(); ys.shift(); }
      let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let q = 0; q < xs.length; q++) if (Number.isFinite(xs[q]) && Number.isFinite(ys[q])) { n++; sx += xs[q]; sy += ys[q]; sxx += xs[q] * xs[q]; sxy += xs[q] * ys[q]; }
      const vx = sxx / n - (sx / n) ** 2;
      if (n >= 20 && vx > 0) v[k] = (sxy / n - (sx / n) * (sy / n)) / vx;
    }
    return E.toGrid(grid.n, d, v, NaN);
  });
}

/* The sleeve's book through time: one state, advanced one hour at a time by step(). run() (the backtest) and the
 * agent (the live shadow book) use the same step, so the agent does what the backtest measured.
 * state: plain JSON (the agent keeps it in kv 'sleeve:trend' across restarts).
 */
function newState(rules = {}, t0 = 0) {
  const R = Object.assign({}, RULES, rules), eq = R.equity0;
  return { t: t0, eq, peak: eq, dayStart: eq, dayKey: -1, halted: false, mode: 'normal', book: {}, cool: {}, lastPx: {}, frac: {}, daily: [], mdd: 0, fees: 0, funding: 0, stopCost: 0,
    ev: { stops: 0, stopMoves: 0, legs: 0, trims: {}, rejects: {}, scaledHours: 0, hours: 0, modeHours: {}, halts: [], flattens: 0, maxRiskPct: 0, riskPctSum: 0, grossSum: 0, maxGross: 0 }, last: null };
}

/* Advance the book over one hour and trade at its close.
 * h = { t (unix s, the hour's candle open), coins: { coin: {o, h, l, c, pc (previous hour's close or NaN), fund (rate
 *       settled in the hour, 0 if none), w (engine weight), sigma (daily vol, fraction), beta} } }
 * o = { limits, rules, unconstrained (book as the research engine does: weights, no limits), others (other
 *       strategies' legs, for a live dry run), haltForever (default true) }
 * Returns the hour's plan (legs, mode, …); the state is changed in place.
 */
function step(st, h, o) {
  const R = Object.assign({}, RULES, o.rules), L = o.limits, t = h.t, dk = Math.floor(t / E.D), ev = st.ev, book = st.book;
  // 1) the hour: stops on its high/low, then marks and funding. After a data gap the sleeve marks from the last
  //    price it saw; the research book (unconstrained) books nothing for the gap and keeps the coin's weight.
  const resumed = [];
  for (const [c, p] of Object.entries(book)) {
    const x = h.coins[c];
    if (!x || isNaN(x.c)) continue;
    const pc = o.unconstrained ? x.pc : st.lastPx[c];
    if (!(pc > 0)) { if (o.unconstrained) resumed.push(c); continue; }
    const s = Math.sign(p.qty);
    if (!o.unconstrained && (s > 0 ? x.l <= p.stop : x.h >= p.stop)) {
      const px = s > 0 ? Math.min(x.o, p.stop) : Math.max(x.o, p.stop), cost = (Math.abs(p.qty) * px * R.stopCostBps) / 1e4;
      st.eq += p.qty * (px - pc) - cost; st.stopCost += cost; ev.stops++;
      delete book[c];
      if (R.cooldown === 'day') st.cool[c] = (dk + 1) * E.D;
      continue;
    }
    st.eq += p.qty * (x.c - pc);
    if (x.fund) { const f = p.qty * pc * x.fund; st.eq -= f; st.funding += f; }
  }
  for (const c of resumed) book[c].qty = (st.frac[c] * st.eq) / h.coins[c].c;
  for (const [c, x] of Object.entries(h.coins)) if (x.c > 0) st.lastPx[c] = x.c;
  // 2) the hour's close: plan and trade
  const mkt = {}, w = {};
  for (const [c, x] of Object.entries(h.coins)) {
    if (!(x.c > 0)) continue;
    mkt[c] = { px: x.c, sigma: x.sigma > 0 ? x.sigma : 0.05, beta: x.beta, cool: (st.cool[c] || 0) > t }; // no volatility yet: 5% a day (matters only for a coin still held)
    if (x.w) w[c] = x.w;
  }
  if (!o.unconstrained && R.trailStops) trail(book, mkt, R.stopK);
  let res;
  if (o.unconstrained) {
    // booked exactly as the research engine does: it holds weights, not quantities, so costs paid this hour shrink
    // every position in proportion and the coins traded hold their weight of what is left
    res = { mode: 'normal', scale: 1, riskPct: 0, legs: [], book: {} };
    const cap = R.capitalShare * st.eq, eq0 = st.eq, traded = [];
    for (const c of new Set([...Object.keys(w), ...Object.keys(book)])) {
      const m = mkt[c]; if (!m) { if (book[c]) res.book[c] = book[c]; continue; }
      const cur = (book[c] ? book[c].qty : 0) * m.px, tgt = (w[c] || 0) * cap, gap = tgt - cur;
      if (Math.abs(gap) < R.minTradePct * cap || (Math.abs(gap) < R.band * Math.abs(tgt) && tgt !== 0 && Math.sign(tgt) === Math.sign(cur))) { if (book[c]) res.book[c] = book[c]; continue; }
      const before = st.eq; st.eq *= 1 - (Math.abs(gap) / cap) * R.fee; st.fees += before - st.eq; ev.legs++;
      traded.push(c);
    }
    for (const p of Object.values(res.book)) p.qty *= st.eq / eq0;
    for (const c of traded) if (w[c]) res.book[c] = { qty: (w[c] * R.capitalShare * st.eq) / mkt[c].px, stop: 0 };
  } else {
    res = plan(w, book, mkt, { equity: st.eq, peak: Math.max(st.peak, st.eq), dayStart: dk !== st.dayKey ? st.eq : st.dayStart }, L, o.others || [], R, { halted: st.halted });
    if (res.mode === 'halt' && !st.halted) { ev.halts.push(new Date(t * 1000).toISOString().slice(0, 10)); if (o.haltForever !== false) st.halted = true; else st.peak = st.eq; }
    if (res.mode === 'flatten' && st.mode !== 'flatten') ev.flattens++;
    ev.modeHours[res.mode] = (ev.modeHours[res.mode] || 0) + 1;
    if (res.budgetScale < 1) ev.modeHours['budget-halved'] = (ev.modeHours['budget-halved'] || 0) + 1;
    if (res.scale < 1) ev.scaledHours++;
    const key = (r) => r.replace(/[\d.]+/g, '#');
    for (const l of res.legs) {
      if (l.kind === 'stop') { ev.stopMoves++; continue; }
      if (!l.qty) { if (l.verdict === 'reject') for (const r of l.reasons) ev.rejects[key(r)] = (ev.rejects[key(r)] || 0) + 1; continue; }
      const cost = Math.abs(l.qty) * l.px * R.fee; st.eq -= cost; st.fees += cost; ev.legs++;
      if (l.verdict === 'trim') for (const r of l.reasons) ev.trims[r] = (ev.trims[r] || 0) + 1;
    }
  }
  st.mode = res.mode;
  for (const c of Object.keys(book)) delete book[c];
  Object.assign(book, res.book);
  if (o.unconstrained) for (const [c, p] of Object.entries(book)) { const px = h.coins[c] && h.coins[c].c; if (px > 0) st.frac[c] = (p.qty * px) / st.eq; }
  let gross = 0; for (const [c, p] of Object.entries(book)) if (mkt[c]) gross += Math.abs(p.qty) * mkt[c].px;
  // daily returns as the research engine books them (a day's first hour counts after its trades)
  if (dk !== st.dayKey) { if (st.dayKey >= 0) st.daily.push([st.dayKey, st.eq / st.dayStart - 1]); st.dayKey = dk; st.dayStart = st.eq; }
  if (st.eq > st.peak) st.peak = st.eq;
  st.mdd = Math.max(st.mdd, 1 - st.eq / st.peak);
  ev.hours++; ev.riskPctSum += res.riskPct; ev.maxRiskPct = Math.max(ev.maxRiskPct, res.riskPct); ev.grossSum += gross / st.eq; ev.maxGross = Math.max(ev.maxGross, gross / st.eq);
  st.t = t;
  return res;
}

// summary of a state: the research engine's statistics on its daily returns, plus what the limits did
function summary(st, rules = {}) {
  const R = Object.assign({}, RULES, rules), ev = st.ev, s = E.stats(st.daily, st.eq / R.equity0);
  return Object.assign(s, { maxDD: st.mdd, final: st.eq / R.equity0, feesPct: (st.fees / R.equity0) * 100, fundingPct: (st.funding / R.equity0) * 100, stopCostPct: (st.stopCost / R.equity0) * 100,
    legsPerDay: ev.legs / Math.max(1, st.daily.length), avgRiskPct: ev.riskPctSum / Math.max(1, ev.hours), avgGross: ev.grossSum / Math.max(1, ev.hours), events: ev, daily: st.daily, book: st.book });
}

// hour i of a grid as step() wants it
function hourOf(grid, i, want, vols, beta, ref) {
  const coins = {}, sq = Math.sqrt(365);
  for (let j = 0; j < grid.coins.length; j++) {
    const g = grid.coins[j];
    coins[g.coin] = { o: g.o[i], h: g.h[i], l: g.l[i], c: g.c[i], pc: i ? g.c[i - 1] : NaN, fund: g.fund[i], w: want[j][i], sigma: vols[j][i] / sq, beta: beta[j] ? beta[j][i] : g === ref ? 1 : NaN };
  }
  return { t: grid.t[i], coins };
}

/* Replay the sleeve over a grid. sim = trend_engine.simulate(grid, {keepWant: true, …}).
 * o: RULES overrides + { limits (risk.json), from (unix s: the account starts flat with equity0 here), ref (BTC grid
 *    coin for betas, default the grid's BTC), unconstrained, haltForever, state (continue this state: hours after
 *    state.t only) }
 */
function run(grid, sim, o = {}) {
  const R = Object.assign({}, RULES, o);
  if (!o.limits && !o.unconstrained) throw new Error('sleeve.run needs limits (risk.json)');
  const ref = o.ref || grid.coins.find((g) => g.coin === 'BTC') || null, beta = betas(grid, ref, R.betaDays);
  const from = o.from || grid.t[1], st = o.state || newState(R);
  if (!o.state) for (const g of grid.coins) for (let i = 0; i < grid.n && grid.t[i] < from; i++) if (g.c[i] > 0) st.lastPx[g.coin] = g.c[i];
  const opts = { limits: o.limits, rules: R, unconstrained: o.unconstrained, haltForever: o.haltForever, others: o.others };
  for (let i = 1; i < grid.n; i++) {
    if (grid.t[i] < from || grid.t[i] <= st.t) continue;
    st.last = step(st, hourOf(grid, i, sim.want, sim.targets.vols, beta, ref), opts);
  }
  return Object.assign(summary(st, R), { state: st });
}

module.exports = { RULES, plan, fitStops, trail, betas, newState, step, hourOf, summary, run };
