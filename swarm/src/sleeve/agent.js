/* Trend sleeve agent (docs/TREND_SLEEVE_DESIGN.md): the retired trend bot's portfolio, run on live BloFin candles.
 *
 * Every hour, once BloFin has confirmed the hour's candles (up to 10 minutes' wait, then it goes ahead and says
 * which coins were late): the trend engine (trend_engine.js) recomputes every coin's weight from ~560 days of 1H
 * candles; the sleeve's book (sleeve.js step(), the code the backtest runs) advances by that hour — stops, marks,
 * funding, the risk ladders on its own account, rebalance legs through the RiskEngine — and the agent publishes
 *   sleeve.target  the weights (what a trading sleeve would ask the risk agent for)
 *   sleeve.state   the shadow book: equity, holdings with stops, the hour's legs and their verdicts, statistics,
 *                  and a dry run of the same targets against the live account and the other strategies' positions
 * and keeps the book in kv 'sleeve:trend', so a restart continues it (and catches up the hours it missed).
 *
 * It only ASKS. It sends no order, intent or command and holds no key: on the PC it runs isolated like the brain
 * (core/isolate.js RULES). Whether the sleeve trades is the coordinator's mode 'sleeve:trend' (Ibrahim's /mode): in
 * trade, the coordinator runs plan() on its own state and signs the legs (phase 2 of the design). This agent keeps its
 * shadow book either way, as the evidence the live account is compared with.
 * Universe: the top maxCoins of uni.list by Binance volume (the research used the top 20); a coin that drops out
 * keeps being priced, with weight 0, until the book is flat in it. Funding: settlements seen on md.funding.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { Agent } = require('../core/agent');
const net = require('../core/net');
const E = require('./trend_engine');
const S = require('./sleeve');

const H = 3600, D = 86400;

function readRisk() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'risk.json'), 'utf8')); } catch (e) { return null; }
}

class TrendSleeve extends Agent {
  static agentName = 'trend-sleeve';
  async onStart() {
    const C = (this.C = Object.assign({ enabled: true, mode: 'shadow', maxCoins: 20, historyDays: 560, warmDays: 400, shadowSince: null, settleMin: 1, waitMin: 10, tickMs: 60000, rules: {} }, (this.cfg.sleeves || {}).trend || {}));
    this.mode = 'shadow';
    if (C.enabled === false || C.mode === 'off') { this.off = true; this.setStatus('ok', 'off in config'); return; }
    if (C.mode !== 'shadow') this.warn(`trend sleeve mode "${C.mode}" in the config is ignored: only Ibrahim's /mode sleeve:trend trade makes it trade (the coordinator decides)`);
    this.limits = this.ctx.riskLimits || this.cfg.riskLimits || readRisk();
    if (!this.limits) throw new Error('trend-sleeve needs the risk limits (config/risk.json)');
    this.rules = Object.assign({}, C.rules, { equity0: (this.cfg.trading || {}).paperEquity || 10000 });
    this.http = this.ctx.http || net; this.rest = this.cfg.blofin.rest; this.paceMs = this.ctx.paceMs == null ? 150 : this.ctx.paceMs;
    this.hist = new Map(); this.fund = new Map(); this.fundNext = new Map(); this.inst = new Map(); this.coins = []; this.left = new Map();
    this.doneHour = 0; this.busy = false;
    const saved = await this.bus.kv.get('sleeve:trend');
    this.st = saved && saved.version === 1 && saved.book && saved.ev ? saved : null;
    const u = await this.bus.kv.get('universe'); if (u) this.onUniverse(u);
    this.subscribe('uni.list', (m) => this.onUniverse(m.data));
    this.subscribe('md.funding', (m) => this.onFunding(m.data));
    this.every(C.tickMs, () => this.tick());
  }

  onUniverse(u) {
    const pick = (u.coins || []).filter((c) => c.instId).slice(0, this.C.maxCoins);
    const now = Math.floor(this.now() / 1000), names = new Set(pick.map((c) => c.coin));
    for (const c of pick) { this.inst.set(c.coin, c.instId); this.left.delete(c.coin); }
    // a coin the book still holds stays (priced, weight 0) until the book is flat in it — also after a restart
    for (const c of Object.keys((this.st && this.st.book) || {})) if (!names.has(c) && !this.left.has(c)) this.left.set(c, now);
    this.coins = [...names, ...[...this.left.keys()].filter((c) => !names.has(c))];
    this.gauge('coins', this.coins.length);
  }
  onFunding(f) { // a settlement happened when the next one moves on
    const prev = this.fundNext.get(f.coin);
    this.fundNext.set(f.coin, f);
    if (prev && f.nextTs > prev.nextTs && this.now() >= prev.nextTs) { const a = this.fund.get(f.coin) || []; a.push([Math.floor(prev.nextTs / 1000), prev.rate]); this.fund.set(f.coin, a.slice(-500)); }
  }

  // confirmed BloFin 1H candles, ascending, t in seconds
  async candles(coin, limit, afterMs) {
    const j = await this.http.getJSON(`${this.rest}/api/v1/market/candles?instId=${encodeURIComponent(this.inst.get(coin) || `${coin}-USDT`)}&bar=1H&limit=${limit}${afterMs ? `&after=${afterMs}` : ''}`);
    if (String(j.code) !== '0') throw new Error(`candles ${coin}: code ${j.code}`);
    return (j.data || []).filter((r) => String(r[8]) === '1').map((r) => ({ t: Math.floor(+r[0] / 1000), o: +r[1], h: +r[2], l: +r[3], c: +r[4] })).sort((a, b) => a.t - b.t);
  }
  async load(lastClosed) {
    const want = lastClosed - this.C.historyDays * D;
    for (const coin of this.coins) {
      try {
        let rows = this.hist.get(coin);
        if (!rows) {
          rows = await this.candles(coin, 1440);
          for (let k = 0; k < 20 && rows.length && rows[0].t > want; k++) { // older pages until historyDays (or BloFin's start)
            await net.sleep(this.paceMs);
            const older = (await this.candles(coin, 1440, rows[0].t * 1000)).filter((b) => b.t < rows[0].t);
            if (!older.length) break;
            rows = older.concat(rows);
          }
          this.hist.set(coin, rows); this.count('historyLoaded');
        } else if (!rows.length || rows[rows.length - 1].t < lastClosed) {
          const have = rows.length ? rows[rows.length - 1].t : 0, need = Math.min(1440, Math.ceil((lastClosed - have) / H) + 2);
          for (const b of await this.candles(coin, need)) if (b.t > (rows.length ? rows[rows.length - 1].t : 0) && b.t <= lastClosed) rows.push(b);
        }
        while (rows.length && rows[0].t < want - 7 * D) rows.shift();
        await net.sleep(this.paceMs);
      } catch (e) { this.error(`candles ${coin}`, e); }
    }
  }

  async tick() {
    if (this.off || this.busy || !this.coins.length) return;
    this.busy = true;
    try {
      const now = this.now(), lastClosed = Math.floor(now / 1000 / H) * H - H; // open time of the last closed hour
      if (lastClosed <= this.doneHour || now < (lastClosed + H) * 1000 + this.C.settleMin * 60000) return;
      await this.load(lastClosed);
      const late = this.coins.filter((c) => { const r = this.hist.get(c); return r && r.length > 24 * 30 && r[r.length - 1].t < lastClosed; });
      if (late.length && now < (lastClosed + H) * 1000 + this.C.waitMin * 60000) return; // try again next minute
      await this.compute(lastClosed, late);
      this.doneHour = lastClosed;
    } catch (e) { this.error('tick', e); } finally { this.busy = false; }
  }

  async compute(lastClosed, late) {
    const t0 = Date.now(), C = this.C;
    const coins = this.coins.filter((c) => (this.hist.get(c) || []).length > 24 * 30);
    if (!coins.length) { this.setStatus('starting', 'no coin has 30 days of candles yet'); return; }
    const data = coins.map((coin) => { const r = this.hist.get(coin); return { coin, t: r.map((b) => b.t), o: r.map((b) => b.o), h: r.map((b) => b.h), l: r.map((b) => b.l), c: r.map((b) => b.c), funding: this.fund.get(coin) || [] }; });
    const grid = E.align(data), end = grid.t[grid.n - 1];
    // the weights scale the book to 25% volatility on its own past returns: give them ≥ 90 days to warm up
    const sim = E.simulate(grid, { start: Math.min(grid.t[0] + C.warmDays * D, end - 90 * D), keepWant: true });
    for (const [coin, at] of this.left) { const j = grid.coins.findIndex((g) => g.coin === coin); if (j >= 0) for (let i = 0; i < grid.n; i++) if (grid.t[i] >= at) sim.want[j][i] = 0; }
    // the shadow book: continue the saved one, or start it at shadowSince (flat, paper equity)
    const since = C.shadowSince ? Math.floor(Date.parse(C.shadowSince + 'T00:00:00Z') / 1000) : lastClosed;
    if (this.st && this.st.since !== since) this.st = null;
    const from = Math.max(since, grid.t[1]);
    const r = S.run(grid, sim, Object.assign({}, this.rules, { limits: this.limits, from, state: this.st || undefined }));
    this.st = Object.assign(r.state, { version: 1, since });
    for (const [coin] of this.left) if (!this.st.book[coin]) { this.left.delete(coin); this.coins = this.coins.filter((c) => c !== coin); }
    // what the engine wants now, and the shadow book after the hour
    const i = grid.n - 1, weights = {}, holdings = {}, sq = Math.sqrt(365);
    grid.coins.forEach((g, j) => { if (sim.want[j][i]) weights[g.coin] = +sim.want[j][i].toFixed(5); });
    let gross = 0;
    for (const [coin, p] of Object.entries(this.st.book)) {
      const px = this.st.lastPx[coin], n = p.qty * px; gross += Math.abs(n);
      holdings[coin] = { qty: +p.qty.toPrecision(6), px, notional: +n.toFixed(2), weight: +(n / this.st.eq).toFixed(4), stop: +p.stop.toPrecision(6), stopPct: +((Math.abs(px - p.stop) / px) * 100).toFixed(1) };
    }
    const ts = (end + H) * 1000, last = this.st.last || { legs: [] };
    const legs = (last.legs || []).filter((l) => l.qty || l.verdict === 'reject' || l.kind === 'stop').map((l) => ({ coin: l.coin, kind: l.kind, qty: +(+l.qty).toPrecision(6), px: l.px, stop: l.stop == null ? null : +(+l.stop).toPrecision(6), verdict: l.verdict, reasons: l.reasons }));
    const live = await this.liveCheck(weights, grid, sim, i).catch((e) => { this.error('live check', e); return null; });
    const sm = S.summary(this.st, this.rules);
    // sigma (daily vol) sets the 8σ stops; the coordinator clamps it and checks every limit on its own state
    const sigma = {}; grid.coins.forEach((g, j) => { const v = sim.targets.vols[j][i] / sq; if (v > 0) sigma[g.coin] = +v.toPrecision(5); });
    await this.publish('sleeve.target', { sleeve: 'trend', ts, mode: this.mode, weights, sigma, capitalShare: this.rules.capitalShare, portScale: +sim.portScale.toFixed(3), coins: grid.coins.length, late });
    await this.publish('sleeve.state', {
      sleeve: 'trend', ts, mode: this.mode, since: this.C.shadowSince, equity: +this.st.eq.toFixed(2), equity0: this.rules.equity0, peak: +this.st.peak.toFixed(2), riskMode: this.st.mode,
      holdings, legs, gross: +(gross / this.st.eq).toFixed(3), riskPct: +((last.riskPct || 0) * 100).toFixed(2),
      stats: { days: sm.days, ret: +((sm.final - 1) * 100).toFixed(2), sharpe: sm.days >= 30 ? +sm.sharpe.toFixed(2) : null, maxDD: +(sm.maxDD * 100).toFixed(2), stops: sm.events.stops, legs: sm.events.legs, feesUsd: +this.st.fees.toFixed(2), fundingUsd: +this.st.funding.toFixed(2) },
      liveCheck: live, late, votes: Object.fromEntries(grid.coins.map((g, j) => [g.coin, E.votesAt(sim.targets, j, i)])), vol: Object.fromEntries(grid.coins.map((g, j) => [g.coin, +((sim.targets.vols[j][i] / sq) * 100).toFixed(2)])),
    });
    await this.bus.kv.set('sleeve:trend', this.st);
    this.gauge('equity', +this.st.eq.toFixed(2)); this.gauge('positions', Object.keys(this.st.book).length); this.gauge('lastComputeMs', Date.now() - t0); this.gauge('hour', new Date(ts).toISOString());
    this.log.info(`${new Date(ts).toISOString().slice(0, 13)}h: ${grid.coins.length} coins, ${Object.keys(weights).length} with a weight, shadow equity ${this.st.eq.toFixed(2)}, ${Object.keys(holdings).length} positions, gross ${(gross / this.st.eq).toFixed(2)}×, stop risk ${((last.riskPct || 0) * 100).toFixed(2)}%, ${legs.length} legs (${Date.now() - t0} ms)`);
    this.setStatus('ok', late.length ? `late candles: ${late.join(', ')}` : '');
  }

  // the same targets against the live account and the other strategies' positions: what the risk agent would say
  async liveCheck(weights, grid, sim, i) {
    const acct = await this.bus.kv.get('account');
    if (!acct || !(acct.equity > 0)) return null;
    const pos = (await this.bus.kv.get('positions')) || { open: [], working: [] }, betas = (await this.bus.kv.get('betas')) || {};
    const others = [...(pos.open || []), ...(pos.working || [])].map((p) => ({ coin: p.coin, side: p.side, qty: p.qty, px: p.px, stop: p.stop }));
    const f = acct.equity / this.st.eq, book = {}, mkt = {};
    for (const [c, p] of Object.entries(this.st.book)) book[c] = { qty: p.qty * f, stop: p.stop };
    grid.coins.forEach((g, j) => { if (g.c[i] > 0) mkt[g.coin] = { px: g.c[i], sigma: sim.targets.vols[j][i] / Math.sqrt(365) || 0.05, beta: betas[g.coin], cool: false }; });
    const p = S.plan(weights, book, mkt, acct, this.limits, others, this.rules);
    const n = (v) => p.legs.filter((l) => l.kind !== 'stop' && l.verdict === v).length;
    return { mode: p.mode, approve: n('approve'), trim: n('trim'), reject: n('reject'), reasons: [...new Set(p.legs.flatMap((l) => (l.verdict === 'approve' ? [] : l.reasons)))].slice(0, 8), others: others.length };
  }
}

module.exports = { TrendSleeve };
