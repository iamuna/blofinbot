/* Data guard: decides, coin by coin, whether the market data is good enough to trade on.
 *
 * A coin is tradable when BloFin data is fresh (book/ticker within 30 s, 1-minute bars arriving), its spread
 * is not wide (≤ 10 bps now) and, when Binance data is available, the two venues agree within 0.5%.
 * Binance freshness is reported separately (refOk): strategies that need it check it themselves.
 * Also watches message lag (local clock vs exchange timestamps) to catch a wrong clock or a slow network.
 * Publishes guard.status on any change and every 30 s; kv 'guard' holds the summary and the 1-hour median
 * spread per coin, which the universe agent uses.
 * Shock (upswarm GUIDE §6.6): a coin whose high/low range over the last 60 one-minute bars exceeds 8 of its daily
 * standard deviations (estimated from its median hourly range over the last 7 days once 48 hours are known; never
 * below 15%; 30% before there is history) is not tradable for new risk for 24 h — exits are never blocked. IRYS on
 * 2026-10-23 (+264% in five hours, then −61% in 15 minutes) would have been. Kept in <dataDir>/state/guard.json.
 */
'use strict';
const path = require('path');
const { Agent } = require('../core/agent');
const { readJSON, writeAtomic } = require('../core/fsx');

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

class DataGuard extends Agent {
  static agentName = 'guard';
  async onStart() {
    this.G = this.cfg.guard || {};
    this.c = new Map(); this.lags = []; this.lastPub = 0; this.lastKey = ''; this.universe = new Set();
    this.shockFile = this.ctx.dataDir ? path.join(this.ctx.dataDir, 'state', 'guard.json') : null;
    this.shocks = (this.shockFile && readJSON(this.shockFile, {}).shocks) || {}; // coin → {until, why}
    const u = await this.bus.kv.get('universe'); if (u) this.onUniverse(u);
    this.subscribe('uni.list', (m) => this.onUniverse(m.data));
    this.subscribe(['md.book', 'md.ticker', 'md.bar', 'md.trade', 'ref.flow', 'ref.mark', 'ref.bar'], (m) => this.onData(m));
    this.every(this.G.evalMs || 5000, () => this.evaluate());
  }
  onUniverse(u) { this.universe = new Set(u.coins.map((c) => c.coin)); }
  st(coin) { let s = this.c.get(coin); if (!s) this.c.set(coin, (s = { bf: 0, bar: 0, ref: 0, mid: null, refPx: null, spread: null, spreads: [] })); return s; }

  onData(m) {
    const t = this.now(), d = m.data;
    switch (m.type) {
      case 'md.book': { const s = this.st(d.coin); s.bf = t; s.mid = d.mid; s.spread = d.spreadBps; this.sampleSpread(s, t, d.spreadBps); if (d.coin === 'BTC') this.lag(t - d.ts); break; } // books are stamped when BloFin builds them; we publish them ≤ 1 s later
      case 'md.ticker': { const s = this.st(d.coin); s.bf = t; if (!s.mid) s.mid = (d.bid + d.ask) / 2; break; } // ticker ts = last trade time, not a latency clock
      case 'md.trade': { const s = this.st(d.coin); s.bf = t; break; }
      case 'md.bar': { const s = this.st(d.coin); if (d.t > s.bar) { s.bar = d.t; this.onBar(d.coin, s, d); } break; }
      case 'ref.flow': for (const [coin, f] of Object.entries(d.coins)) { const s = this.st(coin); s.ref = t; s.refPx = f.last; } break;
      case 'ref.mark': for (const [coin, x] of Object.entries(d.coins)) { const s = this.st(coin); s.ref = Math.max(s.ref, t - 10000); if (!s.refPx) s.refPx = x.mark; } break;
      case 'ref.bar': { const s = this.st(d.coin); s.ref = Math.max(s.ref, t - 30000); s.refPx = s.refPx || d.c; break; }
    }
  }
  // the shock check: last 60 one-minute bars, and each finished hour's range for the coin's normal volatility
  onBar(coin, s, b) {
    const G = this.G, m = (s.mins = s.mins || []);
    if (!(b.h > 0) || !(b.l > 0)) return;
    m.push([b.t, b.h, b.l]); while (m.length && m[0][0] <= b.t - 3600000) m.shift();
    const hour = Math.floor(b.t / 3600000);
    if (s.hour == null) s.hour = hour;
    if (hour !== s.hour) { // the previous hour is complete
      const hr = (s.hrs = s.hrs || []), prev = m.filter((x) => Math.floor(x[0] / 3600000) === s.hour);
      if (prev.length >= 30) { hr.push(Math.max(...prev.map((x) => x[1])) / Math.min(...prev.map((x) => x[2])) - 1); if (hr.length > 168) hr.shift(); }
      s.hour = hour;
    }
    if (m.length < 10) return;
    const range = Math.max(...m.map((x) => x[1])) / Math.min(...m.map((x) => x[2])) - 1;
    const hr = s.hrs || [], known = hr.length >= (G.shockMinHours || 48);
    // Parkinson: an hour's σ ≈ 0.6 × its high/low range; a day's σ ≈ √24 × the hour's
    const daySigma = known ? 0.6 * median(hr) * Math.sqrt(24) : null;
    const limit = known ? Math.max(G.shockMinPct || 0.15, (G.shockSigmas || 8) * daySigma) : (G.shockNoHistoryPct || 0.3);
    if (range > limit) {
      const until = b.t + 60000 + (G.shockHoldH || 24) * 3600000, cur = this.shocks[coin];
      if (!cur || cur.until < until) {
        this.shocks[coin] = { until, why: `${(range * 100).toFixed(0)}% range in an hour (limit ${(limit * 100).toFixed(0)}%)` };
        this.warn(`${coin}: shock — ${this.shocks[coin].why}; no new risk for ${G.shockHoldH || 24} h`);
        this.saveShocks();
      }
    }
  }
  saveShocks() { if (this.shockFile) { try { writeAtomic(this.shockFile, JSON.stringify({ shocks: this.shocks })); } catch (e) { this.log.warn('guard state: ' + e.message); } } }
  sampleSpread(s, t, bps) {
    const a = s.spreads;
    if (a.length && t - a[a.length - 1][0] < 10000) return; // one sample per 10 s
    a.push([t, bps]);
    const cut = t - (this.G.spreadWindowMin || 60) * 60000;
    while (a.length && a[0][0] < cut) a.shift();
  }
  lag(ms) { this.lags.push(ms); if (this.lags.length > 200) this.lags.shift(); }

  async evaluate() {
    const t = this.now(), G = this.G, coins = {}, spreads = {};
    for (const coin of this.universe) {
      const s = this.st(coin), reasons = [];
      if (t - s.bf > (G.blofinStaleMs || 30000)) reasons.push('blofin-stale');
      if (s.bar && t - (s.bar + 60000) > (G.barLateMs || 150000)) reasons.push('bars-missing');
      if (!s.bar && t - this.startedAt > (G.barLateMs || 150000)) reasons.push('no-bars-yet');
      if (s.spread != null && s.spread > (G.pauseSpreadBps || 10)) reasons.push('wide-spread');
      const refOk = t - s.ref < (G.refStaleMs || 30000);
      if (refOk && s.mid && s.refPx && Math.abs(s.mid / s.refPx - 1) * 100 > (G.divergencePct || 0.5)) reasons.push('price-divergence');
      const sh = this.shocks[coin];
      if (sh && sh.until > t) reasons.push('shock');
      else if (sh) { delete this.shocks[coin]; this.saveShocks(); }
      const med = median(s.spreads.map((x) => x[1]));
      if (med != null) spreads[coin] = +med.toFixed(2);
      coins[coin] = Object.assign({ tradable: reasons.length === 0, refOk, reasons, spreadBps: s.spread, spreadMedBps: med == null ? null : +med.toFixed(2) }, sh && sh.until > t ? { shock: sh } : {});
    }
    const lagMed = median(this.lags);
    if (lagMed != null && Math.abs(lagMed) > (G.maxLagMs || 3000)) this.setStatus('degraded', `data arrives ${Math.round(lagMed)} ms after exchange time: check the clock (NTP) or the network`);
    else this.setStatus('ok');
    this.gauge('lagMedMs', lagMed == null ? null : Math.round(lagMed));
    this.gauge('tradable', Object.values(coins).filter((x) => x.tradable).length + '/' + Object.keys(coins).length);
    const key = JSON.stringify(Object.entries(coins).map(([k, v]) => [k, v.tradable, v.refOk, v.reasons.join('|')]));
    if (key !== this.lastKey || t - this.lastPub >= (G.publishEveryMs || 30000)) {
      this.lastKey = key; this.lastPub = t;
      await this.publish('guard.status', { ts: t, coins });
      await this.bus.kv.set('guard', { ts: t, coins, spreads });
    }
  }
}

module.exports = { DataGuard, median };
