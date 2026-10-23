/* Demo trader: the execution agent and trade manager on a BloFin DEMO account — same messages as the paper trader.
 *
 * Entries: post-only at the best bid/ask (re-posted when the market moves away, at most every 3 s); taker entries
 *   and 'taker' fallbacks use market orders. Every order is an intent written to disk (state + journal) BEFORE it is
 *   sent; a send that fails without a clear answer is UNKNOWN and is looked up by its clientOrderId before anything
 *   new happens on that coin (no blind retries).
 * The moment an entry fills, the stop goes onto BloFin as an exchange-side stop-loss (order-tpsl, market on
 *   trigger, reduce-only) and the target as a reduce-only post-only limit — a crashed bot or a dead internet line
 *   leaves no position unprotected. Trailing / break-even moves replace the stop (new one first, then the old one
 *   is cancelled). Time stops and flatten cancel both and close with a reduce-only market order.
 * Every 2 s it reads BloFin (orders, positions; stops and balance every 10 s): BloFin is the truth. A position that
 *   disappeared was closed by its stop or target — the fills are read from order history. A position without its
 *   stop gets one again at once. Positions the swarm does not know about are reported and left alone.
 * Sleeves: BloFin nets one position per instrument (one-way mode), so a coin has ONE owner: an idea trade or a sleeve
 *   (the coordinator keeps them apart; an order for a coin another owner holds ends 'coin busy'). A sleeve order may
 *   grow its position (average entry; the stop is replaced for the new size) or, reduceOnly, shrink or close it (each
 *   reduction is booked as a trade.closed). Sleeve positions keep only their stop; stop.move tightens it.
 * Keys: BLOFIN_API_KEY / BLOFIN_API_SECRET / BLOFIN_PASSPHRASE (read + trade only; a key that can transfer or
 * withdraw is refused). Demo host only — the client cannot reach live in this build. Refuses GitHub Actions.
 */
'use strict';
const path = require('path'), fs = require('fs');
const { Agent } = require('../core/agent');
const { readJSON, writeAtomic } = require('../core/fsx');
const { createClient, keyProblem } = require('./blofin/client');
const Q = require('./blofin/quant');

const isUnknown = (e) => e && (e.kind === 'network' || e.kind === 'parse' || (e.kind === 'http' && e.status >= 500));
const LIVE = new Set(['live', 'partially_filled']);

class DemoTrader extends Agent {
  static agentName = 'trader';
  async onStart() {
    this.X = Object.assign({ account: 'demo', leverage: 5, chaseEveryMs: 3000, staleBookMs: 5000, breakevenR: 1.0, stopMoveR: 0.1, stopMoveEveryMs: 20000, makerBps: 2, takerBps: 6 }, this.cfg.trading || {});
    if (process.env.GITHUB_ACTIONS && !this.ctx.fetchImpl) throw new Error('demo trading never runs on GitHub Actions: keys stay on the home PC');
    const key = this.ctx.apiKey || process.env.BLOFIN_API_KEY, secret = this.ctx.apiSecret || process.env.BLOFIN_API_SECRET, pass = this.ctx.passphrase || process.env.BLOFIN_PASSPHRASE;
    this.client = createClient({ mode: 'demo', apiKey: key, secret, passphrase: pass, fetchImpl: this.ctx.fetchImpl, sleep: this.ctx.sleep, nowMs: this.ctx.nowMs });
    this.file = path.join(this.ctx.dataDir, 'state', 'trader-demo.json');
    this.journal = path.join(this.ctx.dataDir, 'state', 'trader-demo-journal.jsonl');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.S = readJSON(this.file, { epoch: this.now(), seq: 0, entries: {}, positions: {}, paused: false, levSet: {} });
    for (const e of Object.values(this.S.entries)) for (const a of e.attempts) if (a.state === 'SUBMITTING') a.state = 'UNKNOWN'; // died mid-send
    for (const p of Object.values(this.S.positions)) for (const k of ['sl', 'tp', 'closing']) if (p[k] && p[k].state === 'SUBMITTING') p[k].state = 'UNKNOWN';
    this.books = new Map(); this.last = new Map(); this.inst = {}; this.snap = null; this.ready = false; this.dirty = true; this.busy = false; this.lastSlow = 0;
    this.subscribe('order', (m) => (m.src === 'risk' ? this.onOrder(m.data) : this.warn(`order ${m.data.id} from ${m.src} ignored`)), { durable: true });
    this.subscribe('stop.move', (m) => (m.src === 'risk' ? this.onStopMove(m.data).catch((e) => this.error('stop.move', e)) : this.warn(`stop.move ${m.data.coin} from ${m.src} ignored`)), { durable: true });
    this.subscribe('md.book', (m) => this.books.set(m.data.coin, Object.assign({ seenAt: this.now() }, m.data)));
    this.subscribe('md.trade', (m) => { const t = m.data.trades; if (t.length) this.last.set(m.data.coin, t[t.length - 1][1]); });
    this.subscribe('sys.command', (m) => this.onCommand(m.data, m.src));
    this.every(this.ctx.tickMs || 2000, () => this.loop());
  }
  save() { writeAtomic(this.file, JSON.stringify(this.S)); }
  jot(ev) { fs.appendFileSync(this.journal, JSON.stringify(Object.assign({ t: this.now() }, ev)) + '\n'); }
  cid() { this.S.seq++; return ('sw' + this.S.epoch.toString(36) + this.S.seq.toString(36)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32); }

  // ───────── set-up: instruments, key permissions, one-way mode, cross margin
  async init() {
    for (const r of await this.client.instruments()) this.inst[r.instId] = Q.parseInstrument(r);
    const why = keyProblem(await this.client.apiKeyInfo());
    if (why) throw new Error(why);
    await this.refresh(true);
    const pm = await this.client.positionMode(), mode = (Array.isArray(pm) ? pm[0] : pm || {}).positionMode;
    const flat = !Object.keys(this.snap.pos).length;
    if (mode !== 'net_mode') { if (!flat) throw new Error(`account in ${mode} with positions; one-way mode needed`); await this.client.setPositionMode('net_mode'); }
    const mm = await this.client.marginMode(), mmode = (Array.isArray(mm) ? mm[0] : mm || {}).marginMode;
    if (mmode && mmode !== 'cross') { if (!flat) throw new Error(`margin mode ${mmode} with positions; cross needed`); await this.client.setMarginMode('cross'); }
    this.ready = true; this.setStatus('ok');
    this.log.info(`demo account ready: equity ${this.snap.equity} USDT, ${Object.keys(this.snap.pos).length} positions`);
  }
  async refresh(slow) {
    const pos = await this.client.positions(), pending = await this.client.pendingOrders();
    const P = {};
    for (const p of pos || []) { const c = +p.positions; if (c) P[p.instId] = { contracts: p.positionSide === 'short' ? -Math.abs(c) : c, avg: +p.averagePrice }; }
    const ord = {}; for (const o of pending || []) ord[o.orderId] = o;
    const s = Object.assign(this.snap || {}, { t: this.now(), pos: P, pending: ord });
    if (slow || this.now() - this.lastSlow > 10000) {
      const b = await this.client.balance(), bb = Array.isArray(b) ? b[0] : b;
      s.equity = +bb.totalEquity;
      s.tpsl = {}; for (const x of (await this.client.pendingTpsl()) || []) s.tpsl[x.tpslId] = x;
      this.lastSlow = this.now();
    }
    this.snap = s;
  }

  // ───────── orders from the risk agent
  async onOrder(o) {
    if (this.S.paused) return this.endOrder(o, 'paused');
    const held = this.S.positions[o.coin], working = Object.values(this.S.entries).some((e) => e.o.coin === o.coin);
    // a sleeve may grow (same side) or reduce (reduceOnly) its own position, one order at a time
    const resize = !!(o.owner && held && held.owner === o.owner && !working && (o.reduceOnly ? held.side === -o.side : held.side === o.side));
    if (this.coinBusy(o.coin) && !resize) return this.endOrder(o, 'coin busy');
    if (o.reduceOnly && !resize) return this.endOrder(o, 'nothing to reduce');
    const inst = this.inst[o.instId];
    if (this.ready && !inst) return this.endOrder(o, 'not tradable on BloFin demo');
    const contracts = inst ? Math.abs(Q.toContracts(o.qty, inst)) : null;
    if (inst && !(contracts >= inst.minSize)) return this.endOrder(o, 'below the exchange minimum after rounding');
    this.S.entries[o.id] = { o, contracts, attempts: [], filled: 0, cost: 0, fee: 0, until: this.now() + Math.max(1, o.entry.waitMin || 1) * 60000, createdAt: this.now() };
    this.jot({ ev: 'order', id: o.id, coin: o.coin, side: o.side, contracts });
    this.save(); this.dirty = true;
  }
  coinBusy(coin) { return !!this.S.positions[coin] || Object.values(this.S.entries).some((e) => e.o.coin === coin); }
  async endOrder(o, outcome) {
    delete this.S.entries[o.id]; this.save(); this.dirty = true;
    this.jot({ ev: 'order.end', id: o.id, outcome });
    await this.publish('order.end', { id: o.id, coin: o.coin, outcome, strategies: o.strategies });
  }

  // ───────── the loop
  async loop() {
    if (this.busy) return; this.busy = true;
    try {
      if (!this.ready) { try { await this.init(); } catch (e) { this.setStatus('degraded', `demo account not ready: ${e.message}`); return; } }
      try { await this.refresh(false); } catch (e) { this.count('refreshErrors'); this.setStatus('degraded', `cannot read BloFin: ${e.message}`); return; }
      this.setStatus('ok');
      for (const id of Object.keys(this.S.entries)) { try { await this.workEntry(this.S.entries[id]); } catch (e) { this.error(`entry ${id}`, e); } }
      for (const coin of Object.keys(this.S.positions)) { try { await this.workPosition(this.S.positions[coin]); } catch (e) { this.error(`position ${coin}`, e); } }
      this.orphans();
      if (this.dirty) await this.publishPositions();
    } finally { this.busy = false; }
  }
  fresh(coin) { const b = this.books.get(coin); return b && this.now() - b.seenAt < this.X.staleBookMs ? b : null; }

  // send one order; returns the attempt (state LIVE | DONE | REJECTED | UNKNOWN)
  async send(entryOrPos, body, kind) {
    const a = { cid: this.cid(), kind, px: body.price ? +body.price : null, size: +body.size, state: 'SUBMITTING', filled: 0, avgPx: 0, fee: 0, at: this.now() };
    (entryOrPos.attempts || (entryOrPos.attempts = [])).push(a);
    this.jot({ ev: 'submit', cid: a.cid, body }); this.save();
    try {
      const r = await this.client.placeOrder(Object.assign({}, body, { clientOrderId: a.cid }));
      const x = Array.isArray(r) ? r[0] : r;
      if (!x || (x.code != null && String(x.code) !== '0') || !x.orderId) { a.state = 'REJECTED'; a.why = (x && x.msg) || 'rejected'; }
      else { a.state = 'LIVE'; a.exId = String(x.orderId); }
    } catch (e) {
      if (isUnknown(e)) { a.state = 'UNKNOWN'; a.why = e.message; } else { a.state = 'REJECTED'; a.why = e.message; }
    }
    this.jot({ ev: 'submitted', cid: a.cid, state: a.state, exId: a.exId || null, why: a.why || '' }); this.save();
    return a;
  }
  // look an attempt up on BloFin (by order id, or by client id when the send was uncertain)
  async settle(e, a) {
    const inst = this.inst[e.o.instId];
    let d = null;
    try { const r = await this.client.orderDetail(e.o.instId, a.exId ? { orderId: a.exId } : { clientOrderId: a.cid }); d = Array.isArray(r) ? r[0] : r; }
    catch (err) { if (isUnknown(err)) return; d = null; }
    if (!d) { if (a.state === 'UNKNOWN' && this.now() - a.at > 120000) { a.state = 'DONE'; a.why = 'never reached BloFin'; } return; }
    a.exId = String(d.orderId);
    const filled = +d.filledSize || 0, avg = +d.averagePrice || 0;
    a.filled = filled; a.avgPx = avg; a.fee = Math.abs(+d.fee || 0);
    a.state = LIVE.has(String(d.state)) ? 'LIVE' : 'DONE';
    if (inst) this.jot({ ev: 'settle', cid: a.cid, state: d.state, filled });
  }

  async workEntry(e) {
    const o = e.o, inst = this.inst[o.instId], side = o.side > 0 ? 'buy' : 'sell', ro = o.reduceOnly ? { reduceOnly: 'true' } : {};
    if (!inst) return this.endOrder(o, 'not tradable on BloFin demo');
    if (e.contracts == null) { e.contracts = Math.abs(Q.toContracts(o.qty, inst)); if (!(e.contracts >= inst.minSize)) return this.endOrder(o, 'below the exchange minimum after rounding'); }
    for (const a of e.attempts) if (a.state === 'UNKNOWN' || (a.state === 'LIVE' && !this.snap.pending[a.exId])) await this.settle(e, a);
    if (e.attempts.some((a) => a.state === 'UNKNOWN')) return; // nothing new until the uncertain one is found
    e.filled = e.attempts.reduce((s, a) => s + a.filled, 0);
    e.cost = e.attempts.reduce((s, a) => s + a.filled * a.avgPx, 0); e.fee = e.attempts.reduce((s, a) => s + a.fee, 0);
    const live = e.attempts.find((a) => a.state === 'LIVE');
    const remaining = +(e.contracts - e.filled).toFixed(8);
    const done = remaining < inst.minSize - 1e-12 || remaining < inst.lotSize / 2;
    const expired = this.now() >= e.until;
    if (live && (done || expired || this.S.paused)) { await this.cancel(e, live); return; }
    if (live) {
      const b = this.fresh(o.coin);
      if (o.entry.chase !== false && live.kind === 'post_only' && b && this.now() - live.at > this.X.chaseEveryMs && (side === 'buy' ? b.bids[0][0] > live.px + inst.tickSize / 2 : b.asks[0][0] < live.px - inst.tickSize / 2)) await this.cancel(e, live);
      return;
    }
    if (done) return this.openPosition(e);
    if (expired || this.S.paused) {
      if (!this.S.paused && (o.entry.kind === 'taker' || o.entry.fallback === 'taker') && !e.attempts.some((a) => a.kind === 'market')) {
        const size = Q.sizeString(remaining, inst, true);
        if (size) { await this.send(e, { instId: o.instId, marginMode: 'cross', positionSide: 'net', side, orderType: 'market', size, ...ro }, 'market'); return; }
      }
      return e.filled > 0 ? this.openPosition(e) : this.endOrder(o, this.S.paused ? 'paused' : 'unfilled');
    }
    if (o.entry.kind === 'taker') { const size = Q.sizeString(remaining, inst, true); if (size) await this.send(e, { instId: o.instId, marginMode: 'cross', positionSide: 'net', side, orderType: 'market', size, ...ro }, 'market'); return; }
    const b = this.fresh(o.coin); if (!b) return; // no fresh prices: wait
    const best = side === 'buy' ? b.bids[0][0] : b.asks[0][0];
    const limit = o.entry.chase === false ? (side === 'buy' ? Math.min(o.entry.px, best) : Math.max(o.entry.px, best)) : best;
    const size = Q.sizeString(remaining, inst, false); if (!size) return this.openPosition(e);
    await this.setLeverage(o.instId);
    const a = await this.send(e, { instId: o.instId, marginMode: 'cross', positionSide: 'net', side, orderType: 'post_only', price: Q.passivePrice(limit, side, inst), size, ...ro }, 'post_only');
    if (a.state === 'REJECTED') this.count('postOnlyRejected');
  }
  async setLeverage(instId) {
    if (this.S.levSet[instId] === this.X.leverage) return;
    try { await this.client.setLeverage(instId, this.X.leverage, 'cross'); this.S.levSet[instId] = this.X.leverage; } catch (e) { this.count('leverageErrors'); }
  }
  async cancel(e, a) {
    try { await this.client.cancelOrder(e.o.instId, a.exId); } catch (err) { if (isUnknown(err)) { this.count('cancelUnknown'); return; } }
    await this.settle(e, a);
  }

  // ───────── positions
  async openPosition(e) {
    const o = e.o, inst = this.inst[o.instId];
    delete this.S.entries[o.id];
    const qty = Q.contractsToBase(e.filled, inst), px = e.cost / e.filled, held = this.S.positions[o.coin];
    const kind = e.attempts.some((a) => a.kind === 'market' && a.filled) ? 'taker' : 'maker';
    for (const a of e.attempts) if (held) (held.ownCids || (held.ownCids = [])).push(a.cid); // its fills are not a stop's
    if (o.reduceOnly) return held ? this.shrink(held, e.filled, px, e.fee, kind, o.id) : this.endOrder(o, 'nothing to reduce');
    if (held) {
      // a sleeve grows its position: average entry, fees add up, the whole position takes the new stop (as the backtest)
      const c = held.contracts + e.filled, q = Q.contractsToBase(c, inst);
      held.entry = (held.qty * held.entry + qty * px) / q; held.contracts = c; held.qty = q; held.feeUsd += e.fee;
      held.stop = o.side * (px - o.stop) > 0 ? o.stop : held.stop; held.R = Math.abs(held.entry - held.stop); held.riskUsd = q * Math.max(held.R, held.entry * 0.001); held.resizedAt = this.now();
      this.jot({ ev: 'add', coin: o.coin, contracts: e.filled, px });
      await this.publish('exec.fill', { orderId: o.id, coin: o.coin, side: o.side, qty, px, feeUsd: e.fee, kind, role: 'entry', ts: this.now() });
      return this.replaceStop(held);
    }
    const p = { orderId: o.id, owner: o.owner || null, coin: o.coin, instId: o.instId, side: o.side, contracts: e.filled, qty, entry: px, entryT: this.now(), stop: o.stop, target: o.target, trail: o.trail, timeStopMin: o.timeStopMin, best: px, R: Math.abs(px - o.stop), feeUsd: e.fee, fundUsd: 0, strategies: o.strategies, riskUsd: qty * Math.max(Math.abs(px - o.stop), px * 0.001), attempts: [] }; // R against at least 10 bps
    if (!(p.R > 0) || o.side * (px - o.stop) <= 0) p.stop = px * (1 - o.side * 0.005); // filled beyond the stop: protect at 0.5% and let the manager exit
    this.S.positions[o.coin] = p; this.save(); this.dirty = true;
    this.jot({ ev: 'open', coin: o.coin, contracts: e.filled, px });
    await this.publish('exec.fill', { orderId: o.id, coin: o.coin, side: o.side, qty, px, feeUsd: e.fee, kind: e.attempts.some((a) => a.kind === 'market' && a.filled) ? 'taker' : 'maker', role: 'entry', ts: this.now() });
    await this.protect(p);
  }
  async protect(p) {
    const inst = this.inst[p.instId], close = p.side > 0 ? 'sell' : 'buy';
    if (!p.sl || p.sl.state === 'GONE') {
      const trig = Q.passivePrice(p.stop, p.side > 0 ? 'buy' : 'sell', inst); // long: round the stop down; short: up
      const cid = this.cid();
      p.sl = { cid, trigger: +trig, state: 'SUBMITTING', at: this.now() }; this.save();
      try {
        const r = await this.client.placeTpsl({ instId: p.instId, marginMode: 'cross', positionSide: 'net', side: close, slTriggerPrice: trig, slOrderPrice: '-1', size: Q.fmt(p.contracts, inst.lotSize), reduceOnly: 'true', clientOrderId: cid });
        const x = Array.isArray(r) ? r[0] : r;
        if (x && x.tpslId) { p.sl.tpslId = String(x.tpslId); p.sl.state = 'LIVE'; } else { p.sl.state = 'GONE'; this.warn(`${p.coin}: stop-loss refused: ${(x && x.msg) || 'no id'}`); }
      } catch (e) { p.sl.state = isUnknown(e) ? 'UNKNOWN' : 'GONE'; this.warn(`${p.coin}: stop-loss ${p.sl.state}: ${e.message}`); }
      this.save();
    }
    if (p.target != null && !p.tp) {
      const px = Q.passivePrice(p.target, close, inst);
      const a = await this.send(p, { instId: p.instId, marginMode: 'cross', positionSide: 'net', side: close, orderType: 'post_only', price: px, size: Q.fmt(p.contracts, inst.lotSize), reduceOnly: 'true' }, 'tp');
      p.tp = { cid: a.cid, exId: a.exId || null, state: a.state };
      this.save();
    }
  }
  async workPosition(p) {
    const inst = this.inst[p.instId], ex = this.snap.pos[p.instId], have = ex ? Math.abs(ex.contracts) : 0;
    const reducing = Object.values(this.S.entries).some((e) => e.o.coin === p.coin && e.o.reduceOnly); // a sleeve's reduce-only leg is shrinking it
    if (!reducing && have < p.contracts - inst.lotSize / 2) return this.closed(p, have); // the stop, the target or our close did it
    // the stop must be on BloFin
    // (only a stop list read after the stop was placed can say it is gone)
    if (p.sl && p.sl.state === 'LIVE' && this.snap.tpsl && this.lastSlow > p.sl.at && !this.snap.tpsl[p.sl.tpslId] && this.now() - this.lastSlow < 3000) p.sl.state = 'GONE';
    if (p.sl && p.sl.state === 'UNKNOWN') { const found = Object.values(this.snap.tpsl || {}).find((x) => x.clientOrderId === p.sl.cid); if (found) { p.sl.tpslId = String(found.tpslId); p.sl.state = 'LIVE'; } else if (this.now() - p.sl.at > 30000) p.sl.state = 'GONE'; }
    if (!p.sl || p.sl.state === 'GONE') { this.count('stopReplaced'); await this.protect(p); }
    else if (p.resizeStop && p.sl.state === 'LIVE') await this.replaceStop(p);
    if (p.closing) return;
    const px = this.last.get(p.coin), s = p.side;
    if (px > 0 && !p.owner) { // a sleeve's position keeps only its stop (moved by the risk agent)
      if (s * (px - p.best) > 0) p.best = px;
      const fav = s * (p.best - p.entry);
      let ns = p.stop;
      if (p.trail && fav >= p.trail.afterR * p.R) ns = p.best - s * p.trail.dist;
      else if (!p.trail && this.X.breakevenR && fav >= this.X.breakevenR * p.R) ns = p.entry * (1 + s * (this.X.makerBps + this.X.takerBps) / 1e4);
      if (s * (ns - p.stop) > this.X.stopMoveR * p.R && this.now() - (p.stopMovedAt || 0) > this.X.stopMoveEveryMs) await this.moveStop(p, ns);
    }
    if (this.S.paused === 'flatten' || (p.timeStopMin > 0 && this.now() >= p.entryT + p.timeStopMin * 60000)) await this.closeNow(p, this.S.paused === 'flatten' ? 'flatten' : 'time');
  }
  async moveStop(p, ns) {
    const old = p.sl; p.stop = ns; p.stopMovedAt = this.now(); p.sl = null;
    await this.protect(p); // the new stop first …
    if (p.sl && p.sl.state === 'LIVE' && old && old.tpslId) { try { await this.client.cancelTpsl([{ instId: p.instId, tpslId: old.tpslId }]); } catch (e) { this.count('cancelStopErrors'); } } // … then the old one
    else if (!(p.sl && p.sl.state === 'LIVE')) p.sl = old; // keep the old stop if the new one failed
    this.save(); this.dirty = true;
  }
  // the position changed size: a stop for the new size first, then the old one goes (kept if the new one failed)
  async replaceStop(p) {
    const old = p.sl; p.sl = null;
    await this.protect(p);
    if (p.sl && p.sl.state === 'LIVE' && old && old.tpslId) { try { await this.client.cancelTpsl([{ instId: p.instId, tpslId: old.tpslId }]); } catch (e) { this.count('cancelStopErrors'); } }
    else if (!(p.sl && p.sl.state === 'LIVE') && old) { p.sl = old; p.resizeStop = true; this.warn(`${p.coin}: the stop for the new size failed; the old one stays until the next try`); }
    if (p.sl && p.sl !== old) p.resizeStop = false;
    this.save(); this.dirty = true;
  }
  // a reduce-only leg filled: book that share of the position, then fit the stop to what is left
  async shrink(p, contracts, px, fee, kind, orderId) {
    const inst = this.inst[p.instId], all = contracts >= p.contracts - inst.lotSize / 2;
    if (!(contracts > 0)) return;
    const f = all ? 1 : contracts / p.contracts, qty = Q.contractsToBase(contracts, inst);
    const entryFee = p.feeUsd * f, fundUsd = p.fundUsd * f, riskUsd = p.riskUsd * f;
    const grossUsd = p.side * (px - p.entry) * qty, feeUsd = entryFee + fee, netUsd = grossUsd - feeUsd - fundUsd;
    if (all) {
      if (p.sl && p.sl.tpslId) { try { await this.client.cancelTpsl([{ instId: p.instId, tpslId: p.sl.tpslId }]); } catch (e) { /* gone with the position */ } }
      delete this.S.positions[p.coin];
    } else {
      p.contracts -= contracts; p.qty = Q.contractsToBase(p.contracts, inst); p.feeUsd -= entryFee; p.fundUsd -= fundUsd; p.riskUsd -= riskUsd; p.resizedAt = this.now();
    }
    this.save(); this.dirty = true;
    this.jot({ ev: 'reduce', coin: p.coin, contracts, px, all });
    await this.publish('exec.fill', { orderId, coin: p.coin, side: -p.side, qty, px, feeUsd: fee, kind, role: 'exit', reason: 'rebalance', ts: this.now() });
    await this.publish('trade.closed', { orderId: p.orderId, coin: p.coin, side: p.side, qty, entry: p.entry, exit: px, entryT: p.entryT, exitT: this.now(), grossUsd, feeUsd, fundUsd, netUsd, riskUsd, r: riskUsd > 0 ? netUsd / riskUsd : 0, reason: 'rebalance', strategies: p.strategies, account: 'demo', owner: p.owner || undefined, partial: all ? undefined : true });
    if (!all) await this.replaceStop(p);
  }
  async onStopMove(m) {
    const p = this.S.positions[m.coin], last = this.last.get(m.coin);
    if (!p || (p.owner || null) !== (m.owner || null)) { this.count('stopMoveNoPosition'); return; }
    if (!(p.side * (m.stop - p.stop) > 0)) { this.count('stopMoveRefused'); this.warn(`${m.coin}: stop ${p.stop} → ${m.stop} refused: a stop only moves toward the price`); return; }
    if (last > 0 && !(p.side * (last - m.stop) > 0)) { this.count('stopMoveRefused'); this.warn(`${m.coin}: stop ${m.stop} refused: it is past the price ${last}`); return; }
    await this.moveStop(p, m.stop);
  }
  async closeNow(p, reason) {
    const inst = this.inst[p.instId];
    p.closing = { reason, at: this.now() };
    if (p.tp && p.tp.exId) { try { await this.client.cancelOrder(p.instId, p.tp.exId); } catch (e) { /* settles below */ } }
    const a = await this.send(p, { instId: p.instId, marginMode: 'cross', positionSide: 'net', side: p.side > 0 ? 'sell' : 'buy', orderType: 'market', size: Q.fmt(p.contracts, inst.lotSize), reduceOnly: 'true' }, 'close');
    p.closing.cid = a.cid; this.save();
  }
  // the position is gone (or smaller): read what closed it, tidy up the other leg, report the trade
  async closed(p, have) {
    const inst = this.inst[p.instId], closeSide = p.side > 0 ? 'sell' : 'buy';
    let hist = [];
    try { hist = (await this.client.orderHistory(p.instId)) || []; } catch (e) { if (isUnknown(e)) return; }
    const mine = new Set(p.ownCids || []); // a sleeve's own reduce-only legs, already booked
    const exits = hist.filter((o) => o.side === closeSide && +o.filledSize > 0 && +(o.createTime || 0) >= (p.resizedAt || p.entryT) - 5000 && !mine.has(o.clientOrderId));
    const contracts = exits.reduce((s, o) => s + +o.filledSize, 0);
    if (contracts < p.contracts - have - inst.lotSize / 2 && this.now() - (p.goneAt || (p.goneAt = this.now())) < 20000) return; // history not updated yet
    const px = contracts ? exits.reduce((s, o) => s + +o.filledSize * +o.averagePrice, 0) / contracts : this.last.get(p.coin) || p.entry;
    const fee = exits.reduce((s, o) => s + Math.abs(+o.fee || 0), 0);
    const viaTp = p.tp && exits.some((o) => o.clientOrderId === p.tp.cid), viaClose = p.closing && exits.some((o) => o.clientOrderId === p.closing.cid);
    const reason = viaClose ? p.closing.reason : viaTp ? 'target' : 'stop';
    if (p.tp && p.tp.exId && !viaTp) { try { await this.client.cancelOrder(p.instId, p.tp.exId); } catch (e) { /* gone */ } }
    if (p.sl && p.sl.tpslId && reason !== 'stop') { try { await this.client.cancelTpsl([{ instId: p.instId, tpslId: p.sl.tpslId }]); } catch (e) { /* gone */ } }
    delete this.S.positions[p.coin]; this.save(); this.dirty = true;
    const qty = Q.contractsToBase(p.contracts - have, inst), grossUsd = p.side * (px - p.entry) * qty, feeUsd = p.feeUsd + fee, netUsd = grossUsd - feeUsd - p.fundUsd;
    this.jot({ ev: 'closed', coin: p.coin, reason, px, contracts });
    await this.publish('exec.fill', { orderId: p.orderId, coin: p.coin, side: -p.side, qty, px, feeUsd: fee, kind: reason === 'target' ? 'maker' : 'taker', role: 'exit', reason, ts: this.now() });
    await this.publish('trade.closed', { orderId: p.orderId, coin: p.coin, side: p.side, qty, entry: p.entry, exit: px, entryT: p.entryT, exitT: this.now(), grossUsd, feeUsd, fundUsd: p.fundUsd, netUsd, riskUsd: p.riskUsd, r: p.riskUsd > 0 ? netUsd / p.riskUsd : 0, reason, strategies: p.strategies, account: 'demo', owner: p.owner || undefined });
    if (have > 0) this.warn(`${p.coin}: ${have} contracts left after the exit — left for the next check`);
  }
  orphans() {
    const known = new Set(Object.values(this.S.positions).map((p) => p.instId).concat(Object.values(this.S.entries).map((e) => e.o.instId)));
    for (const id of Object.keys(this.snap.pos)) if (!known.has(id)) this.warn(`BloFin demo has a position in ${id} the swarm did not open — left alone; close it in the app if it is not yours`);
  }
  async publishPositions() {
    this.dirty = false;
    const open = Object.values(this.S.positions).map((p) => ({ coin: p.coin, side: p.side, qty: p.qty, px: p.entry, entry: p.entry, stop: p.stop, target: p.target, entryT: p.entryT, last: this.last.get(p.coin) || p.entry, strategies: p.strategies.map((s) => s.name), orderId: p.orderId, exchangeStop: p.sl ? p.sl.state : 'none' }, p.owner ? { owner: p.owner } : {}));
    const working = Object.values(this.S.entries).map((e) => Object.assign({ coin: e.o.coin, side: e.o.side, qty: e.o.qty, px: e.o.entry.px, stop: e.o.stop, until: e.until, orderId: e.o.id }, e.o.owner ? { owner: e.o.owner } : {}, e.o.reduceOnly ? { reduceOnly: true } : {}));
    const msg = { ts: this.now(), open, working, paused: !!this.S.paused, account: 'demo', equity: this.snap ? this.snap.equity : null };
    await this.bus.kv.set('positions', msg);
    await this.publish('positions', msg);
  }
  async onCommand(c, src) {
    if (c.cmd === 'flatten') { this.warn(`flatten by ${src}/${c.by}: ${c.why || ''}`); this.S.paused = 'flatten'; }
    else if (c.cmd === 'pause' && this.S.paused !== 'flatten') this.S.paused = true;
    else if (c.cmd === 'resume' && src === 'herald' && c.by === 'ibrahim') this.S.paused = false;
    this.save(); this.dirty = true;
  }
}

module.exports = { DemoTrader };
