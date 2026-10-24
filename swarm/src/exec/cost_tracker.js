/* Execution-cost tracker (upswarm GUIDE §7.5): the implementation shortfall of every fill (Perold, 1988) — what
 * turning a decision into a fill really cost, in basis points and in R — so live costs can be compared with the
 * backtest's cost model (maker 2, taker 6, slippage 1.5 bps) instead of assumed.
 *
 * Decision price: for an entry, the BloFin mid when the risk agent's order went out (the price the decision saw);
 * for an exit, the stop for a stop exit, the target for a target exit, and the mid at the fill for the rest (time,
 * flatten, a sleeve's rebalance). Shortfall = side × (fill − decision) ÷ decision: positive is a cost (a buy filled
 * above the decision price, a sell below it); a maker fill inside the spread is negative.
 *   costBps = shortfall + fee (both in bps of the fill's notional)   costR = costBps ÷ the stop distance in bps
 * Pure bookkeeping: hosted by the accountant (exec/accountant.js), which publishes each record as `exec.cost` and the
 * per-coin model (median costs of the last 200 fills each way) as kv 'execCost'. It never touches an order.
 */
'use strict';

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

class CostTracker {
  constructor(o = {}) { this.keep = o.keep || 200; this.ttlMs = o.ttlMs || 6 * 3600000; this.dec = new Map(); this.mid = new Map(); this.pos = new Map(); this.byCoin = {}; }
  onBook(b) {
    const mid = b.mid > 0 ? b.mid : b.bids && b.asks && b.bids[0] && b.asks[0] ? (b.bids[0][0] + b.asks[0][0]) / 2 : null;
    if (mid > 0) this.mid.set(b.coin, mid);
  }
  // an order from the risk agent: remember the price the decision saw
  onOrder(o, now) {
    if (!o || !o.id) return;
    const ref = this.mid.get(o.coin) || (o.entry && o.entry.px);
    this.dec.set(o.id, { t: now, coin: o.coin, side: o.side, decPx: ref, stop: o.stop, owner: o.owner || null, strategies: (o.strategies || []).map((s) => s.name || s), reduceOnly: !!o.reduceOnly });
    for (const [k, v] of this.dec) if (now - v.t > this.ttlMs) this.dec.delete(k);
  }
  // the trader's positions report: stops and targets the exits are judged against
  onPositions(open) {
    for (const p of open || []) { this.pos.set(p.orderId, { coin: p.coin, side: p.side, entry: p.entry, stop: p.stop, target: p.target, owner: p.owner || null, strategies: p.strategies || [] }); }
    // a closed position's last report stays until its exit fill is seen
  }
  // exec.fill → the cost record (or null when the fill cannot be judged)
  onFill(f) {
    if (!f || !(f.px > 0) || !(f.qty > 0)) return null;
    const notional = f.qty * f.px, feeBps = notional > 0 ? (f.feeUsd / notional) * 1e4 : 0;
    let decPx = null, riskBps = null, strategies = [], owner = null, basis;
    if (f.role === 'entry') {
      const d = this.dec.get(f.orderId);
      if (!d) return null;
      decPx = d.decPx; basis = 'mid at the order'; strategies = d.strategies; owner = d.owner;
      if (d.stop > 0) riskBps = (Math.abs(f.px - d.stop) / f.px) * 1e4;
      if (!d.reduceOnly) this.dec.delete(f.orderId);
    } else {
      const p = this.pos.get(f.orderId), d = this.dec.get(f.orderId);
      if (p) { strategies = p.strategies; owner = p.owner; if (p.entry > 0 && p.stop > 0) riskBps = (Math.abs(p.entry - p.stop) / p.entry) * 1e4; }
      else if (d) { strategies = d.strategies; owner = d.owner; }
      if (f.reason === 'stop' && p && p.stop > 0) { decPx = p.stop; basis = 'stop price'; }
      else if (f.reason === 'target' && p && p.target > 0) { decPx = p.target; basis = 'target price'; }
      else if (f.reason === 'rebalance' && d) { decPx = d.decPx; basis = 'mid at the order'; this.dec.delete(f.orderId); }
      else { decPx = this.mid.get(f.coin) || null; basis = 'mid at the fill'; }
      if (p && f.reason !== 'rebalance') this.pos.delete(f.orderId);
    }
    if (!(decPx > 0)) return null;
    const slipBps = f.side * ((f.px - decPx) / decPx) * 1e4, costBps = slipBps + feeBps;
    const rec = {
      orderId: f.orderId, coin: f.coin, side: f.side, role: f.role, reason: f.reason || null, kind: f.kind, decPx, px: f.px, basis,
      slipBps: +slipBps.toFixed(2), feeBps: +feeBps.toFixed(2), costBps: +costBps.toFixed(2), riskBps: riskBps != null ? +riskBps.toFixed(1) : null,
      costR: riskBps > 0 ? +(costBps / riskBps).toFixed(4) : null, strategies, owner: owner || undefined, ts: f.ts,
    };
    const c = (this.byCoin[f.coin] = this.byCoin[f.coin] || { entry: [], exit: [] }), list = c[f.role === 'entry' ? 'entry' : 'exit'];
    list.push(rec.costBps); if (list.length > this.keep) list.shift();
    return rec;
  }
  // per coin: median cost in bps of entries and exits, and how many fills it rests on
  model() {
    const out = {};
    for (const [coin, c] of Object.entries(this.byCoin)) out[coin] = { entryBps: median(c.entry), exitBps: median(c.exit), fills: c.entry.length + c.exit.length };
    return out;
  }
  dump() { return { byCoin: this.byCoin }; }
  load(x) { if (x && x.byCoin) this.byCoin = x.byCoin; }
}

module.exports = { CostTracker, median };
