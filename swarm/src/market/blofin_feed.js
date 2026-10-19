/* BloFin feed agent: live market data from the exchange we trade on.
 *
 * Public WebSocket channels per coin: trades, books5, candle1m, tickers, funding-rate.
 * Publishes (sizes converted from contracts to base units with each instrument's contractValue):
 *   md.trade   batched every 250 ms per coin   [[ts, px, qtyBase, side]]  side +1 = taker bought
 *   md.book    top 5 levels, at most once a second per coin
 *   md.bar     1-minute candles once BloFin confirms them (a missed confirmation is fetched over REST)
 *   md.ticker  last/bid/ask, at most every 2 s per coin
 *   md.funding on change, and every 10 minutes
 * Coins come from uni.list. Connections hold ≤ coinsPerConn coins each, open ≤ 1 per second (BloFin's limit),
 * send "ping" after 20 s of silence and reconnect after 60 s of silence.
 */
'use strict';
const { Agent } = require('../core/agent');
const net = require('../core/net');

const CHANNELS = ['trades', 'books5', 'candle1m', 'tickers', 'funding-rate'];

class BlofinFeed extends Agent {
  static agentName = 'blofin-feed';
  async onStart() {
    this.B = this.cfg.blofin; this.http = this.ctx.http || net;
    this.coins = new Map(); this.byInst = new Map(); this.sockets = [];
    this.trades = new Map(); this.books = new Map(); this.bookDirty = new Set(); this.tickers = new Map(); this.tickerSent = new Map();
    this.funding = new Map(); this.lastBar = new Map(); this.pendingBar = new Map(); this.samples = new Set(); this.lastMsgAt = 0;
    this.every(this.B.tradeBatchMs || 250, () => this.flushTrades());
    this.every(this.B.bookPublishMs || 1000, () => this.flushBooks());
    this.every(5000, () => { this.gauge('coins', this.coins.size); this.gauge('sockets', this.sockets.filter((s) => s.isOpen).length + '/' + this.sockets.length); this.gauge('lastMsgAgeMs', this.lastMsgAt ? this.now() - this.lastMsgAt : null); });
    const u = await this.bus.kv.get('universe');
    if (u) await this.applyUniverse(u);
    this.subscribe('uni.list', (m) => this.applyUniverse(m.data));
  }
  async onStop() { for (const s of this.sockets) s.stop(); this.sockets = []; }

  async applyUniverse(u) {
    const next = new Map(u.coins.map((c) => [c.coin, c]));
    const same = next.size === this.coins.size && [...next.keys()].every((k) => this.coins.has(k));
    for (const [k, c] of next) { this.coins.set(k, c); this.byInst.set(c.instId, c); } // instrument details may update
    for (const k of [...this.coins.keys()]) if (!next.has(k)) { this.byInst.delete(this.coins.get(k).instId); this.coins.delete(k); }
    if (same && this.sockets.length) return;
    for (const s of this.sockets) s.stop();
    this.sockets = [];
    const list = [...this.coins.values()], per = this.B.coinsPerConn || 12;
    for (let i = 0; i < list.length; i += per) this.sockets.push(this.openSocket(list.slice(i, i + per)));
    this.log.info(`subscribed ${list.length} coins on ${this.sockets.length} connections`);
  }

  openSocket(coins) {
    const s = new net.KeepAliveSocket({ url: this.B.ws, WebSocket: this.ctx.WebSocket, pingText: 'ping', pingAfterMs: 20000, idleMs: 60000, now: this.now, minOpenGapMs: this.ctx.minOpenGapMs });
    s.on('open', () => {
      this.count('opens');
      // one subscribe request per ≤ 3.5 KB of arguments (BloFin's limit is 4096 bytes)
      let args = [];
      const flush = () => { if (args.length) s.send(JSON.stringify({ op: 'subscribe', args })); args = []; };
      for (const c of coins) for (const ch of CHANNELS) { args.push({ channel: ch, instId: c.instId }); if (JSON.stringify(args).length > 3500) { args.pop(); flush(); args.push({ channel: ch, instId: c.instId }); } }
      flush();
    });
    s.on('message', (t) => this.onMessage(t));
    s.on('close', () => this.count('closes'));
    s.on('error', (e) => this.count('wsErrors'));
    return s.start();
  }

  onMessage(text) {
    this.lastMsgAt = this.now(); this.count('msgs');
    let m; try { m = JSON.parse(text); } catch (e) { this.count('badJson'); return; }
    if (m.event) { if (m.event === 'error') this.warn(`BloFin WS error ${m.code}: ${m.msg}`); return; }
    if (!m.arg || !m.data) return;
    const ch = m.arg.channel, c = this.byInst.get(m.arg.instId);
    if (!c) return;
    if (this.B.logSamples && !this.samples.has(ch)) { this.samples.add(ch); this.log.info(`sample ${ch}`, text.slice(0, 800)); }
    const one = (d) => (Array.isArray(d) ? d[0] : d);
    // handlers may be async (they publish); a failure is logged, never thrown out of the socket callback
    this.chain = (this.chain || Promise.resolve()).then(() => {
      if (ch === 'trades') return this.onTrades(c, m.data);
      if (ch === 'books5') return this.onBook(c, one(m.data));
      if (ch === 'candle1m') return this.onCandles(c, m.data);
      if (ch === 'tickers') return this.onTicker(c, one(m.data));
      if (ch === 'funding-rate') return this.onFunding(c, one(m.data));
    }).catch((e) => this.error(`handle ${ch}`, e));
  }

  onTrades(c, rows) {
    let buf = this.trades.get(c.coin); if (!buf) this.trades.set(c.coin, (buf = []));
    for (const t of rows) {
      const px = +t.price, q = +t.size * c.ct;
      if (!(px > 0) || !(q > 0)) continue;
      buf.push([+t.ts, px, q, t.side === 'sell' ? -1 : 1]);
    }
  }
  async flushTrades() {
    for (const [coin, buf] of this.trades) {
      if (!buf.length) continue;
      this.trades.set(coin, []);
      buf.sort((a, b) => a[0] - b[0]);
      await this.publish('md.trade', { coin, trades: buf });
      this.count('trades', buf.length);
    }
  }

  onBook(c, d) {
    if (!d || !d.bids || !d.asks || !d.bids.length || !d.asks.length) return;
    const lv = (a) => a.slice(0, 5).map((x) => [+x[0], +x[1] * c.ct]);
    const bids = lv(d.bids), asks = lv(d.asks), bid = bids[0][0], ask = asks[0][0];
    if (!(bid > 0) || !(ask > 0) || ask < bid) { this.count('badBook'); return; }
    const mid = (bid + ask) / 2;
    this.books.set(c.coin, { coin: c.coin, ts: +d.ts || this.now(), bids, asks, mid, spreadBps: +(((ask - bid) / mid) * 1e4).toFixed(3) });
    this.bookDirty.add(c.coin);
  }
  async flushBooks() {
    const dirty = [...this.bookDirty]; this.bookDirty.clear();
    for (const coin of dirty) await this.publish('md.book', this.books.get(coin));
  }

  // candle rows: [ts, o, h, l, c, vol(contracts), volCurrency(base), volCurrencyQuote, confirm]
  async onCandles(c, rows) {
    for (const r of rows) {
      const ts = +r[0];
      if (String(r[8]) === '1') await this.emitBar(c, r);
      else if (ts > (this.lastBar.get(c.coin) || 0)) {
        const p = this.pendingBar.get(c.coin);
        if (p && p.ts < ts && (this.lastBar.get(c.coin) || 0) < p.ts) this.scheduleFetch(c, p.ts); // a new minute started, the old one is unconfirmed
        this.pendingBar.set(c.coin, { ts, row: r });
      }
    }
  }
  async emitBar(c, r, backfill) {
    const t = +r[0], last = this.lastBar.get(c.coin) || 0;
    if (t <= last) return;
    if (last && t - last > 60000 && !backfill) this.scheduleFetch(c, last + 60000, t - 60000);
    this.lastBar.set(c.coin, t);
    const close = +r[4], v = +r[6] || +r[5] * c.ct, q = +r[7] || v * close;
    const bar = { coin: c.coin, venue: 'blofin', tf: '1m', t, o: +r[1], h: +r[2], l: +r[3], c: close, v, q };
    if (backfill) bar.backfill = true;
    await this.publish('md.bar', bar);
    this.count('bars');
  }
  // BloFin did not confirm a candle over the socket: read the confirmed candles over REST (5 s later)
  scheduleFetch(c, fromTs, toTs) {
    const key = `${c.coin}:${fromTs}`;
    if (this.fetching && this.fetching.has(key)) return;
    (this.fetching = this.fetching || new Set()).add(key);
    setTimeout(async () => {
      try {
        if (!toTs && (this.lastBar.get(c.coin) || 0) >= fromTs) return; // the socket confirmed it meanwhile
        const need = Math.min(300, Math.ceil(((toTs || fromTs) - fromTs) / 60000) + 3);
        const j = await this.http.getJSON(`${this.B.rest}/api/v1/market/candles?instId=${encodeURIComponent(c.instId)}&bar=1m&limit=${need}`);
        if (String(j.code) !== '0') throw new Error(`code ${j.code}`);
        const rows = (j.data || []).filter((r) => String(r[8]) === '1').sort((a, b) => +a[0] - +b[0]);
        for (const r of rows) if (+r[0] >= fromTs && (!toTs || +r[0] <= toTs)) await this.emitBar(c, r, true);
        this.count('restBars', rows.length);
      } catch (e) { this.error(`candles REST ${c.coin}`, e); }
      finally { this.fetching.delete(key); }
    }, this.ctx.restDelayMs == null ? 5000 : this.ctx.restDelayMs);
  }

  async onTicker(c, d) {
    if (!d) return;
    const t = { coin: c.coin, ts: +d.ts || this.now(), last: +d.last, bid: +d.bidPrice, ask: +d.askPrice, bidSz: +d.bidSize * c.ct || 0, askSz: +d.askSize * c.ct || 0, vol24hQ: (+d.volCurrency24h || 0) * +d.last };
    if (!(t.last > 0) || !(t.bid > 0) || !(t.ask > 0)) return;
    this.tickers.set(c.coin, t);
    const sent = this.tickerSent.get(c.coin) || 0;
    if (this.now() - sent >= (this.B.tickerPublishMs || 2000)) { this.tickerSent.set(c.coin, this.now()); await this.publish('md.ticker', t); }
  }

  async onFunding(c, d) {
    if (!d) return;
    const f = { coin: c.coin, ts: this.now(), rate: +d.fundingRate, nextTs: +d.fundingTime };
    if (!Number.isFinite(f.rate) || !Number.isFinite(f.nextTs)) return;
    const prev = this.funding.get(c.coin);
    if (prev && prev.rate === f.rate && prev.nextTs === f.nextTs && f.ts - prev.ts < (this.B.fundingPublishMs || 600000)) return;
    this.funding.set(c.coin, f);
    await this.publish('md.funding', f);
  }
}

module.exports = { BlofinFeed, CHANNELS };
