/* Binance feed agent: reference data from the market's main futures venue (USD-M perpetuals).
 *
 * WebSocket (wss://fstream.binance.com/market/stream — the /market route Binance requires since 2026-04-23):
 *   <sym>@aggTrade      → ref.flow   one message per second with every coin's taker buy/sell volume
 *   <sym>@kline_1m      → ref.bar    closed 1-minute candles with taker-buy volume and trade count
 *   !forceOrder@arr     → ref.liq    liquidations (Binance sends only the latest one per symbol per second,
 *                                    so this is an intensity signal, not a complete count)
 *   !markPrice@arr@1s   → ref.mark   mark, index, funding (every 10 s)
 * REST every 5 minutes: open interest → ref.oi.
 * Prices are converted to BloFin units and sizes to base units with the universe's scale (1000PEPEUSDT → PEPE).
 * Binance is unreachable from some places (e.g. US servers): the agent then reports itself degraded and keeps
 * retrying; trading agents treat Binance-based signals as unavailable (guard.status refOk = false).
 */
'use strict';
const { Agent } = require('../core/agent');
const net = require('../core/net');

class BinanceFeed extends Agent {
  static agentName = 'binance-feed';
  async onStart() {
    this.N = this.cfg.binance; this.http = this.ctx.http || net;
    this.bySym = new Map(); this.coins = new Map(); this.sockets = [];
    this.flow = {}; this.flowSec = 0; this.mark = {}; this.lastMsgAt = 0; this.oiBusy = false;
    this.every(1000, () => this.flushFlow());
    this.every(this.N.markPublishMs || 10000, () => this.flushMark());
    this.every((this.N.oiEveryMin || 5) * 60000, () => this.pollOI());
    this.every(10000, () => this.health());
    const u = await this.bus.kv.get('universe');
    if (u) this.applyUniverse(u);
    this.subscribe('uni.list', (m) => this.applyUniverse(m.data));
  }
  async onStop() { for (const s of this.sockets) s.stop(); this.sockets = []; }

  applyUniverse(u) {
    const next = u.coins.filter((c) => c.binance && c.binance.symbol);
    const key = next.map((c) => c.binance.symbol).sort().join(',');
    this.bySym = new Map(next.map((c) => [c.binance.symbol, { coin: c.coin, scale: c.binance.scale || 1 }]));
    this.coins = new Map(next.map((c) => [c.coin, c]));
    if (key === this.key && this.sockets.length) return;
    this.key = key;
    for (const s of this.sockets) s.stop();
    this.sockets = [];
    if (!next.length) { this.setStatus('degraded', 'no coins with a Binance symbol'); return; }
    const streams = ['!forceOrder@arr', '!markPrice@arr@1s'];
    for (const c of next) { const s = c.binance.symbol.toLowerCase(); streams.push(`${s}@aggTrade`, `${s}@kline_1m`); }
    const per = this.N.streamsPerConn || 80;
    for (let i = 0; i < streams.length; i += per) {
      const sock = new net.KeepAliveSocket({ url: `${this.N.ws}?streams=${streams.slice(i, i + per).join('/')}`, WebSocket: this.ctx.WebSocket, idleMs: 60000, now: this.now, minOpenGapMs: this.ctx.minOpenGapMs == null ? 300 : this.ctx.minOpenGapMs });
      sock.on('message', (t) => this.onMessage(t));
      sock.on('open', () => this.count('opens'));
      sock.on('close', () => this.count('closes'));
      sock.on('error', () => this.count('wsErrors'));
      this.sockets.push(sock.start());
    }
    this.log.info(`subscribed ${next.length} coins, ${streams.length} streams on ${this.sockets.length} connections`);
  }

  onMessage(text) {
    this.lastMsgAt = this.now(); this.count('msgs');
    let m; try { m = JSON.parse(text); } catch (e) { this.count('badJson'); return; }
    const d = m.data || m, st = m.stream || '';
    if (st.endsWith('@aggTrade') || d.e === 'aggTrade') { try { this.onAgg(d); } catch (e) { this.error('aggTrade', e); } return; }
    if (st.startsWith('!markPrice') || Array.isArray(d)) { try { this.onMarks(Array.isArray(d) ? d : [d]); } catch (e) { this.error('markPrice', e); } return; }
    // publishing handlers run one after another; a failure is logged, never thrown out of the socket callback
    this.chain = (this.chain || Promise.resolve()).then(() => {
      if (st.includes('@kline_') || d.e === 'kline') return this.onKline(d);
      if (st.startsWith('!forceOrder') || d.e === 'forceOrder') return this.onLiq(d);
    }).catch((e) => this.error(`handle ${st}`, e));
  }

  onAgg(d) {
    const s = this.bySym.get(d.s); if (!s) return;
    const sec = Math.floor(+d.T / 1000) * 1000;
    const px = +d.p / s.scale, quote = +d.p * +d.q;
    let f = this.flow[s.coin];
    if (!f) f = this.flow[s.coin] = { buyQ: 0, sellQ: 0, n: 0, last: px, hi: px, lo: px };
    if (d.m) f.sellQ += quote; else f.buyQ += quote; // m = buyer is the maker → the taker sold
    f.n++; f.last = px; if (px > f.hi) f.hi = px; if (px < f.lo) f.lo = px;
    if (sec > this.flowSec) this.flowSec = sec;
  }
  // everything received since the last flush (about one second), stamped with its newest trade second
  async flushFlow() {
    const coins = this.flow; this.flow = {};
    if (!Object.keys(coins).length) return;
    for (const k in coins) { const f = coins[k]; f.buyQ = Math.round(f.buyQ); f.sellQ = Math.round(f.sellQ); }
    await this.publish('ref.flow', { ts: this.flowSec || Math.floor(this.now() / 1000) * 1000, coins });
    this.count('flowMsgs');
  }

  async onKline(d) {
    const k = d.k; if (!k || !k.x) return;
    const s = this.bySym.get(k.s || d.s); if (!s) return;
    await this.publish('ref.bar', { coin: s.coin, venue: 'binance', tf: '1m', t: +k.t, o: +k.o / s.scale, h: +k.h / s.scale, l: +k.l / s.scale, c: +k.c / s.scale, v: +k.v * s.scale, q: +k.q, buyQ: +k.Q, n: +k.n });
    this.count('bars');
  }

  async onLiq(d) {
    const o = d.o; if (!o) return;
    const s = this.bySym.get(o.s); if (!s) { this.count('liqOther'); return; }
    const filled = +o.z || +o.q, px = +o.ap || +o.p;
    if (!(filled > 0) || !(px > 0)) return;
    await this.publish('ref.liq', { coin: s.coin, ts: +o.T || +d.E || this.now(), side: o.S === 'SELL' ? 'long' : 'short', px: px / s.scale, qty: filled * s.scale, quote: Math.round(filled * px) });
    this.count('liqs');
  }

  onMarks(arr) {
    for (const x of arr) {
      const s = this.bySym.get(x.s); if (!s) continue;
      this.mark[s.coin] = { mark: +x.p / s.scale, index: +x.i / s.scale, funding: +x.r, nextTs: +x.T, binMark: +x.p };
    }
  }
  async flushMark() {
    if (!Object.keys(this.mark).length) return;
    const coins = {}; for (const k in this.mark) { const { binMark, ...rest } = this.mark[k]; coins[k] = rest; }
    await this.publish('ref.mark', { ts: this.now(), coins });
  }

  async pollOI() {
    if (this.oiBusy || !this.bySym.size) return;
    this.oiBusy = true;
    const coins = {}; let fails = 0;
    try {
      for (const [sym, s] of this.bySym) {
        try {
          const j = await this.http.getJSON(`${this.N.rest}/fapi/v1/openInterest?symbol=${sym}`, { retries: 1 });
          const oi = +j.openInterest, m = this.mark[s.coin];
          coins[s.coin] = { oi: oi * s.scale, oiQ: m ? Math.round(oi * m.binMark) : null };
        } catch (e) { if (++fails >= 3) throw e; }
        if (this.ctx.paceMs !== 0) await net.sleep(this.ctx.paceMs || 100);
      }
      if (Object.keys(coins).length) await this.publish('ref.oi', { ts: this.now(), coins });
    } catch (e) { this.count('oiErrors'); this.log.warn(`open interest: ${e.message}`); }
    finally { this.oiBusy = false; }
  }

  health() {
    const age = this.lastMsgAt ? this.now() - this.lastMsgAt : null;
    this.gauge('lastMsgAgeMs', age); this.gauge('coins', this.bySym.size);
    this.gauge('sockets', `${this.sockets.filter((s) => s.isOpen).length}/${this.sockets.length}`);
    if (!this.bySym.size) return;
    if (age == null || age > 30000) this.setStatus('degraded', age == null ? 'no data from Binance yet (unreachable from here?)' : `no Binance data for ${Math.round(age / 1000)} s`);
    else this.setStatus('ok');
  }
}

module.exports = { BinanceFeed };
