/* Execution simulator for backtests and shadow trading: turns ideas into fills, exits and net results on
 * 1-minute bars, as conservatively as candles allow.
 *
 * Entries: maker limits fill only when a later bar trades THROUGH the price (by 0.5 bp), at the limit;
 *   when the wait runs out the idea is cancelled, or (fallback 'taker') filled at that bar's close with taker
 *   cost. Taker entries fill at the next bar's open. Nothing fills on the bar that produced the idea.
 * Exits: the stop is a stop-market order (taker fee + slippage; a gap through it fills at the bar's open);
 *   targets are resting maker limits (through by 0.5 bp); stop and target on the same bar → the stop wins;
 *   no target on the bar the entry filled; trailing stops move only after a bar closes; time stops exit at the
 *   close with taker cost. Funding is paid or received at 00:00/08:00/16:00 UTC from the rate history.
 * Costs in basis points: maker 2, taker 6 (BloFin standard tier), slippage 1.5 per taker side (half the spread
 * + impact); costMult scales fees and slippage for stress tests. Results keep the parts: grossBps, feeBps,
 * slipBps, fundBps → netBps; R = netBps ÷ (entry-to-stop distance in bps).
 */
'use strict';
const MIN = 60000;

class ExecSim {
  constructor(o = {}) {
    this.maker = o.makerBps == null ? 2 : o.makerBps; this.taker = o.takerBps == null ? 6 : o.takerBps;
    this.slip = o.slipBps == null ? 1.5 : o.slipBps; this.thru = o.thruBps == null ? 0.5 : o.thruBps;
    this.funding = o.funding || {}; // coin → [[t, rate], …] sorted
    this.onClose = o.onClose || (() => {}); this.onFill = o.onFill || (() => {});
    this.pending = new Map(); this.open = new Map(); this.trades = []; this.unfilled = 0;
  }
  submit(idea) { this.pending.set(idea.id, { idea, until: idea.t + Math.max(1, idea.entry.waitMin || 1) * MIN }); }
  hasCoin(coin) { for (const p of this.pending.values()) if (p.idea.coin === coin) return true; for (const p of this.open.values()) if (p.idea.coin === coin) return true; return false; }

  // feed every 1-minute bar (t = open time) in time order, BEFORE the strategies see it
  onBar(coin, bar) {
    for (const [id, p] of this.pending) {
      const i = p.idea;
      if (i.coin !== coin || bar.t < i.t) continue;
      const side = i.side;
      if (i.entry.kind === 'taker') { this.pending.delete(id); this.fill(i, bar.o, 'taker', bar); continue; }
      // chase: the order sits at the best price, re-posted at each bar's close (the price at the last decision)
      const L = i.entry.chase ? (p.chasePx || i.entry.px) : i.entry.px;
      const through = side > 0 ? bar.l <= L * (1 - this.thru / 1e4) : bar.h >= L * (1 + this.thru / 1e4);
      if (through) { this.pending.delete(id); this.fill(i, side > 0 ? Math.min(L, bar.o) : Math.max(L, bar.o), 'maker', bar); continue; }
      if (i.entry.chase) p.chasePx = bar.c;
      if (bar.t + MIN >= p.until) {
        this.pending.delete(id);
        if (i.entry.fallback === 'taker') this.fill(i, bar.c, 'taker', bar, true);
        else { this.unfilled++; this.onClose(i, { idea: i, outcome: 'unfilled', r: 0, netBps: 0, exitT: bar.t + MIN }); }
      }
    }
    for (const [id, pos] of this.open) if (pos.idea.coin === coin) this.manage(id, pos, bar);
  }

  fill(i, px, kind, bar, atClose) {
    const R = Math.abs(px - i.stop) / px;
    if (!(R > 0) || i.side * (px - i.stop) <= 0) { this.unfilled++; this.onClose(i, { idea: i, outcome: 'stop-crossed-before-fill', r: 0, netBps: 0, exitT: bar.t + MIN }); return; }
    const pos = { idea: i, entry: px, entryKind: kind, entryT: atClose ? bar.t + MIN : bar.t, fillBarT: bar.t, stop: i.stop, best: px, R, fundBps: 0, fundT: atClose ? bar.t + MIN : bar.t };
    this.open.set(i.id, pos);
    this.onFill(i, pos);
    if (!atClose) this.manage(i.id, pos, bar, true);
  }

  manage(id, pos, bar, fillBar) {
    const i = pos.idea, s = i.side;
    // funding settlements inside this bar (whatever the coin's interval: 8h, 4h or 1h)
    const end = bar.t + MIN;
    if (end > pos.fundT) { for (const [ft, rate] of this.settlements(i.coin, pos.fundT, end)) pos.fundBps += s * rate * 1e4; pos.fundT = end; }
    const stopHit = s > 0 ? bar.l <= pos.stop : bar.h >= pos.stop;
    if (stopHit) return this.close(id, pos, s > 0 ? Math.min(pos.stop, fillBar ? pos.stop : bar.o) : Math.max(pos.stop, fillBar ? pos.stop : bar.o), 'taker', 'stop', bar.t + MIN);
    if (!fillBar && i.target != null && (s > 0 ? bar.h >= i.target * (1 + this.thru / 1e4) : bar.l <= i.target * (1 - this.thru / 1e4))) return this.close(id, pos, i.target, 'maker', 'target', bar.t + MIN);
    if (bar.t + MIN >= pos.entryT + i.timeStopMin * MIN) return this.close(id, pos, bar.c, 'taker', 'time', bar.t + MIN);
    // trailing stop, moved after the bar closes
    if (s > 0 ? bar.c > pos.best : bar.c < pos.best) pos.best = bar.c;
    if (i.trail && s * (pos.best - pos.entry) >= i.trail.afterR * pos.R * pos.entry) {
      const ns = pos.best - s * i.trail.dist;
      if (s * (ns - pos.stop) > 0) pos.stop = ns;
    }
  }
  // funding records with from < t ≤ to
  settlements(coin, from, to) {
    const a = this.funding[coin]; if (!a || !a.length) return [];
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m][0] <= from) lo = m + 1; else hi = m; }
    const out = []; for (let k = lo; k < a.length && a[k][0] <= to; k++) out.push(a[k]);
    return out;
  }
  close(id, pos, px, kind, reason, t) {
    this.open.delete(id);
    const i = pos.idea, s = i.side;
    const grossBps = s * (px / pos.entry - 1) * 1e4;
    const feeBps = (pos.entryKind === 'maker' ? this.maker : this.taker) + (kind === 'maker' ? this.maker : this.taker);
    const slipBps = (pos.entryKind === 'taker' ? this.slip : 0) + (kind === 'taker' ? this.slip : 0);
    const netBps = grossBps - feeBps - slipBps - pos.fundBps, rBps = pos.R * 1e4;
    const tr = { id, strategy: i.strategy, coin: i.coin, tf: i.tf, side: s, t: i.t, entryT: pos.entryT, exitT: t, entry: pos.entry, exit: px, entryKind: pos.entryKind, exitKind: kind, reason, riskBps: +rBps.toFixed(2), grossBps: +grossBps.toFixed(2), feeBps, slipBps, fundBps: +pos.fundBps.toFixed(2), netBps: +netBps.toFixed(2), r: +(netBps / rBps).toFixed(4), why: i.why };
    this.trades.push(tr);
    this.onClose(i, { idea: i, outcome: reason, r: tr.r, netBps: tr.netBps, exitT: t, trade: tr });
  }
}

module.exports = { ExecSim };
