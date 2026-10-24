/* Risk engine: the hard limits every order must pass (config/risk.json, signed by Ibrahim; no agent edits it).
 *
 * mode(account): the loss ladders
 *   day loss ≥ 3% → no new trades until 00:00 UTC · ≥ 5% → close everything, no new trades until 00:00 UTC
 *   drawdown ≥ 10% → all budgets halved · ≥ 15% → only proven strategies, at half · ≥ 20% → close everything and
 *   stop until Ibrahim resumes
 * risk v2 (docs/RISK_V2.md), active only once the keys are in the signed risk.json:
 *   week-to-date loss ≥ weekLossStopPct → no new trades until Monday 00:00 UTC · last week ≤ −weekLossHalvePct →
 *   this week's budgets halved
 * check(intent, size, state): per order — trims the size to the tightest limit or rejects with reasons:
 *   risk per trade, total open risk (every stop together, working orders included), one coin's notional, gross
 *   notional, net BTC exposure (alts counted by beta), spread and book depth, exchange minimum, data guard and news.
 */
'use strict';

class RiskEngine {
  constructor(limits) { this.L = limits; }

  mode(a, o = {}) {
    const L = this.L, reasons = [];
    if (!a || !(a.equity > 0)) return { mode: 'no-new', budgetScale: 0, provenOnly: false, reasons: ['no account data'] };
    const dayLoss = a.dayStart > 0 ? 1 - a.equity / a.dayStart : 0, dd = a.peak > 0 ? 1 - a.equity / a.peak : 0;
    let mode = 'normal', budgetScale = 1, provenOnly = false;
    if (o.halted) { mode = 'halt'; reasons.push('halted: waiting for Ibrahim'); }
    else if (dd >= L.ddHaltPct) { mode = 'halt'; reasons.push(`drawdown ${(dd * 100).toFixed(1)}% ≥ ${L.ddHaltPct * 100}%`); }
    else if (dayLoss >= L.dayFlattenPct) { mode = 'flatten'; reasons.push(`day loss ${(dayLoss * 100).toFixed(1)}% ≥ ${L.dayFlattenPct * 100}%`); }
    else if (dayLoss >= L.dayStopPct) { mode = 'no-new'; reasons.push(`day loss ${(dayLoss * 100).toFixed(1)}% ≥ ${L.dayStopPct * 100}%`); }
    if (dd >= L.ddProvenOnlyPct) { budgetScale = 0.5; provenOnly = true; reasons.push(`drawdown ${(dd * 100).toFixed(1)}%: proven strategies only, half size`); }
    else if (dd >= L.ddHalvePct) { budgetScale = 0.5; reasons.push(`drawdown ${(dd * 100).toFixed(1)}%: budgets halved`); }
    // risk v2: the week (the accountant's weekStart, Monday 00:00 UTC)
    const weekLoss = a.weekStart > 0 ? 1 - a.equity / a.weekStart : 0;
    if (L.weekLossStopPct && weekLoss >= L.weekLossStopPct && mode === 'normal') { mode = 'no-new'; reasons.push(`week loss ${(weekLoss * 100).toFixed(1)}% ≥ ${L.weekLossStopPct * 100}%: no new trades until Monday`); }
    if (L.weekLossHalvePct && a.lastWeekPct != null && -a.lastWeekPct >= L.weekLossHalvePct) { budgetScale = Math.min(budgetScale, 0.5); reasons.push(`last week ${(a.lastWeekPct * 100).toFixed(1)}%: budgets halved this week`); }
    if (o.paused && mode === 'normal') { mode = 'no-new'; reasons.push('paused'); }
    return { mode, budgetScale, provenOnly, dayLoss, dd, weekLoss, reasons };
  }

  /* intent: {coin, side, entry:{px}, stop}; size: {qty}; state: {
   *   equity, positions: [{coin, side, qty, px, stop, beta}], working: [same, for unfilled entries],
   *   beta(coin), book(coin) → {bids, asks, spreadBps, ts}, inst(coin) → {min, ct, lot}, tradable(coin) → bool, inWindow → bool, mode }
   */
  check(intent, size, s) {
    const L = this.L, reasons = [], eq = s.equity, px = intent.entry.px, dist = Math.abs(px - intent.stop);
    if (!size || !(size.qty > 0)) return { verdict: 'reject', qty: 0, reasons: ['no size'] };
    if (s.mode && s.mode !== 'normal') return { verdict: 'reject', qty: 0, reasons: [`risk mode ${s.mode}`] };
    if (s.tradable && !s.tradable(intent.coin)) return { verdict: 'reject', qty: 0, reasons: ['data guard: coin not tradable'] };
    if (s.inWindow) return { verdict: 'reject', qty: 0, reasons: ['news window'] };
    const caps = [];
    caps.push(['risk per trade', (L.maxTradeRiskPct * eq) / dist]);
    const legs = [...(s.positions || []), ...(s.working || [])];
    const openRisk = legs.reduce((a, p) => a + p.qty * Math.abs(p.px - p.stop), 0);
    caps.push(['total open risk', Math.max(0, L.maxOpenRiskPct * eq - openRisk) / dist]);
    const coinNotional = legs.filter((p) => p.coin === intent.coin).reduce((a, p) => a + p.qty * p.px, 0);
    caps.push(['coin notional', Math.max(0, L.maxCoinNotionalX * eq - coinNotional) / px]);
    const gross = legs.reduce((a, p) => a + p.qty * p.px, 0);
    caps.push(['gross notional', Math.max(0, L.maxGrossX * eq - gross) / px]);
    const beta = (c) => { const b = s.beta ? s.beta(c) : 1; return Number.isFinite(b) ? b : 1; };
    const btcNet = legs.reduce((a, p) => a + p.side * p.qty * p.px * beta(p.coin), 0), myBeta = beta(intent.coin);
    if (Math.sign(btcNet) === intent.side || btcNet === 0) caps.push(['net BTC exposure', Math.max(0, L.maxBtcBetaX * eq - Math.abs(btcNet)) / (px * Math.max(0.1, myBeta))]);
    const bk = s.book ? s.book(intent.coin) : null;
    if (bk) {
      if (bk.spreadBps > L.maxSpreadBps) return { verdict: 'reject', qty: 0, reasons: [`spread ${bk.spreadBps.toFixed(1)} bps > ${L.maxSpreadBps}`] };
      const levels = intent.side > 0 ? bk.asks : bk.bids, depth = levels.reduce((a, x) => a + x[1], 0);
      if (depth > 0) caps.push(['book depth', L.maxBookFrac * depth]); // at most 10% of the top-5 levels it would trade against
    }
    let qty = size.qty, binding = null;
    for (const [name, cap] of caps) if (cap < qty) { qty = cap; binding = name; }
    const inst = s.inst ? s.inst(intent.coin) : null;
    const minQty = Math.max(inst && inst.min && inst.ct ? inst.min * inst.ct : 0, L.minOrderUsd / px);
    if (!(qty >= minQty)) return { verdict: 'reject', qty: 0, reasons: [binding ? `${binding} leaves ${qty.toPrecision(3)} < exchange minimum ${minQty.toPrecision(3)}` : 'below exchange minimum'] };
    if (binding) reasons.push(`trimmed by ${binding}`);
    return { verdict: qty < size.qty * 0.999 ? 'trim' : 'approve', qty, reasons, openRiskPct: (openRisk + qty * dist) / eq };
  }
}

module.exports = { RiskEngine };
