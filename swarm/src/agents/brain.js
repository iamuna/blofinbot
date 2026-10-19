/* Brain: hosts the feature factory, the regime agent and the strategy agents in one process, so they share one
 * market state that is identical to the backtester's (analysis/features.js, analysis/regime.js, strategies/).
 *
 * Every closed minute, per coin, one 1-minute bar goes into the feature state: Binance's (with taker flow) when it
 * arrives, else BloFin's (flow from BloFin's own trades). A minute is processed as a batch, BTC first, once every
 * coin's bar is in or 6 s after the first one — the same order the backtester uses.
 * Out: feat.bar (5-minute-and-up bars with features), regime.state (every 15 minutes), idea (each strategy's
 * trade ideas, tagged with its mode), shadow.trade / shadow.end (what each idea would have done, simulated on live
 * bars with the backtester's execution rules — the evidence the promotion gate needs), heartbeats per strategy.
 * Warm-up at start and for new coins: BloFin 1H candles (60 days) for the regime, 7 days of 1-minute candles for
 * the features. Strategies only see live bars.
 */
'use strict';
const { Agent } = require('../core/agent');
const net = require('../core/net');
const { FeatureState } = require('../analysis/features');
const { RegimeState } = require('../analysis/regime');
const { StrategyHost } = require('../strategies/kit');
const strategies = require('../strategies');
const { ExecSim } = require('../backtest/exec_sim');

const MIN = 60000;

class Brain extends Agent {
  static agentName = 'brain';
  async onStart() {
    this.S = this.cfg.strategies || {}; this.BR = this.cfg.brain || {}; this.B = this.cfg.blofin; this.http = this.ctx.http || net;
    this.fs = new FeatureState(); this.regime = new RegimeState();
    this.coins = new Map(); this.guard = {}; this.events = []; this.batches = new Map(); this.flow = new Map(); this.warmed = new Set(); this.warming = false;
    this.hosts = new Map(); this.shadow = new Map(); this.mode = {};
    const list = this.ctx.strategies || strategies.all.concat((this.cfg.extraStrategies || []).map((n) => require(`../strategies/${n}`)));
    for (const s of list) {
      const sc = this.S[s.name] || {};
      if (sc.enabled === false || sc.mode === 'off') continue;
      this.mode[s.name] = sc.mode || 'shadow';
      const host = new StrategyHost(s, { fs: this.fs, regime: this.regime, params: sc.params, tradable: (c) => this.tradable(c, s) });
      this.hosts.set(s.name, host);
      this.shadow.set(s.name, new ExecSim({
        onClose: (idea, res) => { host.onClose(idea.coin, idea.id, res); this.onShadowClose(s.name, idea, res); },
      }));
    }
    Object.assign(this.mode, Object.fromEntries(Object.entries((await this.bus.kv.get('strategyModes')) || {}).filter(([k]) => this.hosts.has(k))));
    this.subscribe('sys.command', (m) => { const c = m.data; if (c.cmd === 'strategy-mode' && this.hosts.has(c.strategy) && (m.src === 'herald' || m.src === 'state-sync')) this.mode[c.strategy] = c.mode; });
    const u = await this.bus.kv.get('universe'); if (u) await this.onUniverse(u);
    const g = await this.bus.kv.get('guard'); if (g) this.guard = g.coins || {};
    const ev = await this.bus.kv.get('events'); if (ev) this.events = ev.windows || [];
    this.subscribe('uni.list', (m) => this.onUniverse(m.data));
    this.subscribe('guard.status', (m) => { this.guard = m.data.coins; });
    this.subscribe('event.window', (m) => { this.events = m.data.windows; });
    this.subscribe(['ref.bar', 'md.bar'], (m) => this.onBar(m));
    this.subscribe('md.trade', (m) => this.onTrades(m.data));
    this.subscribe(['md.funding', 'ref.oi', 'ref.liq', 'md.book'], (m) => this.onContext(m));
    this.every(1000, () => this.flushDue());
    this.every(10000, () => this.strategyHeartbeats());
    this.every(15 * 60000, () => this.publishBetas());
  }

  tradable(coin, s) {
    const g = this.guard[coin];
    if (g && !g.tradable) return false;
    if (s && s.needsRef && g && !g.refOk) return false;
    const now = this.now();
    for (const w of this.events) if (now >= w.start && now <= w.end) return false;
    return true;
  }

  async onUniverse(u) {
    for (const c of u.coins) this.coins.set(c.coin, c);
    for (const k of [...this.coins.keys()]) if (!u.coins.some((c) => c.coin === k)) this.coins.delete(k);
    this.gauge('coins', this.coins.size);
    if (this.BR.warmup !== false) this.warmup().catch((e) => this.error('warmup', e));
  }

  // history from BloFin REST: 60 days of hourly bars (regime) and 7 days of 1-minute bars (features)
  async warmup() {
    if (this.warming) return; this.warming = true;
    try {
      for (const c of this.coins.values()) {
        if (this.warmed.has(c.coin)) continue;
        const get = async (bar, limit, after) => {
          const j = await this.http.getJSON(`${this.B.rest}/api/v1/market/candles?instId=${encodeURIComponent(c.instId)}&bar=${bar}&limit=${limit}${after ? `&after=${after}` : ''}`);
          if (String(j.code) !== '0') throw new Error(`candles ${c.instId} ${bar}: code ${j.code}`);
          return (j.data || []).filter((r) => String(r[8]) === '1').map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] || +r[5] * c.ct, q: +r[7] || 0, bq: null, n: 0 })).sort((a, b) => a.t - b.t);
        };
        try {
          const hours = await get('1H', 1440);
          for (const h of hours.slice(0, -1)) this.regime.onHour(c.coin, h.t, h.c);
          let mins = [], after = null;
          for (let k = 0; k < (this.BR.warmupDays || 7); k++) {
            const page = await get('1m', 1440, after);
            if (!page.length) break;
            mins = page.concat(mins); after = page[0].t;
            await net.sleep(this.ctx.paceMs == null ? 150 : this.ctx.paceMs);
          }
          const s = this.fs.coins.get(c.coin);
          for (const b of mins) if (!s || b.t > s.lastT) for (const e of this.fs.onBar1m(c.coin, b)) this.regime.onEvent(e);
          this.warmed.add(c.coin);
          this.count('warmedCoins');
        } catch (e) { this.error(`warmup ${c.coin}`, e); }
      }
    } finally { this.warming = false; }
  }

  onTrades(d) { // BloFin taker flow per minute (used when Binance has no bar for that minute)
    for (const [ts, px, q, side] of d.trades) {
      const t = Math.floor(ts / MIN) * MIN, k = `${d.coin}:${t}`;
      let f = this.flow.get(k); if (!f) this.flow.set(k, (f = { buy: 0, all: 0 }));
      const quote = px * q; f.all += quote; if (side > 0) f.buy += quote;
    }
  }

  onBar(m) {
    const d = m.data; if (d.tf !== '1m' || !this.coins.has(d.coin)) return;
    let b = this.batches.get(d.t);
    if (!b) { if (d.t <= (this.doneT || 0)) return this.late(m); this.batches.set(d.t, (b = { first: this.now(), bars: new Map() })); }
    const cur = b.bars.get(d.coin) || {};
    if (m.type === 'ref.bar') cur.bin = d; else cur.blo = d;
    b.bars.set(d.coin, cur);
    const refCoins = [...this.coins.values()].filter((c) => c.binance && (!this.guard[c.coin] || this.guard[c.coin].refOk !== false));
    if (refCoins.every((c) => b.bars.get(c.coin) && b.bars.get(c.coin).bin) && [...this.coins.keys()].every((k) => b.bars.has(k))) this.flushMinute(d.t);
  }
  late(m) { // a bar for a minute already processed: use it only if that coin had none
    const d = m.data, s = this.fs.coins.get(d.coin);
    if (s && d.t <= s.lastT) return;
    this.process(d.coin, m.type === 'ref.bar' ? { bin: m.data } : { blo: m.data }, d.t);
  }
  flushDue() { const now = this.now(); for (const [t, b] of this.batches) if (now - b.first >= (this.BR.batchWaitMs || 6000)) this.flushMinute(t); }
  flushMinute(t) {
    const b = this.batches.get(t); if (!b) return;
    this.batches.delete(t); this.doneT = Math.max(this.doneT || 0, t);
    const order = [...b.bars.keys()].sort((x, y) => (x === 'BTC' ? -1 : y === 'BTC' ? 1 : x.localeCompare(y)));
    for (const coin of order) this.process(coin, b.bars.get(coin), t);
    for (const k of this.flow.keys()) if (+k.split(':')[1] < t - 5 * MIN) this.flow.delete(k);
  }

  process(coin, src, t) {
    let bar, from;
    if (src.bin) { const x = src.bin; bar = { t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, q: x.q, bq: x.buyQ, n: x.n }; from = 'binance'; }
    else { const x = src.blo, f = this.flow.get(`${coin}:${t}`); bar = { t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, q: x.q, bq: f && f.all > 0 ? (f.buy / f.all) * x.q : null, n: 0 }; from = 'blofin'; }
    const evs = this.fs.onBar1m(coin, bar);
    this.count(`bars_${from}`);
    // shadow positions see the bar before the strategies decide on it
    for (const sim of this.shadow.values()) sim.onBar(coin, bar);
    for (const ev of evs) {
      this.regime.onEvent(ev);
      if (ev.tf >= 5) this.publish('feat.bar', Object.assign({ src: from }, ev)).catch((e) => this.error('feat.bar', e));
      if (ev.tf === 15 && coin === 'BTC') this.publishRegime(ev.t + 15 * MIN).catch((e) => this.error('regime', e));
    }
    if (!this.warmed.has(coin) && this.BR.warmup !== false) return; // no ideas before the history is loaded
    for (const ev of evs) for (const [name, host] of this.hosts) {
      for (const idea of host.onEvent(ev)) {
        idea.mode = this.mode[name];
        this.shadow.get(name).submit(idea);
        this.publish('idea', idea).catch((e) => this.error('idea', e));
        this.count(`ideas_${name}`);
      }
    }
  }

  async publishBetas() { // for the risk agent's BTC-exposure limit
    const b = {}; for (const c of this.coins.keys()) { const x = this.fs.beta(c); if (Number.isFinite(x)) b[c] = +x.toFixed(3); }
    await this.bus.kv.set('betas', b);
  }
  async publishRegime(ts) {
    const coins = {}; for (const c of this.coins.keys()) coins[c] = this.regime.get(c, ts);
    await this.publish('regime.state', { ts, coins });
  }
  onShadowClose(name, idea, res) {
    if (res.trade) this.publish('shadow.trade', Object.assign({ mode: this.mode[name] }, res.trade)).catch((e) => this.error('shadow.trade', e));
    else this.publish('shadow.end', { id: idea.id, strategy: name, coin: idea.coin, outcome: res.outcome }).catch(() => {});
  }
  onContext(m) {
    const d = m.data;
    if (m.type === 'md.funding') this.fs.onFunding(d.coin, d.rate, d.nextTs);
    else if (m.type === 'ref.oi') for (const [c, x] of Object.entries(d.coins)) this.fs.onOI(c, d.ts, x.oi, x.oiQ);
    else if (m.type === 'ref.liq') this.fs.onLiq(d.coin, d.ts, d.side, d.quote);
    else if (m.type === 'md.book') this.fs.onBook(d.coin, d);
  }
  strategyHeartbeats() {
    for (const [name, host] of this.hosts) {
      const sim = this.shadow.get(name), tr = sim.trades.slice(-500);
      const sumR = tr.reduce((a, t) => a + t.r, 0);
      this.publish('sys.heartbeat', { agent: `strategy:${name}`, pid: process.pid, status: host.stats.errors ? 'degraded' : 'ok', why: host.lastError ? host.lastError.slice(0, 200) : '', startedAt: this.startedAt, metrics: { mode: this.mode[name], ideas: host.stats.ideas, rejected: host.stats.rejected, errors: host.stats.errors, open: sim.open.size, pending: sim.pending.size, shadowTrades: sim.trades.length, shadowSumR: +sumR.toFixed(2), unfilled: sim.unfilled } }).catch(() => {});
      if (sim.trades.length > 2000) sim.trades.splice(0, sim.trades.length - 1000);
    }
  }
}

module.exports = { Brain };
