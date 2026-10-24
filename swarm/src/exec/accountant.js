/* Accountant: the account's money, and each strategy's results.
 *
 * equity = cash (start + closed trades' net) + open positions marked to the last BloFin price.
 * Keeps the peak and the UTC day's starting equity (the risk ladders use both), per-strategy results in R
 * (kv 'strategyResults' — the allocator's input) and totals of fees and funding.
 * Publishes account every 5 s (and kv 'account'). State in <dataDir>/state/accountant.json.
 * Also hosts the execution-cost tracker (exec/cost_tracker.js): `exec.cost` for every fill, kv 'execCost' per coin.
 */
'use strict';
const path = require('path');
const { Agent } = require('../core/agent');
const { readJSON, writeAtomic } = require('../core/fsx');
const { CostTracker } = require('./cost_tracker');

const DAY = 86400000;

class Accountant extends Agent {
  static agentName = 'accountant';
  async onStart() {
    this.X = Object.assign({ account: 'paper', paperEquity: 10000 }, this.cfg.trading || {});
    this.file = path.join(this.ctx.dataDir, 'state', `accountant-${this.X.account}.json`); // paper and demo keep separate books
    const e0 = this.X.paperEquity;
    this.A = readJSON(this.file, { equity0: e0, cash: e0, peak: e0, dayStart: e0, day: Math.floor(this.now() / DAY), fees: 0, funding: 0, trades: 0, wins: 0, results: {}, byStrategy: {} });
    this.open = []; this.last = new Map();
    const pos = await this.bus.kv.get('positions'); if (pos) this.open = pos.open;
    this.subscribe('trade.closed', (m) => this.onTrade(m.data), { durable: true });
    this.subscribe('positions', (m) => { this.open = m.data.open; if (m.data.equity > 0) this.exchangeEquity = m.data.equity; if (this.costs) this.costs.onPositions(m.data.open); });
    this.subscribe('md.ticker', (m) => this.last.set(m.data.coin, m.data.last));
    // implementation shortfall of every fill (decision price → fill price, plus fees)
    this.costs = new CostTracker(); this.costFile = path.join(this.ctx.dataDir, 'state', `costs-${this.X.account}.json`); this.costs.load(readJSON(this.costFile, null));
    this.subscribe('md.book', (m) => this.costs.onBook(m.data));
    this.subscribe('order', (m) => { if (m.src === 'risk') this.costs.onOrder(m.data, this.now()); });
    this.subscribe('exec.fill', (m) => this.onFill(m.data), { durable: true });
    this.every(5000, () => this.snapshot());
    await this.snapshot();
  }
  save() { writeAtomic(this.file, JSON.stringify(this.A)); }
  async onFill(f) {
    const rec = this.costs.onFill(f);
    if (!rec) { this.count('fillsUnjudged'); return; }
    this.count('costRecords'); this.gauge('lastCostBps', rec.costBps);
    await this.publish('exec.cost', rec);
    writeAtomic(this.costFile, JSON.stringify(this.costs.dump()));
    await this.bus.kv.set('execCost', { ts: this.now(), coins: this.costs.model() });
  }
  async onTrade(t) {
    const A = this.A;
    A.cash += t.netUsd; A.fees += t.feeUsd; A.funding += t.fundUsd || 0; A.trades++; if (t.netUsd > 0) A.wins++;
    for (const s of t.strategies || []) {
      const r = (A.results[s.name] = A.results[s.name] || []); r.push(+t.r.toFixed(4)); if (r.length > 300) r.splice(0, r.length - 300);
      const b = (A.byStrategy[s.name] = A.byStrategy[s.name] || { trades: 0, netUsd: 0, sumR: 0, wins: 0 });
      b.trades++; b.netUsd += t.netUsd / t.strategies.length; b.sumR += t.r; if (t.netUsd > 0) b.wins++;
    }
    this.save();
    await this.bus.kv.set('strategyResults', A.results);
    await this.snapshot();
  }
  async snapshot() {
    const A = this.A, now = this.now();
    let upl = 0, gross = 0, openRisk = 0;
    for (const p of this.open) { const px = this.last.get(p.coin) || p.last || p.entry; upl += p.side * (px - p.entry) * p.qty; gross += p.qty * px; openRisk += p.qty * Math.abs(px - p.stop); }
    // on a real (demo/live) account BloFin's own equity is the truth; the first reading sets the starting point
    let equity = A.cash + upl;
    if (this.X.account !== 'paper' && this.exchangeEquity > 0) {
      if (!A.exchangeStart) { A.exchangeStart = this.exchangeEquity; A.equity0 = A.cash = A.peak = A.dayStart = this.exchangeEquity; this.save(); }
      equity = this.exchangeEquity; upl = equity - A.cash;
    }
    const day = Math.floor(now / DAY);
    if (day !== A.day) { A.day = day; A.dayStart = equity; this.save(); }
    // the week (Monday 00:00 UTC), for the weekly loss cap of risk v2 (docs/RISK_V2.md)
    const week = Math.floor((day + 3) / 7);
    if (week !== A.week) { if (A.week != null && A.weekStart > 0) A.lastWeekPct = +(equity / A.weekStart - 1).toFixed(5); A.week = week; A.weekStart = equity; this.save(); }
    if (equity > A.peak) { A.peak = equity; this.save(); }
    const acct = {
      ts: now, mode: this.X.account, equity: +equity.toFixed(2), cash: +A.cash.toFixed(2), upl: +upl.toFixed(2), peak: +A.peak.toFixed(2), dayStart: +A.dayStart.toFixed(2), weekStart: +A.weekStart.toFixed(2), weekPnlPct: +(equity / A.weekStart - 1).toFixed(4), lastWeekPct: A.lastWeekPct != null ? A.lastWeekPct : null,
      dd: +(1 - equity / A.peak).toFixed(4), dayPnlPct: +(equity / A.dayStart - 1).toFixed(4), gross: +gross.toFixed(2), grossX: +(gross / equity).toFixed(3), openRiskPct: +(openRisk / equity).toFixed(4),
      positions: this.open.length, trades: A.trades, winRate: A.trades ? +(A.wins / A.trades).toFixed(3) : null, fees: +A.fees.toFixed(2), funding: +A.funding.toFixed(2), equity0: A.equity0, byStrategy: A.byStrategy,
    };
    await this.bus.kv.set('account', acct);
    await this.publish('account', acct);
    this.gauge('equity', acct.equity); this.gauge('positions', acct.positions);
  }
}

module.exports = { Accountant };
