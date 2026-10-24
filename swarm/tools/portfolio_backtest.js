#!/usr/bin/env node
/* The portfolio core on the trend sleeve's 2020–2026 history (upswarm GUIDE §12 Phase 2, "done when").
 *
 *   node swarm/tools/portfolio_backtest.js <research-data dir> [--validation <validation-data dir>] [--out file.md]
 *
 * 1. Check: the sleeve as configured (sleeve.js run) and the same hours through the constructor with only the trend
 *    sleeve and its new caps open (combine → weights of the whole account → the planner) must be the same book.
 * 2. What the portfolio core adds when only the trend sleeve trades: the forecast-volatility cap (10% a year), the
 *    cluster cap (40% of the gross per correlated group, on 90 days of daily returns), the conductor's dial (60-day
 *    realised volatility) and the weekly loss cap (−2.5% → no new risk until Monday; a week ≤ −4% → half size).
 * Per variant: Sharpe, return a year, volatility, max drawdown, positive weeks and quarters, worst week.
 */
'use strict';
const fs = require('fs'), path = require('path');
const E = require('../src/sleeve/trend_engine');
const S = require('../src/sleeve/sleeve');
const PC = require('../src/portfolio/constructor');
const CD = require('../src/portfolio/conductor');
const { loadCoin, universe } = require('./trend_sleeve_backtest');

const D = 86400, START = Date.parse('2020-01-01T00:00:00Z') / 1000;

function score(daily) {
  const s = E.stats(daily), week = (d) => Math.floor((d + 3) / 7), q = (d) => { const x = new Date(d * D * 1000); return `${x.getUTCFullYear()}Q${Math.floor(x.getUTCMonth() / 3)}`; };
  const agg = (key) => { const m = new Map(); for (const [d, r] of daily) m.set(key(d), (m.get(key(d)) || 1) * (1 + r)); return [...m.values()].map((g) => g - 1); };
  const w = agg(week), qs = agg(q);
  return { sharpe: s.sharpe, cagr: s.cagr, vol: s.vol, posWeeks: w.filter((x) => x > 0).length / w.length, posQuarters: qs.filter((x) => x > 0).length / qs.length, worstWeek: Math.min(...w) };
}

// the sleeve's hours through the constructor (and, with o.conductor, the conductor's dial and weekly cap)
function viaConstructor(grid, sim, rules, limits, o = {}) {
  const R = Object.assign({}, S.RULES, rules), pr = PC.planRules(rules), ref = o.ref || grid.coins.find((g) => g.coin === 'BTC');
  const beta = S.betas(grid, ref, R.betaDays), st = S.newState(pr), sq = Math.sqrt(365);
  for (const g of grid.coins) for (let i = 0; i < grid.n && grid.t[i] < START; i++) if (g.c[i] > 0) st.lastPx[g.coin] = g.c[i];
  const crules = Object.assign({}, CD.RULES, o.crules), stats = { volCut: 0, clusterCut: 0, dialCut: 0, noNew: 0, hours: 0 };
  const closes = grid.coins.map(() => []); // daily closes per coin for the correlations
  for (let i = 1; i < grid.n; i++) {
    const t = grid.t[i];
    if ((t + 3600) % D === 0) grid.coins.forEach((g, j) => { if (g.c[i] > 0) { closes[j].push([Math.floor(t / D), Math.log(g.c[i])]); if (closes[j].length > 92) closes[j].shift(); } });
    if (t < START) continue;
    const h = S.hourOf(grid, i, sim.want, sim.targets.vols, beta, ref), tgt = {}, sigma = {}, returns = {};
    for (const [c, x] of Object.entries(h.coins)) { if (x.w) tgt[c] = x.w * R.capitalShare * st.eq; if (x.sigma > 0) sigma[c] = x.sigma; }
    if (o.caps) grid.coins.forEach((g, j) => { if (!tgt[g.coin]) return; const cl = closes[j], rs = []; for (let k = 1; k < cl.length; k++) if (cl[k][0] === cl[k - 1][0] + 1) rs.push([cl[k][0], cl[k][1] - cl[k - 1][1]]); returns[g.coin] = rs; });
    let dial = 1, noNew = false;
    if (o.conductor) {
      const day = Math.floor(t / D), wk = CD.weekOf(st.daily, day, st.dayStart > 0 ? st.eq / st.dayStart - 1 : 0), d = CD.dial({ daily: st.daily, week: wk, rules: crules });
      dial = d.dial; noNew = d.noNew;
    }
    const comb = PC.combine({ 'sleeve:trend': tgt }, { equity: st.eq, dial, sigma, returns, rules: o.caps ? Object.assign({}, PC.RULES, o.prules) : { portVolTargetPct: Infinity, maxClusterGrossFrac: 1 } });
    const w = PC.weightsOf(comb.book, st.eq);
    if (noNew) for (const c of new Set([...Object.keys(w), ...Object.keys(st.book)])) {
      const px = st.lastPx[c], held = st.book[c] && px > 0 ? (st.book[c].qty * px) / st.eq : 0, x = w[c] || 0;
      w[c] = Math.sign(x) === Math.sign(held) ? Math.sign(held) * Math.min(Math.abs(x), Math.abs(held)) : 0;
    }
    for (const [c, x] of Object.entries(h.coins)) x.w = w[c] || 0;
    S.step(st, h, { limits, rules: pr });
    stats.hours++; if (comb.volScale < 1) stats.volCut++; if (Object.keys(comb.clusterScale).length) stats.clusterCut++; if (dial < 1) stats.dialCut++; if (noNew) stats.noNew++;
  }
  return Object.assign(S.summary(st, pr), { state: st, cuts: stats });
}

function main() {
  const A = { _: [] }, v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; else A._.push(v[i]);
  if (!A._[0]) { console.error('usage: portfolio_backtest.js <research-data dir> [--validation dir] [--out file.md]'); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'swarm.json'), 'utf8')), limits = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'risk.json'), 'utf8'));
  const rules = Object.assign({}, cfg.sleeves.trend.rules), prules = Object.assign({}, (cfg.portfolio || {}).rules), crules = Object.assign({}, (cfg.portfolio || {}).conductor);
  const sets = [['research-data (today\'s top 20)', A._[0]]]; if (A.validation) sets.push(['validation-data (30 other coins, dead ones included)', A.validation]);
  const btc = loadCoin(A._[0], 'BTC'), out = [], log = (...x) => { for (const s of x) { console.log(s); out.push(s); } };
  const pct = (x, d = 1) => `${x >= 0 ? '' : '−'}${Math.abs(x * 100).toFixed(d)}%`;
  log(`# Portfolio core on the trend sleeve, 2020–2026 (${new Date().toISOString().slice(0, 10)})`, '', `Sleeve rules ${JSON.stringify(rules)}; portfolio rules ${JSON.stringify(prules)}; conductor ${JSON.stringify(crules)}; config/risk.json as signed.`, '');
  for (const [label, dir] of sets) {
    const coins = universe(dir).map((c) => loadCoin(dir, c)), grid = E.align(coins);
    let ref = grid.coins.find((g) => g.coin === 'BTC');
    if (!ref) { ref = { coin: 'BTC', o: new Float64Array(grid.n).fill(NaN), h: new Float64Array(grid.n).fill(NaN), l: new Float64Array(grid.n).fill(NaN), c: new Float64Array(grid.n).fill(NaN), fund: new Float64Array(grid.n) }; for (let i = 0; i < btc.t.length; i++) { const k = Math.round((btc.t[i] - grid.t[0]) / E.H); if (k >= 0 && k < grid.n) { ref.o[k] = btc.o[i]; ref.h[k] = btc.h[i]; ref.l[k] = btc.l[i]; ref.c[k] = btc.c[i]; } } }
    const sim = E.simulate(grid, { start: START, keepWant: true });
    const direct = S.run(grid, sim, Object.assign({}, rules, { limits, from: START, ref }));
    const same = viaConstructor(grid, sim, rules, limits, { ref });
    const ok = same.events.legs === direct.events.legs && Math.abs(same.state.eq / direct.state.eq - 1) < 1e-9;
    log(`## ${label}`, '', ok ? `**Check passed:** through the constructor (caps open) the book is the sleeve's own — ${direct.events.legs} legs, final equity $${direct.state.eq.toFixed(2)} both ways.` : `**Check FAILED:** ${same.events.legs} vs ${direct.events.legs} legs, $${same.state.eq.toFixed(2)} vs $${direct.state.eq.toFixed(2)}.`, '');
    const variants = [
      ['sleeve as configured (risk share 0.5)', direct, null],
      ['+ portfolio caps as configured', viaConstructor(grid, sim, rules, limits, { ref, caps: true, prules }), 'caps'],
      ['+ caps as configured + conductor (dial, weekly cap)', viaConstructor(grid, sim, rules, limits, { ref, caps: true, prules, conductor: true, crules }), 'all'],
      ['+ conductor only', viaConstructor(grid, sim, rules, limits, { ref, conductor: true, crules }), 'cond'],
    ];
    log('| Variant | Sharpe | Return a year | Volatility | Max drawdown | Positive weeks | Positive quarters | Worst week | Hours cut by: vol cap / cluster cap / dial / weekly cap |', '|---|---|---|---|---|---|---|---|---|');
    for (const [name, r, k] of variants) {
      const s = score(r.daily), c = r.cuts;
      log(`| ${name} | ${s.sharpe.toFixed(2)} | ${pct(s.cagr)} | ${pct(s.vol)} | ${pct(r.maxDD)} | ${pct(s.posWeeks, 0)} | ${pct(s.posQuarters, 0)} | ${pct(s.worstWeek, 2)} | ${c ? [c.volCut, c.clusterCut, c.dialCut, c.noNew].map((x) => pct(x / Math.max(1, c.hours), 0)).join(' / ') : '—'} |`);
    }
    log('');
  }
  if (A.out) fs.writeFileSync(A.out, out.join('\n') + '\n');
}

if (require.main === module) main();
module.exports = { viaConstructor, score };
