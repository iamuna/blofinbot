/* DEMO broker: drives a BloFin demo account to the paper bot's target positions with the same execution
 * policy the paper bot simulates (post at the best price, re-post when the market moves away, market order
 * after 30 minutes).
 *
 * Exchange state is the truth: every minute it reads positions, open orders, balance and the book, and
 * works toward a per-coin GOAL (target net position in contracts). Restart-safe and idempotent:
 *   - each order is an INTENT, written to an fsync'd journal and state file BEFORE it is sent;
 *   - a send that fails without a definitive answer becomes SUBMIT_UNKNOWN; that coin places nothing new until
 *     the order is found (by clientOrderId: detail → open orders → history) or proven absent after 2 minutes;
 *   - unresolved and resting orders reserve exposure in the gross-exposure check;
 *   - a process that died mid-send restarts with that intent as SUBMIT_UNKNOWN.
 * One-way (net) mode, cross margin. Never transfers or withdraws (no such calls exist in the client).
 */
'use strict';
const fs = require('fs'), path = require('path');
const Q = require('./quant.js');

const TERMINAL = new Set(['FILLED', 'CANCELED', 'PARTIALLY_CANCELED', 'REJECTED_EXCHANGE', 'REJECTED_LOCAL', 'NOT_FOUND']);
const UNRESOLVED = new Set(['SUBMITTING', 'SUBMIT_UNKNOWN', 'CANCEL_UNKNOWN']);
const EX_STATE = { live: 'ACCEPTED', partially_filled: 'ACCEPTED', filled: 'FILLED', canceled: 'CANCELED', cancelled: 'CANCELED', partially_canceled: 'PARTIALLY_CANCELED' };
const PREFIX = 'mtf';

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, text); fs.fsyncSync(fd); fs.closeSync(fd);
  fs.renameSync(tmp, file);
}
function appendSync(file, line) {
  const fd = fs.openSync(file, 'a'); fs.writeSync(fd, line + '\n'); fs.fsyncSync(fd); fs.closeSync(fd);
}
// The demo key must be able to trade and must NOT be able to move money (transfer / withdraw).
function keyProblem(info) {
  const x = Array.isArray(info) ? info[0] : info;
  if (!x) return null;
  if (String(x.readOnly) === '1') return 'the API key is read-only; create the demo key with READ + TRADE';
  const bad = [];
  (function walk(o, k) {
    if (o == null) return;
    if (typeof o === 'object') { for (const [kk, v] of Object.entries(o)) walk(v, kk); return; }
    if (/perm|scope|auth/i.test(k || '') && /transfer|withdraw/i.test(String(o))) bad.push(String(o));
  })(x, '');
  return bad.length ? `the API key has money-moving permission (${bad.join(', ')}); create a key with READ + TRADE only` : null;
}
const isUnknownFailure = (e) => e && (e.kind === 'network' || e.kind === 'parse' || (e.kind === 'http' && e.status >= 500));

class DemoBroker {
  constructor(o) {
    this.client = o.client;
    this.dir = o.dir;
    this.now = o.now || (() => Math.floor(Date.now() / 1000));
    this.log = o.log || (() => {});
    this.coins = o.coins || []; // [{coin, instId}]
    this.chaseMin = o.chaseMinutes || 30;
    this.leverage = o.leverage || 5;
    this.marginMode = 'cross';
    this.grossCap = o.grossCap || 3.2; // × equity, includes resting/unresolved orders
    this.maxCoinWeight = o.maxCoinWeight || 0.6;
    this.staleSec = o.staleSec || 180;
    this.file = path.join(this.dir, 'broker.json');
    this.journal = path.join(this.dir, 'broker-journal.jsonl');
    this.inst = {}; this.snap = null; this.ready = false; this.reason = 'not initialised'; this.fills = []; this.nextInit = 0;
    const raw = this.log, seen = {};
    this.log = (type, text) => { const t = this.now(); if (seen[text] && t - seen[text] < 900) return; seen[text] = t; raw(type, text); };
    fs.mkdirSync(this.dir, { recursive: true });
    this.S = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, epoch: this.now(), seq: 0, intents: {}, goals: {}, rejects: {}, leverageSet: {}, warned: {} };
    // a process that died between "SUBMITTING" and the answer: the order may exist
    for (const it of Object.values(this.S.intents)) if (it.state === 'SUBMITTING') this.transition(it, 'SUBMIT_UNKNOWN', 'restart during submission');
    this.save();
  }

  // ───────── persistence
  save() { writeAtomic(this.file, JSON.stringify(this.S)); }
  transition(it, state, why, extra) {
    it.state = state; it.updatedAt = this.now();
    if (extra) Object.assign(it, extra);
    appendSync(this.journal, JSON.stringify({ t: it.updatedAt, id: it.id, coin: it.coin, state, why: why || '', clientOrderId: it.clientOrderId, orderId: it.orderId || null, side: it.side, orderType: it.orderType, size: it.size, price: it.price || null, filled: it.filled || 0 }));
    this.save();
  }
  prune() { // keep terminal intents for a day, the rest always
    const cut = this.now() - 86400;
    for (const [k, it] of Object.entries(this.S.intents)) if (TERMINAL.has(it.state) && it.updatedAt < cut) delete this.S.intents[k];
  }

  // ───────── setup / reconciliation on start
  async init() {
    try {
      const rows = await this.client.instruments();
      for (const r of rows) this.inst[r.instId] = Q.parseInstrument(r);
      const why = keyProblem(await this.client.apiKeyInfo());
      if (why) { this.ready = false; this.reason = why; this.log('demo', why); return false; }
      const missing = this.coins.filter((c) => !this.inst[c.instId]).map((c) => c.instId);
      if (missing.length) this.log('demo', `Not tradable on BloFin demo, skipped: ${missing.join(', ')}`);
      await this.refresh();
      const pm = await this.client.positionMode();
      const mode = (Array.isArray(pm) ? pm[0] : pm || {}).positionMode;
      const flat = !Object.keys(this.snap.pos).length && !Object.keys(this.snap.pending).length;
      if (mode !== 'net_mode') {
        if (!flat) { this.ready = false; this.reason = `account is in ${mode} with open positions/orders; one-way (net) mode needed — close them in the BloFin demo app first`; this.log('demo', this.reason); return false; }
        await this.client.setPositionMode('net_mode');
        this.log('demo', 'Set the demo account to one-way (net) position mode');
      }
      const mm = await this.client.marginMode();
      const mmode = (Array.isArray(mm) ? mm[0] : mm || {}).marginMode;
      if (mmode && mmode !== 'cross') {
        if (!flat) { this.ready = false; this.reason = `account margin mode is ${mmode} with open positions; cross needed`; this.log('demo', this.reason); return false; }
        await this.client.setMarginMode('cross');
        this.log('demo', 'Set the demo account to cross margin');
      }
      for (const c of this.coins) {
        if (!this.inst[c.instId] || this.S.leverageSet[c.instId] === this.leverage) continue;
        await this.client.setLeverage(c.instId, this.leverage, this.marginMode);
        this.S.leverageSet[c.instId] = this.leverage;
      }
      // orders with our prefix that the state does not know about (state lost or rolled back): cancel them
      const known = new Set(Object.values(this.S.intents).map((it) => it.clientOrderId));
      for (const o of Object.values(this.snap.pending)) {
        const cid = o.clientOrderId || '';
        if (cid.startsWith(PREFIX) && !known.has(cid)) {
          try { await this.client.cancelOrder(o.instId, o.orderId); this.log('demo', `Cancelled an untracked bot order on ${o.instId} (${cid}) left from an earlier run`); } catch (e) { this.log('demo', `Could not cancel untracked order ${cid}: ${e.message}`); }
        } else if (!cid.startsWith(PREFIX) && !this.S.warned[o.orderId]) {
          this.S.warned[o.orderId] = 1; this.log('demo', `Manual order on ${o.instId} (${o.orderId}) found on the demo account — the bot leaves it alone, but positions are netted; a dedicated demo account is best`);
        }
      }
      this.save();
      this.ready = true; this.reason = '';
      this.log('demo', `Demo broker ready: equity ${this.snap.equity.toFixed(2)} USDT, ${Object.keys(this.snap.pos).length} positions, ${Object.keys(this.snap.pending).length} open orders`);
      return true;
    } catch (e) {
      this.ready = false; this.reason = 'init failed: ' + e.message; this.log('demo', this.reason);
      return false;
    }
  }

  async refresh() {
    const t = this.now();
    const bal = await this.client.balance(), pos = await this.client.positions(), tick = await this.client.tickers();
    const pending = {};
    let after;
    for (let page = 0; page < 10; page++) {
      const rows = await this.client.pendingOrders(after);
      for (const o of rows || []) pending[o.orderId] = o;
      if (!rows || rows.length < 100) break;
      after = rows[rows.length - 1].orderId;
    }
    const b = Array.isArray(bal) ? bal[0] : bal;
    const P = {};
    for (const p of pos || []) {
      let c = +p.positions;
      if (p.positionSide === 'short') c = -Math.abs(c); else if (p.positionSide === 'long') c = Math.abs(c);
      if (c) P[p.instId] = { contracts: (P[p.instId] ? P[p.instId].contracts : 0) + c, avg: +p.averagePrice, upl: +p.unrealizedPnl || 0, mark: +p.markPrice || NaN };
    }
    const book = {};
    for (const x of tick || []) book[x.instId] = { bid: +x.bidPrice, ask: +x.askPrice, last: +x.last };
    this.snap = { t, equity: +b.totalEquity, pos: P, pending, book };
    return this.snap;
  }

  // ───────── goals from the strategy (base units, signed)
  setGoal(coin, instId, baseQty, reason) {
    const inst = this.inst[instId];
    if (!inst) return null;
    const contracts = Q.toContracts(baseQty, inst);
    const t0 = this.now() - (this.now() % 60);
    this.S.goals[coin] = { instId, contracts, base: baseQty, reason, t0 };
    this.save();
    return this.S.goals[coin];
  }
  clearGoal(coin) { if (this.S.goals[coin]) { delete this.S.goals[coin]; this.save(); } }
  goal(coin) { return this.S.goals[coin] || null; }

  // ───────── views for the bot
  equity() { return this.snap ? this.snap.equity : NaN; }
  positionsBase() {
    const out = {};
    if (!this.snap) return out;
    for (const c of this.coins) { const p = this.snap.pos[c.instId], inst = this.inst[c.instId]; if (p && inst) out[c.coin] = { qty: Q.contractsToBase(p.contracts, inst), avg: p.avg }; }
    return out;
  }
  openOrdersView() {
    const out = {};
    for (const it of Object.values(this.S.intents)) {
      if (TERMINAL.has(it.state)) continue;
      const inst = this.inst[it.instId]; if (!inst) continue;
      out[it.coin] = { qty: (it.side === 'buy' ? 1 : -1) * Q.contractsToBase(+it.size - (it.filled || 0), inst), limit: it.price ? +it.price : NaN, t0: it.goalT0 || it.createdAt, reason: it.reason, state: it.state };
    }
    return out;
  }
  drainFills() { const f = this.fills; this.fills = []; return f; }
  reserved(instId) { // contracts that resting or unresolved orders could still add (signed)
    let r = 0;
    for (const it of Object.values(this.S.intents)) if (it.instId === instId && !TERMINAL.has(it.state)) r += (it.side === 'buy' ? 1 : -1) * Math.max(0, +it.size - (it.filled || 0));
    return r;
  }

  // ───────── the minute loop
  async tick() {
    if (!this.ready) {
      if (this.now() < this.nextInit) return;
      await this.init();
      if (!this.ready) { this.nextInit = this.now() + 600; return; }
    }
    try { await this.refresh(); } catch (e) { this.log('demo', 'refresh failed, no new orders this minute: ' + e.message); return; }
    if (!(this.snap.equity > 0)) { this.log('demo', 'demo equity not positive; no orders'); return; }
    const coins = new Set([...Object.keys(this.S.goals), ...Object.values(this.S.intents).filter((it) => !TERMINAL.has(it.state)).map((it) => it.coin)]);
    for (const coin of coins) {
      try { await this.workCoin(coin); } catch (e) { this.log('demo', `${coin}: ${e.message}`); }
    }
    this.prune(); this.save();
  }

  async workCoin(coin) {
    const open = Object.values(this.S.intents).filter((it) => it.coin === coin && !TERMINAL.has(it.state));
    // 1) anything unresolved blocks new orders for this coin until it is found or proven absent
    for (const it of open) if (UNRESOLVED.has(it.state)) await this.reconcile(it);
    if (open.some((it) => UNRESOLVED.has(it.state))) return;
    const g = this.S.goals[coin];
    const instId = (g && g.instId) || (open[0] && open[0].instId);
    const inst = this.inst[instId]; if (!inst) return;
    let P = this.snap.pos[instId] ? this.snap.pos[instId].contracts : 0;
    // 2) a resting order: keep it, or cancel it (goal changed / price moved away / chase time over)
    const live = open.find((it) => it.state === 'ACCEPTED');
    if (live) {
      const ex = this.snap.pending[live.orderId];
      if (!ex) { await this.finalize(live); return; } // left the book since the last look; positions next minute
      const filledAtSnap = +ex.filledSize || 0;
      live.filled = filledAtSnap;
      const want = g ? g.contracts - P : 0, sideSign = live.side === 'buy' ? 1 : -1;
      const bk = this.snap.book[instId];
      const age = this.now() - (g ? g.t0 : live.createdAt);
      let why = null;
      if (!g) why = 'goal cleared';
      else if (Math.sign(want) !== sideSign || Math.abs(want) + 1e-12 < inst.minSize) why = 'goal changed';
      else if (+live.size - filledAtSnap > Math.abs(want) + inst.lotSize / 2) why = 'goal smaller than the order';
      else if (age >= this.chaseMin * 60) why = 'chase time over';
      else if (bk && live.orderType === 'post_only' && (live.side === 'buy' ? bk.bid > +live.price + inst.tickSize / 2 : bk.ask < +live.price - inst.tickSize / 2)) why = 'price moved away';
      if (!why) return;
      const done = await this.cancel(live, why);
      if (!done) return; // cancel unknown or order already gone; look again next minute
      P += sideSign * Math.max(0, (live.filled || 0) - filledAtSnap);
    }
    // 3) place the next order toward the goal
    if (!g) return;
    const remaining = g.contracts - P;
    if (Math.abs(remaining) + 1e-12 < inst.minSize) { this.log('demo', `${coin}: at target (${Q.fmt(P, inst.lotSize)} contracts)`); this.clearGoal(coin); return; }
    const rj = this.S.rejects[coin];
    if (rj && rj.until > this.now()) return;
    const bk = this.snap.book[instId];
    if (!bk || !(bk.bid > 0) || !(bk.ask > 0) || this.now() - this.snap.t > this.staleSec) return;
    const side = remaining > 0 ? 'buy' : 'sell';
    const market = this.now() - g.t0 >= this.chaseMin * 60;
    const reduceOnly = P !== 0 && Math.sign(remaining) !== Math.sign(P) && Math.abs(remaining) <= Math.abs(P) + 1e-12;
    const size = Q.sizeString(remaining, inst, market);
    if (!size) { this.clearGoal(coin); return; }
    const ref = side === 'buy' ? bk.bid : bk.ask;
    // local risk checks (gross exposure includes every resting/unresolved order; one coin ≤ maxCoinWeight)
    const eq = this.snap.equity, mid = (bk.bid + bk.ask) / 2;
    const after = P + (side === 'buy' ? 1 : -1) * +size;
    if (Math.abs(after) * inst.contractValue * mid > this.maxCoinWeight * 1.05 * eq && Math.abs(after) > Math.abs(P)) return this.rejectLocal(coin, instId, `${coin}: order would take the coin above ${this.maxCoinWeight * 100}% of equity`);
    let gross = 0;
    for (const id of new Set([...Object.keys(this.snap.pos), ...Object.values(this.S.intents).filter((x) => !TERMINAL.has(x.state)).map((x) => x.instId)])) {
      if (id === instId) continue;
      const i2 = this.inst[id], b2 = this.snap.book[id]; if (!i2 || !b2) continue;
      const p2 = (this.snap.pos[id] ? this.snap.pos[id].contracts : 0);
      gross += Math.max(Math.abs(p2), Math.abs(p2 + this.reserved(id))) * i2.contractValue * b2.last;
    }
    gross += Math.abs(after) * inst.contractValue * mid;
    if (gross > this.grossCap * eq && Math.abs(after) > Math.abs(P)) return this.rejectLocal(coin, instId, `${coin}: gross exposure would be ${(gross / eq).toFixed(2)}× equity (cap ${this.grossCap}×)`);
    const order = { instId, marginMode: this.marginMode, positionSide: 'net', side, orderType: market ? 'market' : 'post_only', size };
    if (!market) order.price = Q.passivePrice(ref, side, inst);
    if (reduceOnly) order.reduceOnly = 'true';
    await this.submit(coin, order, g);
  }

  rejectLocal(coin, instId, why) {
    const it = this.newIntent(coin, { instId, side: '-', orderType: '-', size: '0' }, this.S.goals[coin]);
    this.transition(it, 'REJECTED_LOCAL', why);
    this.log('demo', why + ' — no order');
    this.S.rejects[coin] = { n: 0, until: this.now() + 15 * 60 };
    this.save();
  }

  newIntent(coin, order, g) {
    this.S.seq += 1;
    const id = `${coin}-${this.S.seq}`;
    const clientOrderId = (PREFIX + this.S.epoch.toString(36) + this.S.seq.toString(36)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    const it = { id, coin, instId: order.instId, clientOrderId, side: order.side, orderType: order.orderType, size: order.size, price: order.price || null, reduceOnly: order.reduceOnly === 'true', reason: g ? g.reason : '', goalT0: g ? g.t0 : null, createdAt: this.now(), state: 'NEW', filled: 0 };
    this.S.intents[id] = it;
    return it;
  }

  async submit(coin, order, g) {
    const it = this.newIntent(coin, order, g);
    this.transition(it, 'INTENT_PERSISTED', g ? g.reason : '');
    this.transition(it, 'SUBMITTING', '', { submittedAt: this.now() });
    let res;
    try {
      res = await this.client.placeOrder(Object.assign({}, order, { clientOrderId: it.clientOrderId }));
    } catch (e) {
      if (isUnknownFailure(e)) { this.transition(it, 'SUBMIT_UNKNOWN', e.message); this.log('demo', `${coin}: order outcome unknown (${e.message}) — reconciling before anything else`); return; }
      return this.rejected(it, e.code || e.status, e.message);
    }
    const r = Array.isArray(res) ? res[0] : res;
    if (!r || (r.code != null && String(r.code) !== '0') || !r.orderId) return this.rejected(it, r && r.code, (r && r.msg) || 'no order id');
    this.transition(it, 'ACCEPTED', 'accepted', { orderId: String(r.orderId) });
    this.S.rejects[coin] = { n: 0, until: 0 };
    this.log('order', `${coin}: ${order.side} ${order.size} contracts ${order.orderType === 'market' ? 'at market' : 'post-only at ' + order.price}${order.reduceOnly ? ' (reduce-only)' : ''} — ${it.reason}`);
  }

  rejected(it, code, msg) {
    this.transition(it, 'REJECTED_EXCHANGE', `code ${code}: ${msg}`);
    const r = this.S.rejects[it.coin] || { n: 0, until: 0 };
    r.n += 1;
    // a post-only order that would have crossed is normal: try again next minute; repeated rejections back off
    if (r.n >= 3) { r.until = this.now() + 15 * 60; r.n = 0; this.log('demo', `${it.coin}: 3 rejections in a row (last: ${msg}) — pausing this coin for 15 minutes`); }
    this.S.rejects[it.coin] = r; this.save();
  }

  async cancel(it, why) {
    try {
      const res = await this.client.cancelOrder(it.instId, it.orderId);
      const r = Array.isArray(res) ? res[0] : res;
      if (r && r.code != null && String(r.code) !== '0') { await this.finalize(it); return TERMINAL.has(it.state); }
    } catch (e) {
      if (isUnknownFailure(e)) { this.transition(it, 'CANCEL_UNKNOWN', `${why}; ${e.message}`); return false; }
      await this.finalize(it); return TERMINAL.has(it.state); // usually "already filled/cancelled"
    }
    await this.finalize(it, why);
    if (!TERMINAL.has(it.state)) { this.transition(it, 'CANCEL_UNKNOWN', why + '; still on the book after cancel'); return false; }
    return true;
  }

  // read the order's final state from the exchange; record its fill
  async finalize(it, why) {
    let d;
    try { d = await this.client.orderDetail(it.instId, { orderId: it.orderId }); } catch (e) { return; }
    d = Array.isArray(d) ? d[0] : d;
    if (!d) return;
    this.applyExchange(it, d, why);
  }

  applyExchange(it, d, why) {
    const st = EX_STATE[String(d.state)] || null;
    if (!it.orderId && d.orderId) it.orderId = String(d.orderId);
    const filled = +d.filledSize || 0;
    it.filled = filled;
    if (!st) return;
    if (st === 'ACCEPTED') { if (it.state !== 'ACCEPTED') this.transition(it, 'ACCEPTED', why || 'found on the book'); return; }
    this.transition(it, st, why || d.state, { avgPx: +d.averagePrice || null, fee: +d.fee || 0 });
    if (filled > 0) {
      const inst = this.inst[it.instId];
      const qty = (it.side === 'buy' ? 1 : -1) * Q.contractsToBase(filled, inst);
      this.fills.push({ t: this.now(), coin: it.coin, qty, price: +d.averagePrice, feeUsd: Math.abs(+d.fee || 0), kind: it.orderType === 'market' ? 'market' : 'limit', orderId: it.orderId, clientOrderId: it.clientOrderId, reason: it.reason });
    }
  }

  async reconcile(it) {
    const tag = { clientOrderId: it.clientOrderId };
    if (it.state === 'CANCEL_UNKNOWN' && it.orderId) {
      try { const d = await this.client.orderDetail(it.instId, { orderId: it.orderId }); const x = Array.isArray(d) ? d[0] : d; if (x) this.applyExchange(it, x, 'after uncertain cancel'); } catch (e) { /* try next minute */ }
      return;
    }
    // SUBMIT_UNKNOWN / SUBMITTING: detail by clientOrderId → open orders → history
    let found = null;
    try { const d = await this.client.orderDetail(it.instId, tag); found = Array.isArray(d) ? d[0] : d; } catch (e) { if (isUnknownFailure(e)) return; }
    if (!found) found = Object.values(this.snap.pending).find((o) => o.clientOrderId === it.clientOrderId) || null;
    if (!found) {
      try { const h = await this.client.orderHistory(it.instId); found = (h || []).find((o) => o.clientOrderId === it.clientOrderId) || null; } catch (e) { return; }
    }
    if (found) { this.log('demo', `${it.coin}: found order ${it.clientOrderId} on the exchange (${found.state}) — reconciled`); this.applyExchange(it, found, 'reconciled'); return; }
    if (this.now() - (it.submittedAt || it.createdAt) >= 120) {
      this.transition(it, 'NOT_FOUND', 'not on the exchange 2 minutes after the uncertain send');
      this.log('demo', `${it.coin}: order ${it.clientOrderId} never reached the exchange — safe to place a new one`);
    }
  }
}

module.exports = { DemoBroker, TERMINAL, UNRESOLVED, PREFIX, keyProblem };
