/* Decision agents: the coordinator runs each decision cycle; fusion, the allocator and the risk agent do their
 * parts inside it (in-process, so a cycle finishes within milliseconds), and each step is published for audit.
 *
 * Cycle: ideas from strategies in mode 'trade' are collected for 1.5 s after the first one arrives (a minute's
 * ideas come in one burst), then fused per coin, sized by each strategy's budget, checked by the risk agent and
 * sent to the trader as orders:
 *   idea → intent (fusion + allocator) → risk.decision (approve / trim / reject + reasons) → order (to the trader)
 * The risk agent also watches the account every few seconds: the loss ladders switch the swarm to no-new, flatten
 * (it orders the trader to close everything) or halt (closes everything and waits for Ibrahim's resume).
 * Inputs it keeps current: kv account (accountant), kv positions (trader), guard, events, md.book, kv betas (brain).
 * Orders it sent that the trader has not reported yet (in flight) count as working orders in every risk check, so
 * the ideas of one bar close (often dozens at once on 1h/4h) share the limits instead of each seeing the same room.
 * An order stays in flight until a positions report lists it, until a report made ≥ 5 s after it does not (the
 * trader has taken and ended it), or for 60 s at most.
 *
 * Sleeves (docs/TREND_SLEEVE_DESIGN.md §5): the trend sleeve asks every hour (sleeve.target, unsigned, only from
 * src 'trend-sleeve'); in mode 'trade' (key 'sleeve:trend', which only Ibrahim's /mode can set) the coordinator runs
 * the sleeve's plan() itself, on its own state (account, positions, working orders and orders in flight, books,
 * instruments, data guard, news windows, betas, halted/paused) with the same risk limits it checks ideas against.
 * Each approved or trimmed leg becomes a signed order (owner 'sleeve:trend', reduceOnly for reductions, chase the
 * best price 30 min then market), counted in flight like any other; a tightened stop becomes a signed stop.move.
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Agent } = require('../core/agent');
const { fuse } = require('./fusion');
const { Allocator } = require('./allocator');
const { RiskEngine } = require('./risk');
const S = require('../sleeve/sleeve');
const { readJSON, writeAtomic } = require('../core/fsx');

const SLEEVE = 'sleeve:trend', DAY = 86400000;
const isSleeve = (name) => String(name).startsWith('sleeve:');

class Coordinator extends Agent {
  static agentName = 'coordinator';
  async onStart() {
    this.T = Object.assign({ cycleMs: 1500, maxStackX: 1.5 }, this.cfg.trading || {});
    const riskFile = this.ctx.riskFile || path.join(__dirname, '..', '..', 'config', 'risk.json');
    const raw = fs.readFileSync(riskFile);
    this.limits = JSON.parse(raw); this.riskHash = crypto.createHash('sha256').update(raw).digest('hex');
    this.risk = new RiskEngine(this.limits);
    this.alloc = new Allocator({ startPct: this.limits.startTradeRiskPct, capPct: this.T.capPct || this.limits.liveFirstMonthCapPct });
    this.stateFile = path.join(this.ctx.dataDir, 'state', 'coordinator.json');
    const saved = readJSON(this.stateFile, {});
    this.halted = !!saved.halted; this.paused = !!saved.paused; this.lastMode = saved.lastMode || 'normal';
    // modes: the config's defaults, then the coordinator's own saved changes (commands it accepted). Not the shared
    // kv store: any process can write there, and modes decide what trades.
    this.modes = {}; for (const [k, v] of Object.entries(this.cfg.strategies || {})) this.modes[k] = v.enabled === false ? 'off' : v.mode || 'shadow';
    // a sleeve starts in shadow (or off); only Ibrahim's /mode (saved below) makes it trade
    const sc = (this.cfg.sleeves || {}).trend;
    if (sc) this.modes[SLEEVE] = sc.enabled === false || sc.mode === 'off' ? 'off' : 'shadow';
    Object.assign(this.modes, saved.modes || {});
    this.sleeveRules = Object.assign({}, (sc && sc.rules) || {});
    this.sleeveCool = saved.sleeveCool || {}; this.sleeveLast = saved.sleeveLast || 0; // coin → no new sleeve position before (ms) · the last hour planned
    await this.bus.kv.set('strategyModes', this.modes);
    this.queue = []; this.timer = null; this.books = new Map(); this.inflight = new Map();
    this.account = await this.bus.kv.get('account'); this.positions = (await this.bus.kv.get('positions')) || { open: [], working: [] };
    this.guard = ((await this.bus.kv.get('guard')) || {}).coins || {}; this.events = ((await this.bus.kv.get('events')) || {}).windows || [];
    this.betas = (await this.bus.kv.get('betas')) || {}; this.universe = new Map((((await this.bus.kv.get('universe')) || {}).coins || []).map((c) => [c.coin, c]));
    this.alloc.load(saved.results || {}); // its own record of closed trades (signed trade.closed), not the kv store
    this.subscribe('idea', (m) => this.onIdea(m.data));
    this.subscribe('account', (m) => { this.account = m.data; });
    this.subscribe('positions', (m) => { this.positions = m.data; this.settleInflight(m.data); });
    this.subscribe('trade.closed', (m) => this.onClosed(m.data));
    this.subscribe('sleeve.target', (m) => this.onSleeveTarget(m).catch((e) => this.error('sleeve', e)));
    this.subscribe('guard.status', (m) => { this.guard = m.data.coins; });
    this.subscribe('event.window', (m) => { this.events = m.data.windows; });
    this.subscribe('uni.list', (m) => { this.universe = new Map(m.data.coins.map((c) => [c.coin, c])); });
    this.subscribe('md.book', (m) => this.books.set(m.data.coin, m.data));
    this.subscribe('sys.command', (m) => this.onCommand(m.data, m.src));
    this.every(3000, () => this.watch());
    this.every(60000, async () => { this.betas = (await this.bus.kv.get('betas')) || this.betas; });
    this.log.info(`risk limits sha256 ${this.riskHash.slice(0, 16)}…`);
  }
  save() { writeAtomic(this.stateFile, JSON.stringify({ halted: this.halted, paused: this.paused, lastMode: this.lastMode, modes: this.modes, results: this.alloc.dump(), sleeveCool: this.sleeveCool, sleeveLast: this.sleeveLast })); }

  onClosed(t) {
    for (const s of t.strategies || []) {
      if (!isSleeve(s.name)) { this.alloc.record(s.name, t.r); continue; } // sleeves are sized by weight, not by R
      if (t.reason === 'stop') this.sleeveCool[t.coin] = (Math.floor(this.now() / DAY) + 1) * DAY; // as the backtest: no new position before 00:00 UTC
    }
    this.save();
  }

  onIdea(idea) {
    if (this.modes[idea.strategy] !== 'trade') { this.count('ideasShadow'); return; }
    this.queue.push(idea);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.cycle().catch((e) => this.error('cycle', e)); }, this.T.cycleMs);
  }

  riskMode() { const m = this.risk.mode(this.account, { halted: this.halted, paused: this.paused }); return m; }
  // betas come from the brain (untrusted zone): an alt counts as at least 0.5 and at most 3 BTC
  beta(c) { return c === 'BTC' ? 1 : Number.isFinite(this.betas[c]) ? Math.min(3, Math.max(0.5, this.betas[c])) : 1; }
  freshBook(c, now) { const b = this.books.get(c); return b && now - b.ts < 30000 ? b : null; }
  // working orders that add exposure (a reduce-only order only takes it away), and the orders in flight
  working() { return [...(this.positions.working || []).filter((w) => !w.reduceOnly), ...this.inflight.values()]; }

  // orders the trader has reported (or must have handled by now) stop counting as in flight
  settleInflight(p) {
    const now = this.now(), seen = new Set([...(p.open || []), ...(p.working || [])].map((x) => x.orderId));
    for (const [id, leg] of this.inflight) if (seen.has(id) || (p.ts >= leg.t + 5000) || now - leg.t > 60000) this.inflight.delete(id);
    this.gauge('inflight', this.inflight.size);
  }

  async cycle() {
    const ideas = this.queue.splice(0), t0 = Date.now();
    if (!ideas.length) return;
    const rm = this.riskMode();
    this.alloc.scale = rm.budgetScale;
    this.settleInflight({ ts: 0 }); // drop the expired ones
    const busy = new Set([...(this.positions.open || []), ...(this.positions.working || []), ...this.inflight.values()].map((p) => p.coin));
    const budget = (name) => { if (rm.provenOnly && this.alloc.stats(name).n < this.alloc.minTrades) return 0; return this.alloc.budget(name); };
    const { intents, dropped } = fuse(ideas, { busy, budget, maxStackX: this.T.maxStackX });
    for (const d of dropped) this.count('ideasDropped');
    const eq = this.account && this.account.equity;
    const now = this.now(), inWindow = this.events.some((w) => now >= w.start && now <= w.end);
    for (const it of intents) {
      const size = this.alloc.size(it, eq);
      const s = {
        equity: eq, mode: rm.mode, positions: this.positions.open || [], working: this.working(), inWindow,
        tradable: (c) => !this.guard[c] || this.guard[c].tradable, beta: (c) => this.beta(c),
        book: (c) => this.freshBook(c, now), inst: (c) => this.universe.get(c),
      };
      const d = this.risk.check(it, size, s);
      const intent = Object.assign({}, it, { qty: size ? size.qty : 0, riskUsd: size ? size.riskUsd : 0, equity: eq });
      await this.publish('intent', intent, { trace: it.strategies[0].ideaId });
      await this.publish('risk.decision', { id: it.id, coin: it.coin, verdict: d.verdict, qty: d.qty, reasons: d.reasons, mode: rm.mode }, { src: 'risk', trace: it.strategies[0].ideaId });
      this.count(`risk_${d.verdict}`);
      if (d.verdict === 'reject') continue;
      const inst = this.universe.get(it.coin);
      // reserve before publishing: the next intent of this cycle is checked against it
      this.inflight.set(`ord-${it.id}`, { orderId: `ord-${it.id}`, coin: it.coin, side: it.side, qty: d.qty, px: it.entry.px, stop: it.stop, t: this.now() });
      await this.publish('order', {
        id: `ord-${it.id}`, intentId: it.id, coin: it.coin, instId: inst ? inst.instId : `${it.coin}-USDT`, side: it.side, qty: d.qty, entry: it.entry, stop: it.stop, target: it.target, trail: it.trail,
        timeStopMin: it.timeStopMin, t: it.t, strategies: it.strategies, riskPct: (d.qty * Math.abs(it.entry.px - it.stop)) / eq, why: it.why,
      }, { src: 'risk', trace: it.strategies[0].ideaId });
      this.count('orders');
    }
    this.gauge('lastCycleMs', Date.now() - t0);
  }

  /* ── the trend sleeve (docs/TREND_SLEEVE_DESIGN.md §5): its weights are a request; the limits are checked here ── */
  async onSleeveTarget(m) {
    const d = m.data;
    // unsigned by design: only the sleeve's own process may ask, and it can only ask
    if (m.src !== 'trend-sleeve' || d.sleeve !== 'trend') { this.count('sleeveRefused'); this.warn(`ignored sleeve.target ${d.sleeve} from ${m.src}`); return; }
    if (this.modes[SLEEVE] !== 'trade') { this.count('sleeveShadow'); return; }
    const now = this.now();
    if (!(d.ts > this.sleeveLast) || now - d.ts > 30 * 60000 || d.ts > now + 5 * 60000) { this.count('sleeveStale'); return; } // each hour once, while it is current
    this.sleeveLast = d.ts; this.save();
    await this.sleeveCycle(d);
  }

  async sleeveCycle(d) {
    const now = this.now(), t0 = Date.now(), eq = this.account && this.account.equity;
    this.settleInflight({ ts: 0 });
    const rm = this.riskMode();
    if (rm.mode === 'flatten' || rm.mode === 'halt' || !(eq > 0)) { this.count('sleeveRiskOff'); return; } // the flatten command closes the sleeve too
    const mine = (p) => p.owner === SLEEVE, open = this.positions.open || [], work = this.working();
    // a coin with a sleeve order still working (or in flight) waits for the next hour; its position counts as another leg
    const pending = new Set([...(this.positions.working || []), ...this.inflight.values()].filter(mine).map((p) => p.coin));
    // one owner per coin where BloFin nets positions (demo, one-way mode; hedge mode is not built): the sleeve leaves
    // coins idea trades hold, and fusion already treats a coin the sleeve holds as busy
    const oneOwner = (this.T.account || 'paper') !== 'paper';
    const ideaCoins = new Set([...open, ...work].filter((p) => !mine(p)).map((p) => p.coin));
    const leg = (p) => ({ coin: p.coin, side: p.side, qty: p.qty, px: p.px, stop: p.stop });
    const book = {}, others = [], last = {};
    for (const p of open) {
      if (mine(p) && !pending.has(p.coin)) { book[p.coin] = { qty: p.side * p.qty, stop: p.stop }; last[p.coin] = p.last; } else others.push(leg(p));
    }
    for (const w of work) others.push(leg(w));
    const mkt = {}, w = {}, sig = d.sigma || {}, skipped = [];
    for (const c of new Set([...Object.keys(d.weights || {}), ...Object.keys(book)])) {
      const b = this.freshBook(c, now), px = b ? b.mid : book[c] ? last[c] : null; // a coin held is always priced (its notional counts)
      if (!(px > 0)) continue;
      const s = Number(sig[c]);
      mkt[c] = { px, sigma: Number.isFinite(s) && s > 0 ? Math.min(0.25, Math.max(0.005, s)) : 0.05, beta: this.beta(c), cool: (this.sleeveCool[c] || 0) > now };
      const x = Number(d.weights[c]);
      if (pending.has(c) || !b || !this.universe.get(c) || !Number.isFinite(x) || !x) continue;
      if (oneOwner && ideaCoins.has(c) && !book[c]) { skipped.push(c); continue; }
      w[c] = Math.max(-3, Math.min(3, x));
    }
    const st = { book: (c) => this.freshBook(c, now), inst: (c) => this.universe.get(c), tradable: (c) => !this.guard[c] || this.guard[c].tradable, inWindow: this.events.some((x) => now >= x.start && now <= x.end), halted: this.halted, paused: this.paused };
    const p = S.plan(w, book, mkt, this.account, this.limits, others, this.sleeveRules, st);
    const closing = new Set(p.legs.filter((l) => l.kind === 'close').map((l) => l.coin)), tag = `slv-trend-${d.ts}`;
    let n = 0;
    for (const l of p.legs) {
      const inst = this.universe.get(l.coin), id = `${tag}-${l.coin}`;
      if (l.kind === 'stop') { await this.publish('stop.move', { coin: l.coin, owner: SLEEVE, stop: l.stop, was: l.was }, { src: 'risk', trace: tag }); this.count('sleeveStopMoves'); continue; }
      // a flip closes this hour and opens the other side next hour, from what is then held
      const flip = l.kind === 'open' && closing.has(l.coin);
      const verdict = flip ? 'reject' : l.verdict, reasons = flip ? ['the opposite position closes first; opens next hour'] : l.reasons;
      await this.publish('risk.decision', { id, coin: l.coin, verdict, qty: Math.abs(l.qty), reasons, mode: p.mode, owner: SLEEVE, kind: l.kind }, { src: 'risk', trace: tag });
      this.count(`sleeve_${verdict}`);
      if (verdict === 'reject' || !l.qty) continue;
      const side = Math.sign(l.qty), qty = Math.abs(l.qty), reduce = l.kind === 'reduce' || l.kind === 'close', stop = reduce ? book[l.coin].stop : l.stop;
      if (!reduce) this.inflight.set(id, { orderId: id, coin: l.coin, side, qty, px: l.px, stop, t: this.now(), owner: SLEEVE }); // reserved before it is published
      await this.publish('order', {
        id, intentId: id, owner: SLEEVE, reduceOnly: reduce, coin: l.coin, instId: inst ? inst.instId : `${l.coin}-USDT`, side, qty,
        entry: { kind: 'maker', px: l.px, waitMin: 30, chase: true, fallback: 'taker' }, stop, target: null, trail: null, timeStopMin: 0, t: now,
        strategies: [{ name: SLEEVE, ideaId: id }], riskPct: reduce ? 0 : (qty * Math.abs(l.px - stop)) / eq, why: `trend sleeve ${l.kind} → ${(+l.to).toPrecision(4)}${reasons.length ? ` (${reasons.join('; ')})` : ''}`,
      }, { src: 'risk', trace: tag });
      this.count('orders'); n++;
    }
    this.gauge('sleeveLegs', n); this.gauge('sleeveRiskPct', +(p.riskPct * 100).toFixed(2)); this.gauge('lastSleeveMs', Date.now() - t0);
    if (skipped.length) this.log.info(`trend sleeve: ${skipped.join(', ')} held by idea trades (one owner per coin)`);
  }

  async watch() {
    const rm = this.riskMode();
    this.gauge('riskMode', rm.mode); this.gauge('budgetScale', rm.budgetScale);
    if (rm.mode !== this.lastMode) {
      this.warn(`risk mode ${this.lastMode} → ${rm.mode}: ${rm.reasons.join('; ')}`);
      if (rm.mode === 'flatten' || rm.mode === 'halt') await this.publish('sys.command', { cmd: 'flatten', by: 'risk', why: rm.reasons.join('; ') }, { src: 'risk' });
      if (rm.mode === 'halt' && !this.halted) { this.halted = true; }
      this.lastMode = rm.mode; this.save();
    }
    await this.publish('risk.state', { ts: this.now(), mode: rm.mode, budgetScale: rm.budgetScale, provenOnly: rm.provenOnly, reasons: rm.reasons, dd: rm.dd || 0, dayLoss: rm.dayLoss || 0, limitsHash: this.riskHash.slice(0, 16) }, { src: 'risk' });
  }

  async onCommand(c, src) {
    // only Ibrahim (through the Herald) can resume after a pause or a halt
    if ((c.cmd === 'resume' || c.cmd === 'unhalt') && !(src === 'herald' && c.by === 'ibrahim')) { this.warn(`ignored ${c.cmd} from ${src}/${c.by}: only Ibrahim can resume`); return; }
    if (c.cmd === 'strategy-mode') {
      // Ibrahim may set any mode; the supervisor/promotion gate (through state-sync) only off/shadow/trade on paper or demo
      const ok = src === 'herald' || (src === 'state-sync' && (this.T.account || 'paper') !== 'live');
      if (!ok || !['off', 'shadow', 'trade'].includes(c.mode) || (isSleeve(c.strategy) && src !== 'herald')) { this.warn(`ignored strategy-mode ${c.strategy}=${c.mode} from ${src}`); return; }
      this.modes[c.strategy] = c.mode; this.save(); await this.bus.kv.set('strategyModes', this.modes);
      this.log.info(`${c.strategy} → ${c.mode} (by ${c.by} via ${src})`);
      return;
    }
    if (c.cmd === 'strategy-forget') {
      // a name listed by mistake (a /mode typo); only Ibrahim, and never a configured strategy
      if (src !== 'herald' || (this.cfg.strategies || {})[c.strategy]) { this.warn(`ignored strategy-forget ${c.strategy} from ${src}`); return; }
      delete this.modes[c.strategy]; this.save(); await this.bus.kv.set('strategyModes', this.modes);
      this.log.info(`${c.strategy} removed from the strategy list (by ${c.by})`);
      return;
    }
    if (c.cmd === 'pause') this.paused = true;
    if (c.cmd === 'resume' || c.cmd === 'unhalt') { this.paused = false; this.halted = false; }
    this.save();
  }
}

module.exports = { Coordinator };
