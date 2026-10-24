/* Portfolio agent (upswarm GUIDE §6, Phase 2): the portfolio constructor and the conductor running in SHADOW next to
 * the coordinator. Every hour it builds the one book the swarm would hold if the portfolio core traded — the trend
 * sleeve's weights plus every open idea of the strategies in trade, through the adapter — sizes it with the
 * conductor's dial, caps volatility and correlated groups, and advances a simulated book (sleeve.js step(): stops on
 * the hour's high/low, marks, the risk ladders, legs through the RiskEngine, costs). It publishes
 *   portfolio.target  the book it wants (USD per coin, and which sleeve asked for what), the dial and the reasons
 *   portfolio.state   the shadow book: equity, holdings, the hour's legs, statistics, the conductor's state
 * and keeps everything in kv 'portfolio' across restarts. It sends no order, intent or command: the coordinator
 * keeps trading as before. After two weeks the shadow book is compared with the paper account and the backtests
 * (GUIDE §12 Phase 2), and switching the book to trade is Ibrahim's call.
 *
 * Prices: BloFin 1-minute bars (md.bar) rolled into hours. Volatility: the trend sleeve's daily σ for its coins, else
 * the coin's daily closes (seeded from BloFin's 1D candles, then kept from the hours), else 5% a day.
 * Not yet in the shadow book: funding payments (small for 1h–1d holding times).
 */
'use strict';
const fs = require('fs'), path = require('path');
const { Agent } = require('../core/agent');
const net = require('../core/net');
const S = require('../sleeve/sleeve');
const PC = require('./constructor');
const CD = require('./conductor');

const H = 3600, D = 86400, HMS = 3600000, DMS = 86400000;

function readRisk() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'risk.json'), 'utf8')); } catch (e) { return null; } }

class PortfolioAgent extends Agent {
  static agentName = 'portfolio';
  async onStart() {
    const C = (this.C = Object.assign({ enabled: true, settleMin: 12, tickMs: 60000, closeDays: 90, seed: true, shares: {}, expect: {}, rules: {}, conductor: {} }, this.cfg.portfolio || {}));
    if (C.enabled === false) { this.off = true; this.setStatus('ok', 'off in config'); return; }
    this.limits = this.ctx.riskLimits || this.cfg.riskLimits || readRisk();
    if (!this.limits) throw new Error('portfolio needs the risk limits (config/risk.json)');
    const sleeveRules = ((this.cfg.sleeves || {}).trend || {}).rules || {};
    // the whole account is the capital base; the book may use all of maxOpenRiskPct (the sleeve alone used half)
    this.rules = PC.planRules(sleeveRules, Object.assign({ riskShare: 1, equity0: (this.cfg.trading || {}).paperEquity || 10000 }, C.rules));
    this.crules = Object.assign({}, CD.RULES, { volTarget: this.rules.portVolTargetPct || PC.RULES.portVolTargetPct }, C.conductor, this.riskV2());
    this.http = this.ctx.http || net; this.rest = (this.cfg.blofin || {}).rest; this.paceMs = this.ctx.paceMs == null ? 150 : this.ctx.paceMs;
    const saved = await this.bus.kv.get('portfolio');
    this.P = saved && saved.version === 1 && saved.st ? saved : { version: 1, st: S.newState(this.rules), closes: {}, cusum: {}, daySum: {}, doneHour: 0, ideas: {} };
    this.hours = new Map(); // coin → Map(hourMs → {o, h, l, c})
    this.trend = null; this.modes = (await this.bus.kv.get('strategyModes')) || {}; this.seeded = new Set(); this.busy = false;
    this.subscribe('sleeve.target', (m) => { if (m.src === 'trend-sleeve' && m.data.sleeve === 'trend') this.trend = m.data; });
    this.subscribe('idea', (m) => this.onIdea(m.data));
    this.subscribe(['shadow.trade', 'shadow.end'], (m) => this.onShadowEnd(m.type, m.data));
    this.subscribe('md.bar', (m) => this.onBar(m.data));
    this.subscribe('sleeve.state', (m) => { if (m.src === 'trend-sleeve' && m.data.sleeve === 'trend') this.onSleeveState(m.data); });
    this.every(C.tickMs, () => this.tick());
  }
  // risk v2 keys (docs/RISK_V2.md) in the signed risk.json override the conductor's defaults
  riskV2() { const L = this.limits || {}, o = {}; for (const k of ['weekLossStopPct', 'weekLossHalvePct']) if (Number.isFinite(L[k])) o[k] = L[k]; if (Number.isFinite(L.portVolTargetPct)) o.volTarget = L.portVolTargetPct; return o; }
  save() { return this.bus.kv.set('portfolio', this.P); }

  onIdea(i) {
    if (!i || !i.id || !i.coin) return;
    const life = ((i.entry && i.entry.waitMin) || 10) + (i.timeStopMin || 0) + 60; // a failsafe in case the end is missed
    this.P.ideas[i.id] = { id: i.id, strategy: i.strategy, coin: i.coin, side: i.side, entry: { px: i.entry && i.entry.px }, stop: i.stop, t: i.t || this.now(), until: (i.t || this.now()) + life * 60000 };
  }
  onShadowEnd(type, d) {
    if (d && d.id) delete this.P.ideas[d.id];
    // each strategy's shadow R by UTC day, for its CUSUM
    if (type === 'shadow.trade' && d && d.strategy && Number.isFinite(d.r)) { const day = Math.floor((d.exitT || this.now()) / DMS), s = (this.P.daySum[d.strategy] = this.P.daySum[d.strategy] || {}); s[day] = (s[day] || 0) + d.r; }
  }
  onSleeveState(d) { // the trend sleeve's shadow equity by UTC day (its own book), for its CUSUM
    const day = Math.floor(d.ts / DMS), s = (this.P.daySum['sleeve:trend'] = this.P.daySum['sleeve:trend'] || {});
    s[`eq${day}`] = d.equity;
  }
  onBar(b) {
    if (!b || b.tf !== '1m' || !(b.c > 0)) return;
    const hk = Math.floor(b.t / HMS) * HMS;
    let m = this.hours.get(b.coin); if (!m) this.hours.set(b.coin, (m = new Map()));
    const x = m.get(hk);
    if (!x) m.set(hk, { o: b.o, h: b.h, l: b.l, c: b.c, last: b.t });
    else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); if (b.t >= x.last) { x.c = b.c; x.last = b.t; } }
    for (const k of m.keys()) if (k < hk - 6 * HMS) m.delete(k);
  }

  async seedCloses(coins) {
    if (!this.C.seed || !this.rest) return;
    for (const c of coins) {
      if (this.seeded.has(c) || (this.P.closes[c] && Object.keys(this.P.closes[c]).length >= 60)) { this.seeded.add(c); continue; }
      this.seeded.add(c);
      try {
        const j = await this.http.getJSON(`${this.rest}/api/v1/market/candles?instId=${encodeURIComponent(`${c}-USDT`)}&bar=1D&limit=${this.C.closeDays + 1}`);
        if (String(j.code) !== '0') continue;
        const cl = (this.P.closes[c] = this.P.closes[c] || {});
        for (const r of j.data || []) if (String(r[8]) === '1') cl[Math.floor(+r[0] / DMS)] = +r[4];
        await net.sleep(this.paceMs);
      } catch (e) { this.error(`daily candles ${c}`, e); }
    }
  }
  // daily log returns per coin, and daily σ
  returnsOf(coins) {
    const out = {}, sigma = {};
    for (const c of coins) {
      const cl = this.P.closes[c]; if (!cl) continue;
      const days = Object.keys(cl).map(Number).sort((a, b) => a - b).slice(-this.C.closeDays - 1), rs = [];
      for (let k = 1; k < days.length; k++) if (days[k] === days[k - 1] + 1 && cl[days[k]] > 0 && cl[days[k - 1]] > 0) rs.push([days[k], Math.log(cl[days[k]] / cl[days[k - 1]])]);
      out[c] = rs;
      if (rs.length >= 20) { const m = rs.reduce((a, x) => a + x[1], 0) / rs.length; sigma[c] = Math.sqrt(rs.reduce((a, x) => a + (x[1] - m) ** 2, 0) / (rs.length - 1)); }
    }
    return { returns: out, sigma };
  }

  async tick() {
    if (this.off || this.busy) return;
    const now = this.now(), hour = Math.floor(now / HMS) * HMS - HMS; // the last closed hour's open (ms)
    if (hour <= this.P.doneHour || now < hour + HMS + this.C.settleMin * 60000) return;
    this.busy = true;
    try { await this.beat(hour); this.P.doneHour = hour; await this.save(); }
    catch (e) { this.error('beat', e); }
    finally { this.busy = false; }
  }

  // one hour: targets → conductor → constructor → the shadow book's step
  async beat(hour) {
    const t0 = Date.now(), P = this.P, st = P.st;
    this.modes = (await this.bus.kv.get('strategyModes')) || this.modes;
    for (const [id, i] of Object.entries(P.ideas)) if (i.until < this.now()) delete P.ideas[id];
    // ideas (and their shadow ends) arrive as they happen; the book is decided at the hour's close
    const ideas = Object.values(P.ideas).filter((i) => this.modes[i.strategy] === 'trade');
    const trendOn = this.trend && this.trend.ts >= hour && this.modes['sleeve:trend'] !== 'off';
    const coins = new Set([...Object.keys(st.book), ...ideas.map((i) => i.coin), ...(trendOn ? Object.keys(this.trend.weights || {}) : [])]);
    await this.seedCloses([...coins]);
    // the hour's prices, and the day's closes from them
    const hc = {};
    for (const c of coins) { const x = this.hours.get(c) && this.hours.get(c).get(hour); if (x) { hc[c] = x; (P.closes[c] = P.closes[c] || {})[Math.floor(hour / DMS)] = x.c; } }
    for (const cl of Object.values(P.closes)) { const ks = Object.keys(cl).map(Number).sort((a, b) => a - b); for (const k of ks.slice(0, Math.max(0, ks.length - this.C.closeDays - 2))) delete cl[k]; }
    const R = this.returnsOf([...coins]), sigma = Object.assign({}, R.sigma, (trendOn && this.trend.sigma) || {});
    // sleeves → USD per coin (sized on the shadow book's equity)
    const sleeves = PC.ideaTargets(ideas, st.eq, this.rules);
    if (trendOn) { const t = (sleeves['sleeve:trend'] = {}), cap = (this.trend.capitalShare || 0.5) * st.eq; for (const [c, w] of Object.entries(this.trend.weights)) t[c] = w * cap; }
    // the conductor: CUSUM per sleeve on yesterday's result, the dial from the book's own days
    const cond = this.conduct(Object.keys(sleeves), hour);
    const comb = PC.combine(sleeves, { equity: st.eq, shares: cond.shares, dial: cond.dial, sigma, returns: R.returns, rules: this.rules });
    const w = PC.weightsOf(comb.book, st.eq), betas = (await this.bus.kv.get('betas')) || {};
    // the weekly loss cap: no new risk — every coin at most what is held now, on the same side
    if (cond.noNew) for (const c of new Set([...Object.keys(w), ...Object.keys(st.book)])) {
      const px = st.lastPx[c], held = st.book[c] && px > 0 ? (st.book[c].qty * px) / st.eq : 0, x = w[c] || 0;
      w[c] = Math.sign(x) === Math.sign(held) ? Math.sign(held) * Math.min(Math.abs(x), Math.abs(held)) : 0;
    }
    const h = { t: Math.floor(hour / 1000), coins: {} };
    for (const c of new Set([...coins, ...Object.keys(w)])) {
      const x = hc[c];
      h.coins[c] = x ? { o: x.o, h: x.h, l: x.l, c: x.c, pc: NaN, fund: 0, w: w[c] || 0, sigma: sigma[c] > 0 ? sigma[c] : 0.05, beta: c === 'BTC' ? 1 : betas[c] } : { o: NaN, h: NaN, l: NaN, c: NaN, pc: NaN, fund: 0, w: 0, sigma: 0.05 };
    }
    const res = S.step(st, h, { limits: this.limits, rules: this.rules, haltForever: false });
    const ts = hour + HMS, r2 = (x) => +(+x).toFixed(2);
    const legs = (res.legs || []).filter((l) => l.qty || l.verdict === 'reject' || l.kind === 'stop').map((l) => ({ coin: l.coin, kind: l.kind, qty: +(+l.qty).toPrecision(6), px: l.px, stop: l.stop == null ? null : +(+l.stop).toPrecision(6), verdict: l.verdict, reasons: l.reasons }));
    const holdings = {};
    for (const [c, p] of Object.entries(st.book)) { const px = st.lastPx[c]; if (px > 0) holdings[c] = { qty: +p.qty.toPrecision(6), notional: r2(p.qty * px), stop: +p.stop.toPrecision(6) }; }
    const sm = S.summary(st, this.rules);
    await this.publish('portfolio.target', { ts, book: Object.fromEntries(Object.entries(comb.book).map(([c, n]) => [c, r2(n)])), bySleeve: comb.bySleeve, dial: cond.dial, shares: cond.shares, vol: +(comb.vol * 100).toFixed(2), volBefore: +(comb.volBefore * 100).toFixed(2), clusters: comb.clusterOf, reasons: [...cond.reasons, ...comb.reasons], ideas: ideas.length, trend: !!trendOn });
    await this.publish('portfolio.state', { ts, mode: 'shadow', equity: r2(st.eq), equity0: this.rules.equity0, riskMode: st.mode, holdings, legs, riskPct: r2((res.riskPct || 0) * 100),
      stats: { days: sm.days, ret: r2((sm.final - 1) * 100), maxDD: r2(sm.maxDD * 100), stops: sm.events.stops, legs: sm.events.legs, feesUsd: r2(st.fees) }, conductor: cond });
    this.gauge('equity', r2(st.eq)); this.gauge('positions', Object.keys(st.book).length); this.gauge('dial', cond.dial); this.gauge('lastBeatMs', Date.now() - t0);
    this.setStatus('ok', cond.noNew ? 'weekly loss cap: no new risk until Monday' : '');
  }

  conduct(names, hour) {
    const P = this.P, day = Math.floor(hour / DMS), shares = {}, alarms = {}, reasons = [];
    for (const n of names) {
      const exp = this.C.expect[n], src = P.daySum[n] || {};
      let r = null;
      if (n === 'sleeve:trend') { const a = src[`eq${day - 1}`], b = src[`eq${day - 2}`]; if (a > 0 && b > 0) r = a / b - 1; }
      else r = src[day - 1] || 0; // a day without a closed trade is 0
      if (exp) { const out = CD.cusumStep(P.cusum[n], day - 1, r, exp, this.crules); P.cusum[n] = out.state; if (out.alarm) reasons.push(`${n}: CUSUM alarm (results below what its backtest expects)`); }
      const s = CD.shareOf(this.C.shares[n] != null ? this.C.shares[n] : 1, P.cusum[n], hour + HMS, this.crules);
      shares[n] = s.share; alarms[n] = s.alarms; if (s.shadow) reasons.push(`${n}: two CUSUM alarms in ${this.crules.alarmWindowDays} days — proposed for shadow`);
    }
    for (const s of Object.values(P.daySum)) for (const k of Object.keys(s)) { const d = +String(k).replace('eq', ''); if (d < day - 120) delete s[k]; }
    // the week, on the shadow book's daily returns (Monday 00:00 UTC)
    const ws = Math.floor(CD.weekStart(hour) / DMS), daily = P.st.daily || [];
    const sum = (a, b) => daily.filter((x) => x[0] >= a && x[0] < b).reduce((acc, x) => acc + x[1], 0);
    const weekPct = sum(ws, day + 1) + (P.st.dayStart > 0 ? P.st.eq / P.st.dayStart - 1 : 0), lastPct = daily.some((x) => x[0] >= ws - 7 && x[0] < ws) ? sum(ws - 7, ws) : null;
    const d = CD.dial({ daily, ladderScale: 1, week: { pnlPct: weekPct, lastPct }, rules: this.crules }); // the drawdown ladder is applied by the planner
    return { dial: d.dial, noNew: d.noNew, realisedVol: d.realisedVol, week: { pnlPct: +weekPct.toFixed(5), lastPct }, shares, alarms, reasons: d.reasons.concat(reasons) };
  }
}

module.exports = { PortfolioAgent };
