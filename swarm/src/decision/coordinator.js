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
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Agent } = require('../core/agent');
const { fuse } = require('./fusion');
const { Allocator } = require('./allocator');
const { RiskEngine } = require('./risk');
const { readJSON, writeAtomic } = require('../core/fsx');

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
    this.modes = {}; for (const [k, v] of Object.entries(this.cfg.strategies || {})) this.modes[k] = v.enabled === false ? 'off' : v.mode || 'shadow';
    this.queue = []; this.timer = null; this.books = new Map();
    this.account = await this.bus.kv.get('account'); this.positions = (await this.bus.kv.get('positions')) || { open: [], working: [] };
    this.guard = ((await this.bus.kv.get('guard')) || {}).coins || {}; this.events = ((await this.bus.kv.get('events')) || {}).windows || [];
    this.betas = (await this.bus.kv.get('betas')) || {}; this.universe = new Map((((await this.bus.kv.get('universe')) || {}).coins || []).map((c) => [c.coin, c]));
    this.alloc.load((await this.bus.kv.get('strategyResults')) || {});
    this.subscribe('idea', (m) => this.onIdea(m.data));
    this.subscribe('account', (m) => { this.account = m.data; });
    this.subscribe('positions', (m) => { this.positions = m.data; });
    this.subscribe('trade.closed', (m) => { for (const s of m.data.strategies || []) this.alloc.record(s.name, m.data.r); });
    this.subscribe('guard.status', (m) => { this.guard = m.data.coins; });
    this.subscribe('event.window', (m) => { this.events = m.data.windows; });
    this.subscribe('uni.list', (m) => { this.universe = new Map(m.data.coins.map((c) => [c.coin, c])); });
    this.subscribe('md.book', (m) => this.books.set(m.data.coin, m.data));
    this.subscribe('sys.command', (m) => this.onCommand(m.data, m.src));
    this.every(3000, () => this.watch());
    this.every(60000, async () => { this.betas = (await this.bus.kv.get('betas')) || this.betas; });
    this.log.info(`risk limits sha256 ${this.riskHash.slice(0, 16)}…`);
  }
  save() { writeAtomic(this.stateFile, JSON.stringify({ halted: this.halted, paused: this.paused, lastMode: this.lastMode })); }

  onIdea(idea) {
    if (this.modes[idea.strategy] !== 'trade') { this.count('ideasShadow'); return; }
    this.queue.push(idea);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.cycle().catch((e) => this.error('cycle', e)); }, this.T.cycleMs);
  }

  riskMode() { const m = this.risk.mode(this.account, { halted: this.halted, paused: this.paused }); return m; }

  async cycle() {
    const ideas = this.queue.splice(0), t0 = Date.now();
    if (!ideas.length) return;
    const rm = this.riskMode();
    this.alloc.scale = rm.budgetScale;
    const busy = new Set([...(this.positions.open || []), ...(this.positions.working || [])].map((p) => p.coin));
    const budget = (name) => { if (rm.provenOnly && this.alloc.stats(name).n < this.alloc.minTrades) return 0; return this.alloc.budget(name); };
    const { intents, dropped } = fuse(ideas, { busy, budget, maxStackX: this.T.maxStackX });
    for (const d of dropped) this.count('ideasDropped');
    const eq = this.account && this.account.equity;
    const now = this.now(), inWindow = this.events.some((w) => now >= w.start && now <= w.end);
    for (const it of intents) {
      const size = this.alloc.size(it, eq);
      const s = {
        equity: eq, mode: rm.mode, positions: this.positions.open || [], working: this.positions.working || [], inWindow,
        tradable: (c) => !this.guard[c] || this.guard[c].tradable, beta: (c) => (c === 'BTC' ? 1 : this.betas[c]),
        book: (c) => { const b = this.books.get(c); return b && now - b.ts < 30000 ? b : null; }, inst: (c) => this.universe.get(c),
      };
      const d = this.risk.check(it, size, s);
      const intent = Object.assign({}, it, { qty: size ? size.qty : 0, riskUsd: size ? size.riskUsd : 0, equity: eq });
      await this.publish('intent', intent, { trace: it.strategies[0].ideaId });
      await this.publish('risk.decision', { id: it.id, coin: it.coin, verdict: d.verdict, qty: d.qty, reasons: d.reasons, mode: rm.mode }, { src: 'risk', trace: it.strategies[0].ideaId });
      this.count(`risk_${d.verdict}`);
      if (d.verdict === 'reject') continue;
      const inst = this.universe.get(it.coin);
      await this.publish('order', {
        id: `ord-${it.id}`, intentId: it.id, coin: it.coin, instId: inst ? inst.instId : `${it.coin}-USDT`, side: it.side, qty: d.qty, entry: it.entry, stop: it.stop, target: it.target, trail: it.trail,
        timeStopMin: it.timeStopMin, t: it.t, strategies: it.strategies, riskPct: (d.qty * Math.abs(it.entry.px - it.stop)) / eq, why: it.why,
      }, { src: 'risk', trace: it.strategies[0].ideaId });
      this.count('orders');
    }
    this.gauge('lastCycleMs', Date.now() - t0);
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
    if (c.cmd === 'pause') this.paused = true;
    if (c.cmd === 'resume' || c.cmd === 'unhalt') { this.paused = false; this.halted = false; }
    this.save();
  }
}

module.exports = { Coordinator };
