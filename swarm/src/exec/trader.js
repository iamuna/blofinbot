/* Trader: the execution agent and the trade manager, with a paper broker (the BloFin demo broker plugs in on
 * day 5 behind the same messages).
 *
 * Accepts `order` and `stop.move` messages only from the risk agent. Positions are keyed by owner: idea trades by
 * coin (one position or working order per coin), a sleeve's by `<owner>:<coin>` (e.g. sleeve:trend:ETH), so the two
 * can hold the same coin on paper. A sleeve order may grow its position (average entry, fees added) or, reduceOnly,
 * shrink or close it; each reduction books its share of the position as a trade.closed. Sleeve positions have no
 * target, time stop, trail or break-even: only their stop, which stop.move can tighten (never loosen, never past the price).
 * Entries: maker orders sit at the best bid (buy) / ask (sell); `chase` orders follow the best price, others rest
 *   at their limit. Paper fills need a BloFin trade print THROUGH the price (a buy at 100 fills when someone sells
 *   below 100). When the wait ends: taker fill if the idea allowed it, else cancelled. Taker entries fill at the
 *   opposite best price plus slippage.
 * Trade manager: stop (stop-market: taker at the opposite best price minus slippage), target (resting maker),
 *   trailing stop after +afterR, break-even after +1R when there is no trail, time stop, funding at each settlement.
 * Commands: flatten (cancel and close everything at market), pause (cancel working orders, accept none).
 * Publishes exec.fill, positions (on change and every 10 s, also kv 'positions'), trade.closed, order.end.
 * State survives restarts (<dataDir>/state/trader.json, written after every change).
 */
'use strict';
const path = require('path');
const { Agent } = require('../core/agent');
const { readJSON, writeAtomic } = require('../core/fsx');

const keyOf = (x) => (x.owner ? `${x.owner}:${x.coin}` : x.coin);

class Trader extends Agent {
  static agentName = 'trader';
  async onStart() {
    this.X = Object.assign({ account: 'paper', makerBps: 2, takerBps: 6, slipBps: 1.5, breakevenR: 1.0, staleBookMs: 10000 }, this.cfg.trading || {});
    this.file = path.join(this.ctx.dataDir, 'state', 'trader.json');
    this.S = readJSON(this.file, { orders: {}, positions: {}, paused: false });
    this.books = new Map(); this.last = new Map(); this.funding = new Map(); this.dirty = true;
    this.subscribe('order', (m) => (m.src === 'risk' ? this.onOrder(m.data) : this.warn(`order ${m.data.id} from ${m.src} ignored: only the risk agent sends orders`)), { durable: true });
    this.subscribe('stop.move', (m) => (m.src === 'risk' ? this.onStopMove(m.data) : this.warn(`stop.move ${m.data.coin} from ${m.src} ignored: only the risk agent moves stops`)), { durable: true });
    this.subscribe('md.book', (m) => this.onBook(m.data));
    this.subscribe('md.trade', (m) => this.onTrades(m.data));
    this.subscribe('md.ticker', (m) => this.onTicker(m.data));
    this.subscribe('md.funding', (m) => this.onFunding(m.data));
    this.subscribe('sys.command', (m) => this.onCommand(m.data, m.src));
    this.every(1000, () => this.tick());
    this.every(10000, () => { this.dirty = true; });
    await this.publishPositions(true);
  }
  save() { writeAtomic(this.file, JSON.stringify(this.S)); }
  busy(o) { const k = keyOf(o); return !!this.S.positions[k] || Object.values(this.S.orders).some((w) => keyOf(w) === k); }
  bp(x) { return x / 1e4; }

  async onOrder(o) {
    if (this.S.paused) return this.endOrder(o, 'paused');
    if (this.busy(o)) {
      // a sleeve may grow (same side) or reduce (reduceOnly, the other side) the position it holds, one order at a time
      const p = this.S.positions[keyOf(o)], working = Object.values(this.S.orders).some((w) => keyOf(w) === keyOf(o));
      if (!o.owner || working || !p) return this.endOrder(o, 'coin busy');
      if (!o.reduceOnly && o.side !== p.side) return this.endOrder(o, 'the opposite position is open: it closes first');
    }
    if (o.reduceOnly && !(this.S.positions[keyOf(o)] && this.S.positions[keyOf(o)].side === -o.side)) return this.endOrder(o, 'nothing to reduce');
    const w = Object.assign({}, o, { status: 'working', t0: this.now(), until: this.now() + Math.max(1, o.entry.waitMin || 1) * 60000, posted: null });
    this.S.orders[o.id] = w; this.save(); this.dirty = true;
    this.count('orders');
    if (o.entry.kind === 'taker') await this.tryTaker(w);
    else this.repost(w);
  }
  async endOrder(o, outcome) {
    delete this.S.orders[o.id]; this.save(); this.dirty = true;
    await this.publish('order.end', { id: o.id, coin: o.coin, outcome, strategies: o.strategies }, { trace: o.strategies && o.strategies[0] && o.strategies[0].ideaId });
  }
  onStopMove(m) {
    const p = this.S.positions[keyOf(m)], last = p && this.last.get(p.coin);
    if (!p) { this.count('stopMoveNoPosition'); return; }
    if (!(p.side * (m.stop - p.stop) > 0)) { this.count('stopMoveRefused'); this.warn(`${keyOf(m)}: stop ${p.stop} → ${m.stop} refused: a stop only moves toward the price`); return; }
    if (last > 0 && !(p.side * (last - m.stop) > 0)) { this.count('stopMoveRefused'); this.warn(`${keyOf(m)}: stop ${m.stop} refused: it is past the price ${last}`); return; }
    p.stop = m.stop; this.save(); this.dirty = true; this.count('stopMoves');
  }
  bestFor(coin, side) { // the price a buy (side +1) would rest at, and the price it would pay as a taker
    const b = this.books.get(coin);
    if (!b || this.now() - b.seenAt > this.X.staleBookMs) return null;
    return { bid: b.bids[0][0], ask: b.asks[0][0] };
  }
  repost(w) {
    const q = this.bestFor(w.coin); if (!q) return;
    const best = w.side > 0 ? q.bid : q.ask;
    w.posted = w.entry.chase ? best : w.side > 0 ? Math.min(w.entry.px, best) : Math.max(w.entry.px, best);
  }
  async tryTaker(w) {
    const q = this.bestFor(w.coin); if (!q) return false;
    const px = (w.side > 0 ? q.ask : q.bid) * (1 + w.side * this.bp(this.X.slipBps));
    await this.fill(w, px, 'taker');
    return true;
  }

  onBook(b) {
    this.books.set(b.coin, Object.assign({ seenAt: this.now() }, b));
    for (const w of Object.values(this.S.orders)) if (w.coin === b.coin && w.entry.kind !== 'taker' && (w.entry.chase || w.posted == null)) this.repost(w);
    for (const w of Object.values(this.S.orders)) if (w.coin === b.coin && w.entry.kind === 'taker') this.tryTaker(w).catch((e) => this.error('taker', e));
  }
  onTicker(t) { this.last.set(t.coin, t.last); }
  async onTrades(d) {
    for (const [ts, px] of d.trades) {
      this.last.set(d.coin, px);
      for (const w of Object.values(this.S.orders)) {
        if (w.coin !== d.coin || w.posted == null || w.entry.kind === 'taker' || ts < w.t0) continue;
        if (w.side > 0 ? px < w.posted : px > w.posted) await this.fill(w, w.posted, 'maker');
      }
      for (const p of Object.values(this.S.positions)) if (p.coin === d.coin) await this.manage(p, px, ts);
    }
  }

  async fill(w, px, kind) {
    if (!this.S.orders[w.id]) return;
    delete this.S.orders[w.id];
    if (w.reduceOnly) return this.reduce(w, px, kind);
    const R = Math.abs(px - w.stop);
    if (!(R > 0) || w.side * (px - w.stop) <= 0) return this.endOrder(w, 'price passed the stop before the fill');
    const fee = w.qty * px * this.bp(kind === 'maker' ? this.X.makerBps : this.X.takerBps), k = keyOf(w), had = this.S.positions[k];
    if (had) {
      // a sleeve grows its position: average entry, fees add up, the whole position takes the new stop (as the backtest)
      const q = had.qty + w.qty;
      had.entry = (had.qty * had.entry + w.qty * px) / q; had.qty = q; had.feeUsd += fee; had.stop = w.stop;
      had.R = Math.abs(had.entry - had.stop); had.riskUsd = q * Math.max(had.R, had.entry * 0.001); had.best = px;
    } else {
      this.S.positions[k] = { orderId: w.id, owner: w.owner || null, coin: w.coin, side: w.side, qty: w.qty, entry: px, entryKind: kind, entryT: this.now(), stop: w.stop, initStop: w.stop, target: w.target, trail: w.trail, timeStopMin: w.timeStopMin, best: px, R, feeUsd: fee, fundUsd: 0, strategies: w.strategies, why: w.why, riskUsd: w.qty * Math.max(R, px * 0.001) }; // R against at least 10 bps (a fill right at the stop)
    }
    this.save(); this.dirty = true;
    this.count(had ? 'adds' : 'entries');
    await this.publish('exec.fill', { orderId: w.id, coin: w.coin, side: w.side, qty: w.qty, px, feeUsd: fee, kind, role: 'entry', ts: this.now() }, { trace: w.strategies[0] && w.strategies[0].ideaId });
  }
  // a reduce-only leg: closes up to what is held, at the fill price
  async reduce(w, px, kind) {
    const p = this.S.positions[keyOf(w)];
    if (!p || p.side !== -w.side) return this.endOrder(w, 'nothing to reduce');
    await this.book(p, Math.min(w.qty, p.qty), px, kind, 'rebalance', w.id);
  }

  async manage(p, px, ts) {
    const s = p.side;
    if (s > 0 ? px <= p.stop : px >= p.stop) return this.exitPosition(p, 'stop', 'taker');
    if (p.owner) return; // a sleeve's position: only its stop (moved by the risk agent)
    if (p.target != null && (s > 0 ? px > p.target : px < p.target)) return this.exitPosition(p, 'target', 'maker', p.target);
    if (s * (px - p.best) > 0) p.best = px;
    const fav = s * (p.best - p.entry);
    if (p.trail && fav >= p.trail.afterR * p.R) { const ns = p.best - s * p.trail.dist; if (s * (ns - p.stop) > 0) { p.stop = ns; this.dirty = true; } }
    else if (!p.trail && this.X.breakevenR && fav >= this.X.breakevenR * p.R) {
      const be = p.entry * (1 + s * this.bp(this.X.makerBps + this.X.takerBps));
      if (s * (be - p.stop) > 0) { p.stop = be; this.dirty = true; }
    }
  }
  async exitPosition(p, reason, kind, atPx) {
    if (this.S.positions[keyOf(p)] !== p) return;
    let px = atPx;
    if (px == null) {
      const q = this.bestFor(p.coin), last = this.last.get(p.coin);
      const ref = q ? (p.side > 0 ? q.bid : q.ask) : last;
      if (!(ref > 0)) return; // no price: try again on the next tick
      px = ref * (1 - p.side * this.bp(this.X.slipBps));
      if (reason === 'stop') px = p.side > 0 ? Math.min(px, p.stop) : Math.max(px, p.stop);
    }
    await this.book(p, p.qty, px, kind, reason);
  }
  // closes qty of a position at px: its share of the entry fees, funding and risk goes with it
  async book(p, qty, px, kind, reason, orderId) {
    const all = qty >= p.qty * (1 - 1e-9), f = all ? 1 : qty / p.qty;
    const fee = qty * px * this.bp(kind === 'maker' ? this.X.makerBps : this.X.takerBps);
    const entryFee = p.feeUsd * f, fundUsd = p.fundUsd * f, riskUsd = p.riskUsd * f;
    if (all) delete this.S.positions[keyOf(p)];
    else { p.qty -= qty; p.feeUsd -= entryFee; p.fundUsd -= fundUsd; p.riskUsd -= riskUsd; }
    const grossUsd = p.side * (px - p.entry) * qty, feeUsd = entryFee + fee, netUsd = grossUsd - feeUsd - fundUsd;
    this.save(); this.dirty = true; this.count(`exit_${reason}`);
    await this.publish('exec.fill', { orderId: orderId || p.orderId, coin: p.coin, side: -p.side, qty, px, feeUsd: fee, kind, role: 'exit', reason, ts: this.now() });
    await this.publish('trade.closed', {
      orderId: p.orderId, coin: p.coin, side: p.side, qty, entry: p.entry, exit: px, entryT: p.entryT, exitT: this.now(), entryKind: p.entryKind, exitKind: kind,
      grossUsd, feeUsd, fundUsd, netUsd, riskUsd, r: netUsd / riskUsd, reason, strategies: p.strategies, account: this.X.account, owner: p.owner || undefined, partial: all ? undefined : true,
    }, { trace: p.strategies[0] && p.strategies[0].ideaId });
  }

  onFunding(f) {
    const prev = this.funding.get(f.coin);
    this.funding.set(f.coin, f);
    if (prev && f.nextTs > prev.nextTs && this.now() >= prev.nextTs) { // the previous settlement happened
      const px = this.last.get(f.coin);
      for (const p of Object.values(this.S.positions)) if (p.coin === f.coin && px > 0 && p.entryT < prev.nextTs) { p.fundUsd += p.side * p.qty * px * prev.rate; this.save(); }
    }
  }

  async tick() {
    const now = this.now();
    for (const w of Object.values(this.S.orders)) {
      if (now < w.until) continue;
      if (w.entry.kind === 'taker' || w.entry.fallback === 'taker') { if (!(await this.tryTaker(w)) && now - w.until > 60000) await this.endOrder(w, 'no price'); }
      else await this.endOrder(w, 'unfilled');
    }
    for (const p of Object.values(this.S.positions)) if (p.timeStopMin > 0 && now >= p.entryT + p.timeStopMin * 60000) await this.exitPosition(p, 'time', 'taker');
    if (this.dirty) await this.publishPositions();
  }
  async publishPositions() {
    this.dirty = false;
    const open = Object.values(this.S.positions).map((p) => Object.assign({ coin: p.coin, side: p.side, qty: p.qty, px: p.entry, entry: p.entry, stop: p.stop, target: p.target, entryT: p.entryT, last: this.last.get(p.coin) || p.entry, strategies: p.strategies.map((s) => s.name), orderId: p.orderId }, p.owner ? { owner: p.owner } : {}));
    const working = Object.values(this.S.orders).map((w) => Object.assign({ coin: w.coin, side: w.side, qty: w.qty, px: w.posted || w.entry.px, stop: w.stop, until: w.until, orderId: w.id }, w.owner ? { owner: w.owner } : {}, w.reduceOnly ? { reduceOnly: true } : {}));
    const msg = { ts: this.now(), open, working, paused: !!this.S.paused, account: this.X.account };
    await this.bus.kv.set('positions', msg);
    await this.publish('positions', msg);
  }
  async onCommand(c, src) {
    if (c.cmd === 'flatten') {
      this.warn(`flatten by ${src}/${c.by}: ${c.why || ''}`);
      for (const w of Object.values(this.S.orders)) await this.endOrder(w, 'flatten');
      for (const p of Object.values(this.S.positions)) await this.exitPosition(p, 'flatten', 'taker');
    } else if (c.cmd === 'pause') { this.S.paused = true; for (const w of Object.values(this.S.orders)) await this.endOrder(w, 'paused'); this.save(); }
    else if (c.cmd === 'resume' && src === 'herald' && c.by === 'ibrahim') { this.S.paused = false; this.save(); }
    this.dirty = true;
  }
}

module.exports = { Trader };
