/* Portfolio constructor (upswarm GUIDE §6.2–6.3, §7.1): one book for every signal source, instead of "the first idea
 * grabs the coin". Pure: no I/O.
 *
 * Every source is a sleeve that says, per coin, how much it wants to hold (USD notional, signed):
 *   - the trend sleeve: its weights × its capital share × equity (sleeve.target);
 *   - idea strategies, through the adapter (ideaTargets): an idea of a strategy in trade asks for side × the notional
 *     whose stop would cost `ideaRiskPct` of equity, from the moment it is published until its shadow trade ends —
 *     exactly the size the allocator gives it today, but as a target the book moves toward, not a locked coin.
 * combine() then, in order:
 *   1. each sleeve × its share (the conductor's sleeve shares) × the conductor's dial;
 *   2. adds the sleeves up per coin — opposite views net out by size, no fee paid twice;
 *   3. cluster cap (off by default: it did not help the trend sleeve on 2020–2026, docs/PORTFOLIO_BACKTEST_2026-10-24.md):
 *      coins whose daily returns correlate ≥ clusterRho form one group (majors, memes …); no group may
 *      be more than maxClusterGrossFrac of the gross (never less than 1 ÷ the number of groups) — the excess is
 *      scaled away inside that group. Groups use the raw correlations; the volatility forecast the shrunk ones;
 *   4. portfolio volatility: the book's forecast volatility (daily σ per coin, correlations of daily returns shrunk
 *      halfway to their average; 0.5 between every pair when there are no returns yet) is scaled DOWN to
 *      portVolTargetPct a year — never up. Last, so the book always ends at or under the target.
 * plan() hands the result to the trend sleeve's planner (sleeve.js plan(): the risk ladders, a protective stop
 * stopK daily σ away on every position, the stop-risk budget, the 25% no-trade band, and every leg that adds risk
 * through the coordinator's RiskEngine against every other leg). With only the trend sleeve at share 1 and dial 1,
 * nothing in steps 2–4 binds and the book is the sleeve's own, leg for leg (test/portfolio.test.js).
 */
'use strict';
const S = require('../sleeve/sleeve');

const RULES = {
  portVolTargetPct: 0.10, // the book's forecast volatility a year, at most (GUIDE §6.3: 10% on paper to start)
  maxClusterGrossFrac: 1, // one correlated group at most this share of the gross (1 = off: tested, see config note)
  clusterRho: 0.7, // daily-return correlation that puts two coins in one group
  shrink: 0.5, // correlations shrunk this far toward their average
  defaultRho: 0.5, // between coins with too few common days of returns
  minReturnDays: 30, // days of common returns before a correlation is used
  ideaRiskPct: 0.0025, // what one idea's stop may cost (risk.json startTradeRiskPct)
  ideaMaxStopPct: 0.25, // an idea whose stop is further than this is ignored (the sentinel's rule)
};

// open ideas → per strategy, per coin, USD notional. ideas: [{strategy, coin, side, entry:{px}, stop}]
function ideaTargets(ideas, equity, rules = {}) {
  const R = Object.assign({}, RULES, rules), out = {};
  if (!(equity > 0)) return out;
  for (const i of ideas || []) {
    const px = i.entry && i.entry.px, dist = px > 0 && i.stop > 0 ? Math.abs(px - i.stop) / px : 0;
    if (!(dist > 0) || dist > R.ideaMaxStopPct || (i.side !== 1 && i.side !== -1)) continue;
    const s = (out[i.strategy] = out[i.strategy] || {});
    s[i.coin] = (s[i.coin] || 0) + (i.side * R.ideaRiskPct * equity) / dist;
  }
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
// daily returns {coin: [[dayIndex, r], …]} → correlation of two coins on their common days (null when too few)
function corr(a, b, minDays) {
  if (!a || !b) return null;
  const mb = new Map(b), xs = [], ys = [];
  for (const [d, r] of a) if (mb.has(d)) { xs.push(r); ys.push(mb.get(d)); }
  if (xs.length < minDays) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
// coins → {rho(a, b)} with shrinkage toward the average pairwise correlation
function correlations(coins, returns = {}, rules = {}) {
  const R = Object.assign({}, RULES, rules), raw = new Map(), key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const vals = [];
  for (let i = 0; i < coins.length; i++) for (let j = i + 1; j < coins.length; j++) { const r = corr(returns[coins[i]], returns[coins[j]], R.minReturnDays); raw.set(key(coins[i], coins[j]), r); if (r != null) vals.push(r); }
  const avg = vals.length ? mean(vals) : R.defaultRho;
  return {
    avg,
    rho: (a, b) => { if (a === b) return 1; const r = raw.get(key(a, b)); return r == null ? R.defaultRho : (1 - R.shrink) * r + R.shrink * avg; },
    raw: (a, b) => { if (a === b) return 1; const r = raw.get(key(a, b)); return r == null ? R.defaultRho : r; },
  };
}
// greedy groups: the largest position first; a coin joins the first group whose first member it correlates with ≥ clusterRho
function clusters(coins, rho, rules = {}) {
  const R = Object.assign({}, RULES, rules), heads = [], of = {};
  for (const c of coins) {
    const h = heads.find((x) => rho(x, c) >= R.clusterRho);
    if (h) of[c] = h; else { heads.push(c); of[c] = c; }
  }
  return of;
}
// forecast volatility a year of a book {coin: usd} as a fraction of equity
function bookVol(book, sigma, rho, equity) {
  const cs = Object.keys(book).filter((c) => book[c] && sigma[c] > 0);
  let v = 0;
  for (const a of cs) for (const b of cs) v += book[a] * book[b] * sigma[a] * sigma[b] * rho(a, b);
  return equity > 0 ? (Math.sqrt(Math.max(0, v)) / equity) * Math.sqrt(365) : 0;
}

/* sleeves: {name: {coin: usd}} · ctx: {equity, shares: {name: x} (default 1), dial (default 1), sigma: {coin: daily σ},
 * returns: {coin: [[day, r]]}, rules} → {book: {coin: usd}, bySleeve: {coin: {name: usd}}, volBefore, vol, volScale,
 * clusterOf, clusterScale: {group: x}, reasons: []} */
function combine(sleeves, ctx = {}) {
  const R = Object.assign({}, RULES, ctx.rules), eq = ctx.equity, dial = ctx.dial == null ? 1 : ctx.dial, sigma = ctx.sigma || {};
  const book = {}, bySleeve = {}, reasons = [];
  for (const [name, t] of Object.entries(sleeves || {})) {
    const k = (ctx.shares && ctx.shares[name] != null ? ctx.shares[name] : 1) * dial;
    if (!(k > 0)) continue;
    for (const [c, n] of Object.entries(t || {})) {
      if (!Number.isFinite(n) || !n) continue;
      book[c] = (book[c] || 0) + n * k;
      (bySleeve[c] = bySleeve[c] || {})[name] = n * k;
    }
  }
  for (const c of Object.keys(book)) if (Math.abs(book[c]) < 1e-9) delete book[c];
  const coins = Object.keys(book).sort((a, b) => Math.abs(book[b]) - Math.abs(book[a]));
  const C = correlations(coins, ctx.returns || {}, R);
  // 3. cluster cap
  const clusterOf = clusters(coins, C.raw, R), gross = coins.reduce((a, c) => a + Math.abs(book[c]), 0), byGroup = {}, clusterScale = {};
  for (const c of coins) byGroup[clusterOf[c]] = (byGroup[clusterOf[c]] || 0) + Math.abs(book[c]);
  const groups = Object.keys(byGroup);
  if (groups.length > 1 && gross > 0) {
    // water-filling: every group at most x, where x = cap × the gross after capping. The cap is never below 1 ÷ the
    // number of groups (two groups cannot both be under 40%). The largest x with x ≤ cap × Σ min(group, x).
    const cap = Math.max(R.maxClusterGrossFrac, 1 / groups.length), gs = groups.map((k) => byGroup[k]), top = Math.max(...gs);
    const f = (x) => x - cap * gs.reduce((a, g) => a + Math.min(g, x), 0);
    if (f(top) > 0) {
      let lo = 0, hi = top;
      for (let k = 0; k < 100; k++) { const mid = (lo + hi) / 2; if (f(mid) <= 0) lo = mid; else hi = mid; }
      for (const k of groups) if (byGroup[k] > lo) { clusterScale[k] = lo / byGroup[k]; reasons.push(`group ${k}: ${((byGroup[k] / gross) * 100).toFixed(0)}% of the gross > ${(cap * 100).toFixed(0)}%: × ${clusterScale[k].toFixed(2)}`); }
      for (const c of coins) if (clusterScale[clusterOf[c]] != null) book[c] *= clusterScale[clusterOf[c]];
    }
  }
  // 4. portfolio volatility, scaled down only — last, so cutting a hedge in step 3 cannot leave it above the target
  const volBefore = bookVol(book, sigma, C.rho, eq);
  let volScale = 1;
  if (volBefore > R.portVolTargetPct && volBefore > 0) { volScale = R.portVolTargetPct / volBefore; reasons.push(`forecast volatility ${(volBefore * 100).toFixed(1)}% a year > ${(R.portVolTargetPct * 100).toFixed(0)}%: book × ${volScale.toFixed(2)}`); }
  for (const c of coins) book[c] *= volScale;
  for (const c of Object.keys(bySleeve)) for (const n of Object.keys(bySleeve[c])) bySleeve[c][n] *= volScale * (clusterScale[clusterOf[c]] != null ? clusterScale[clusterOf[c]] : 1);
  return { book, bySleeve, volBefore, vol: bookVol(book, sigma, C.rho, eq), volScale, clusterOf, clusterScale, avgRho: C.avg, reasons };
}

// the combined book as weights of equity for sleeve.js plan()/step(): the whole account is the capital base
function weightsOf(book, equity) { const w = {}; if (equity > 0) for (const [c, n] of Object.entries(book)) w[c] = n / equity; return w; }
// the planner's rules for the whole book: capital share 1, the sleeve's minimum trade as a share of equity
function planRules(sleeveRules = {}, extra = {}) {
  const base = Object.assign({}, S.RULES, sleeveRules);
  return Object.assign({}, base, { capitalShare: 1, minTradePct: base.minTradePct * base.capitalShare }, extra);
}

module.exports = { RULES, ideaTargets, correlations, clusters, bookVol, combine, weightsOf, planRules };
