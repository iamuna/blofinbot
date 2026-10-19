/* Data guard: decides, coin by coin, whether the market data is good enough to trade on.
 *
 * A coin is tradable when BloFin data is fresh (book/ticker within 30 s, 1-minute bars arriving), its spread
 * is not wide (≤ 10 bps now) and, when Binance data is available, the two venues agree within 0.5%.
 * Binance freshness is reported separately (refOk): strategies that need it check it themselves.
 * Also watches message lag (local clock vs exchange timestamps) to catch a wrong clock or a slow network.
 * Publishes guard.status on any change and every 30 s; kv 'guard' holds the summary and the 1-hour median
 * spread per coin, which the universe agent uses.
 */
'use strict';
const { Agent } = require('../core/agent');

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

class DataGuard extends Agent {
  static agentName = 'guard';
  async onStart() {
    this.G = this.cfg.guard || {};
    this.c = new Map(); this.lags = []; this.lastPub = 0; this.lastKey = ''; this.universe = new Set();
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
      case 'md.book': { const s = this.st(d.coin); s.bf = t; s.mid = d.mid; s.spread = d.spreadBps; this.sampleSpread(s, t, d.spreadBps); break; }
      case 'md.ticker': { const s = this.st(d.coin); s.bf = t; if (!s.mid) s.mid = (d.bid + d.ask) / 2; this.lag(t - d.ts); break; }
      case 'md.trade': { const s = this.st(d.coin); s.bf = t; break; }
      case 'md.bar': { const s = this.st(d.coin); if (d.t > s.bar) s.bar = d.t; break; }
      case 'ref.flow': for (const [coin, f] of Object.entries(d.coins)) { const s = this.st(coin); s.ref = t; s.refPx = f.last; } this.lag(t - (d.ts + 1000)); break;
      case 'ref.mark': for (const [coin, x] of Object.entries(d.coins)) { const s = this.st(coin); s.ref = Math.max(s.ref, t - 10000); if (!s.refPx) s.refPx = x.mark; } break;
      case 'ref.bar': { const s = this.st(d.coin); s.ref = Math.max(s.ref, t - 30000); s.refPx = s.refPx || d.c; break; }
    }
  }
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
      const med = median(s.spreads.map((x) => x[1]));
      if (med != null) spreads[coin] = +med.toFixed(2);
      coins[coin] = { tradable: reasons.length === 0, refOk, reasons, spreadBps: s.spread, spreadMedBps: med == null ? null : +med.toFixed(2) };
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
