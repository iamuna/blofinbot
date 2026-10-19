/* Shared market state: multi-timeframe bars and indicators per coin, plus context (funding, open interest,
 * liquidations, book, BTC link). The same code runs live (feature agent) and in backtests, so a strategy sees
 * identical inputs in both.
 *
 * Feed it closed 1-minute bars in time order: onBar1m(coin, {t,o,h,l,c,v,q,bq,n}) returns one event per
 * timeframe that closed with that minute: {coin, tf, t, bar, f}. t = the bar's open time (ms); bq = taker-buy
 * quote volume (Binance), or null when only BloFin data is available (flow features are then null).
 *
 * f (per timeframe): ret, retZ (vs the last 96 returns), atr, atrPct, ema20, ema50, slope20 (ATRs per bar),
 *   volZ, flowShare (taker buys / volume), flowZ, dc20h/dc20l, dc55h/dc55l (channels before this bar), er20,
 *   rv (std of returns, last 96), btcRet (BTC's return on the same bar), beta (to BTC, 1-minute, last day), bars.
 */
'use strict';
const { Ring, RollStat, EMA, ATR, hiLoOf, efficiency } = require('./ta');

const TFS = [1, 3, 5, 15, 30, 45];
const MIN = 60000;

class TfState {
  constructor(tf, keep) {
    this.tf = tf; this.bars = new Ring(keep); this.atr = new ATR(14); this.e20 = new EMA(20); this.e50 = new EMA(50);
    this.rets = new RollStat(96); this.vol = new RollStat(96); this.flow = new RollStat(96); this.cur = null; this.count = 0;
  }
}

class FeatureState {
  constructor(o = {}) {
    this.tfs = o.tfs || TFS; this.keep = o.keep || 400; this.btc = o.btc || 'BTC';
    this.coins = new Map(); this.ctx = new Map(); this.btcLast = new Map(); // tf → {t, ret}
  }
  coin(c) {
    let s = this.coins.get(c);
    if (!s) { s = { tf: new Map(this.tfs.map((k) => [k, new TfState(k, this.keep)])), r1: new Ring(1440), lastT: 0, beta: NaN, betaAt: 0 }; this.coins.set(c, s); }
    return s;
  }
  context(c) { let x = this.ctx.get(c); if (!x) this.ctx.set(c, (x = { funding: null, nextFunding: null, oi: new Ring(300), liq: new Ring(2000), book: null, spreadBps: null, last: null })); return x; }

  onBar1m(coin, b) {
    const s = this.coin(coin);
    if (!(b.t > s.lastT)) return [];
    const prev1 = s.tf.get(1) && s.tf.get(1).bars.last;
    s.lastT = b.t;
    const bar = { t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0, q: +b.q || 0, bq: b.bq == null ? null : +b.bq, n: +b.n || 0 };
    // 1-minute return series for the BTC link
    if (prev1 && b.t - prev1.t === MIN) s.r1.push({ t: b.t, r: Math.log(bar.c / prev1.c) });
    this.context(coin).last = bar.c;
    const out = [];
    for (const [k, st] of s.tf) {
      const span = k * MIN, bucket = Math.floor(b.t / span) * span;
      if (st.cur && st.cur.t !== bucket) { out.push(this.close(coin, st, st.cur, true)); st.cur = null; } // the boundary minute was missing
      if (!st.cur) st.cur = { t: bucket, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: 0, q: 0, bq: bar.bq == null ? null : 0, n: 0, m: 0 };
      const c = st.cur;
      c.h = Math.max(c.h, bar.h); c.l = Math.min(c.l, bar.l); c.c = bar.c; c.v += bar.v; c.q += bar.q; c.n += bar.n; c.m++;
      if (c.bq != null) c.bq = bar.bq == null ? null : c.bq + bar.bq;
      if (b.t + MIN === bucket + span) { out.push(this.close(coin, st, c, false)); st.cur = null; }
    }
    if (coin === this.btc) for (const e of out) this.btcLast.set(e.tf, { t: e.t, ret: e.f.ret, retZ: e.f.retZ, atrPct: e.f.atrPct });
    return out;
  }

  close(coin, st, c, partial) {
    const prev = st.bars.last;
    const bar = { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, q: c.q, bq: c.bq, n: c.n };
    const ret = prev ? Math.log(bar.c / prev.c) : 0;
    const atr = st.atr.push(bar.h, bar.l, bar.c);
    const e20prev = st.e20.v, e20 = st.e20.push(bar.c), e50 = st.e50.push(bar.c);
    const rv = st.rets.std, retZ = rv > 0 ? ret / rv : 0;
    const volZ = st.vol.z(bar.q);
    const flowShare = bar.bq != null && bar.q > 0 ? bar.bq / bar.q : null;
    const flowZ = flowShare != null && st.flow.n > 20 ? st.flow.z(flowShare) : null;
    const d20 = hiLoOf(st.bars, 'h', 'l', 20), d55 = hiLoOf(st.bars, 'h', 'l', 55);
    st.bars.push(bar); st.count++;
    st.rets.push(ret); st.vol.push(bar.q); if (flowShare != null) st.flow.push(flowShare);
    const er20 = efficiency(st.bars, 20);
    const btc = this.btcLast.get(st.tf);
    const f = {
      ret, retZ, atr, atrPct: atr / bar.c, ema20: e20, ema50: e50, slope20: Number.isFinite(e20prev) && atr > 0 ? (e20 - e20prev) / atr : 0,
      volZ, flowShare, flowZ, dc20h: d20.hi, dc20l: d20.lo, dc55h: d55.hi, dc55l: d55.lo, er20, rv,
      btcRet: coin === this.btc ? ret : btc && btc.t === bar.t ? btc.ret : null, beta: this.beta(coin), bars: st.count, partial,
    };
    return { coin, tf: st.tf, t: bar.t, bar, f };
  }

  // beta of the coin's 1-minute returns to BTC's over the last day (refreshed every 15 minutes)
  beta(coin) {
    const s = this.coin(coin);
    if (coin === this.btc) return 1;
    const now = s.lastT;
    if (now - s.betaAt < 15 * MIN && Number.isFinite(s.beta)) return s.beta;
    const b = this.coins.get(this.btc); if (!b) return NaN;
    const map = new Map(); for (const x of b.r1.toArray()) map.set(x.t, x.r);
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const x of s.r1.toArray()) { const y = map.get(x.t); if (y === undefined) continue; n++; sx += y; sy += x.r; sxx += y * y; sxy += y * x.r; }
    s.betaAt = now;
    if (n < 240) return (s.beta = NaN);
    const v = sxx / n - (sx / n) ** 2;
    return (s.beta = v > 0 ? (sxy / n - (sx / n) * (sy / n)) / v : NaN);
  }

  // ── context from other feeds
  onFunding(coin, rate, nextTs) { const x = this.context(coin); x.funding = rate; x.nextFunding = nextTs; }
  onOI(coin, t, oi, oiQ) { const x = this.context(coin); const last = x.oi.last; if (!last || t > last.t) x.oi.push({ t, oi, oiQ }); }
  onLiq(coin, t, side, quote) { this.context(coin).liq.push({ t, side, quote }); }
  onBook(coin, book) { const x = this.context(coin); x.book = book; x.spreadBps = book.spreadBps; }
  // open-interest change over the last `min` minutes (fraction), null without data
  oiChange(coin, now, min = 60) {
    const r = this.context(coin).oi; if (!r.len) return null;
    const last = r.last; let base = null;
    for (let k = 0; k < r.len; k++) { const x = r.at(k); if (x.t <= now - min * MIN) { base = x; break; } }
    return base && base.oi > 0 && now - last.t < 20 * MIN ? last.oi / base.oi - 1 : null;
  }
  // liquidated notional in the last `min` minutes: {long, short}
  liqSum(coin, now, min = 5) {
    const r = this.context(coin).liq, out = { long: 0, short: 0 };
    for (let k = 0; k < r.len; k++) { const x = r.at(k); if (x.t < now - min * MIN) break; out[x.side] += x.quote; }
    return out;
  }
  bookImbalance(coin) {
    const b = this.context(coin).book; if (!b) return null;
    const bq = b.bids.reduce((a, x) => a + x[0] * x[1], 0), aq = b.asks.reduce((a, x) => a + x[0] * x[1], 0);
    return bq + aq > 0 ? (bq - aq) / (bq + aq) : null;
  }
  history(coin, tf) { const s = this.coins.get(coin); return s ? s.tf.get(tf).bars : null; }
}

module.exports = { FeatureState, TFS };
