/* High-frequency (1-minute) strategy backtester with conservative limit-order fills.
 *
 * Fill model (deliberately pessimistic):
 *  - Limit orders are placed at a bar's close and work from the NEXT bar. A buy limit at P fills only if
 *    a later bar trades at least one tick BELOW P (low <= P - tick); sells mirror. Touching is not filling.
 *  - Fill price = the limit price (no price improvement credited).
 *  - On the bar an entry fills, only the stop can trigger (the target cannot), and if the stop is inside
 *    that bar's range it is assumed hit.
 *  - After that, when stop and target are both inside one bar, the stop is assumed first.
 *  - Targets are resting limit orders: maker fee, must also trade through by a tick.
 *  - Stops, time exits and market entries pay taker fee + slippage.
 * Returns are measured per trade in basis points of notional, and on an account trading 1× notional.
 */
'use strict';
const fs = require('fs');

function loadHF(path, fromIso, toIso) {
  const size = fs.statSync(path).size, rows = size / 64;
  const buf = fs.readFileSync(path);
  const f = new Float64Array(buf.buffer, buf.byteOffset, rows * 8);
  const from = fromIso ? Date.parse(fromIso) / 1000 : -Infinity, to = toIso ? Date.parse(toIso) / 1000 : Infinity;
  let a = 0; while (a < rows && f[a * 8] < from) a++;
  let b = a; while (b < rows && f[b * 8] < to) b++;
  const n = b - a, D = { n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), nt: new Float64Array(n), tb: new Float64Array(n), cache: new Map() };
  for (let i = 0; i < n; i++) { const k = (a + i) * 8; D.t[i] = f[k]; D.o[i] = f[k + 1]; D.h[i] = f[k + 2]; D.l[i] = f[k + 3]; D.c[i] = f[k + 4]; D.v[i] = f[k + 5]; D.nt[i] = f[k + 6]; D.tb[i] = f[k + 7]; }
  return D;
}
function slice(D, a, b) {
  const S = { n: b - a, cache: new Map() };
  for (const k of ['t', 'o', 'h', 'l', 'c', 'v', 'nt', 'tb']) S[k] = D[k].subarray(a, b);
  return S;
}
const memo = (D, k, fn) => { let v = D.cache.get(k); if (v === undefined) { v = fn(); D.cache.set(k, v); } return v; };
const nan = (n) => new Float64Array(n).fill(NaN);

// ───────────── features (all causal)
function ema(D, n) { return memo(D, 'ema' + n, () => { const o = nan(D.n), k = 2 / (n + 1); let e = D.c[0]; for (let i = 0; i < D.n; i++) { e = i ? D.c[i] * k + e * (1 - k) : D.c[0]; if (i >= n) o[i] = e; } return o; }); }
function sma(D, n) { return memo(D, 'sma' + n, () => { const o = nan(D.n); let s = 0; for (let i = 0; i < D.n; i++) { s += D.c[i]; if (i >= n) s -= D.c[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }); }
function sd(D, n) { return memo(D, 'sd' + n, () => { const o = nan(D.n); let s = 0, s2 = 0; for (let i = 0; i < D.n; i++) { const x = D.c[i]; s += x; s2 += x * x; if (i >= n) { const y = D.c[i - n]; s -= y; s2 -= y * y; } if (i >= n - 1) { const m = s / n; o[i] = Math.sqrt(Math.max(1e-9, s2 / n - m * m)); } } return o; }); }
function atr(D, n) { return memo(D, 'atr' + n, () => { const o = nan(D.n); let a = 0; for (let i = 1; i < D.n; i++) { const tr = Math.max(D.h[i] - D.l[i], Math.abs(D.h[i] - D.c[i - 1]), Math.abs(D.l[i] - D.c[i - 1])); a = i <= n ? a + tr / n : (a * (n - 1) + tr) / n; if (i >= n) o[i] = a; } return o; }); }
// taker-flow imbalance over k bars: (buy - sell) / total, in [-1, 1]
function imb(D, k) { return memo(D, 'imb' + k, () => { const o = nan(D.n); let b = 0, v = 0; for (let i = 0; i < D.n; i++) { b += D.tb[i]; v += D.v[i]; if (i >= k) { b -= D.tb[i - k]; v -= D.v[i - k]; } if (i >= k - 1 && v > 0) o[i] = (2 * b - v) / v; } return o; }); }
// trend slope of EMA(n) over 30 bars, in ATR(60) units
function slope(D, n) { return memo(D, 'slope' + n, () => { const e = ema(D, n), a = atr(D, 60), o = nan(D.n); for (let i = 30; i < D.n; i++) if (!isNaN(e[i - 30]) && a[i] > 0) o[i] = (e[i] - e[i - 30]) / a[i]; return o; }); }
// volatility regime: ATR(60)/close relative to its 1-day average
function volRatio(D) { return memo(D, 'vr', () => { const a = atr(D, 60), o = nan(D.n); let s = 0, q = 0; const W = 1440; const r = new Float64Array(D.n); for (let i = 0; i < D.n; i++) { r[i] = a[i] / D.c[i]; } for (let i = 0; i < D.n; i++) { if (!isNaN(r[i])) { s += r[i]; q++; } if (i >= W && !isNaN(r[i - W])) { s -= r[i - W]; q--; } if (q > 200) o[i] = r[i] / (s / q); } return o; }); }

// ───────────── strategy families → per-bar order intents
// Each family returns a function intent(i) → null | {dir, kind:'limit'|'market', px, ttl, tp, sl, hold}
function family(D, p) {
  const tick = 0.1;
  if (p.fam === 'mr') {
    // mean reversion: price stretched z·σ from its n-bar mean → limit order further out, target back toward the mean
    const m = sma(D, p.n), s = sd(D, p.n), I = p.imbK ? imb(D, p.imbK) : null, sl = p.trendN ? slope(D, p.trendN) : null, vr = p.vol ? volRatio(D) : null;
    return (i) => {
      const mi = m[i], si = s[i]; if (isNaN(mi) || !(si > 0)) return null;
      const z = (D.c[i] - mi) / si;
      let dir = 0; if (z <= -p.z) dir = 1; else if (z >= p.z) dir = -1;
      if (!dir || (p.side === 'long' && dir < 0) || (p.side === 'short' && dir > 0)) return null;
      if (I && !(dir > 0 ? I[i] <= -p.imbT : I[i] >= p.imbT)) return null; // fade only when aggressive flow was against us (exhaustion)
      if (sl && !p.trendDir && Math.abs(sl[i]) > p.trendMax) return null; // skip strong trends
      if (sl && p.trendDir && (isNaN(sl[i]) || Math.sign(sl[i]) * p.trendDir !== dir || Math.abs(sl[i]) < p.trendMin)) return null; // 1: buy dips only in uptrends (and sell rips in downtrends); -1: the opposite
      if (vr && (p.vol === 'calm' ? vr[i] > 1 : vr[i] < 1)) return null;
      const px = D.c[i] - dir * p.off * si;
      const tp = p.tpMode === 'mean' ? mi + dir * 0 : px * (1 + dir * p.tpBps / 1e4);
      const slp = px * (1 - dir * p.slBps / 1e4);
      if (p.tpMode === 'mean' && (tp - px) * dir < px * 3e-4) return null; // target must be at least 3 bps away
      return { dir, kind: 'limit', px: Math.round(px / tick) * tick, ttl: p.ttl, tp, sl: slp, hold: p.hold };
    };
  }
  if (p.fam === 'grid') {
    // two-sided quotes around a fast fair value; take one fill at a time, exit one spacing away
    const fv = ema(D, p.n), sl = p.trendN ? slope(D, p.trendN) : null, vr = p.vol ? volRatio(D) : null;
    let flip = 0;
    return (i) => {
      const f = fv[i]; if (isNaN(f)) return null;
      if (sl && Math.abs(sl[i]) > p.trendMax) return null;
      if (vr && (p.vol === 'calm' ? vr[i] > 1 : vr[i] < 1)) return null;
      // quote the side the price is currently further from fair value (lean against the move)
      let dir = D.c[i] > f ? -1 : D.c[i] < f ? 1 : (flip ^= 1) ? 1 : -1;
      if ((p.side === 'long' && dir < 0) || (p.side === 'short' && dir > 0)) return null;
      const px = f - dir * f * p.sBps / 1e4;
      if ((dir > 0 && px >= D.c[i]) || (dir < 0 && px <= D.c[i])) return null; // must rest away from price
      return { dir, kind: 'limit', px: Math.round(px / tick) * tick, ttl: p.ttl, tp: px * (1 + dir * p.tpBps / 1e4), sl: px * (1 - dir * p.slBps / 1e4), hold: p.hold };
    };
  }
  if (p.fam === 'flow') {
    // order-flow momentum: strong one-sided taker flow + breakout of the k-bar range → market entry
    const I = imb(D, p.k), a = atr(D, 14), sl = p.trendN ? slope(D, p.trendN) : null;
    return (i) => {
      if (i < p.br + 1 || isNaN(I[i])) return null;
      let hi = -Infinity, lo = Infinity; for (let q = i - p.br; q < i; q++) { if (D.h[q] > hi) hi = D.h[q]; if (D.l[q] < lo) lo = D.l[q]; }
      let dir = 0;
      if (I[i] >= p.thr && D.c[i] > hi) dir = 1; else if (I[i] <= -p.thr && D.c[i] < lo) dir = -1;
      if (!dir || (p.side === 'long' && dir < 0) || (p.side === 'short' && dir > 0)) return null;
      if (sl && p.withTrend && Math.sign(sl[i]) !== dir) return null;
      const c = D.c[i];
      return { dir, kind: 'market', px: c, ttl: 1, tp: c * (1 + dir * p.tpBps / 1e4), sl: c * (1 - dir * p.slBps / 1e4), hold: p.hold };
    };
  }
  if (p.fam === 'flowfade') {
    // fade an order-flow spike: huge one-sided taker flow that fails to extend → limit order against it
    const I = imb(D, p.k), s = sd(D, 30);
    return (i) => {
      if (isNaN(I[i]) || !(s[i] > 0)) return null;
      let dir = 0; if (I[i] <= -p.thr) dir = 1; else if (I[i] >= p.thr) dir = -1;
      if (!dir || (p.side === 'long' && dir < 0) || (p.side === 'short' && dir > 0)) return null;
      const px = D.c[i] - dir * p.off * s[i];
      return { dir, kind: 'limit', px: Math.round(px / tick) * tick, ttl: p.ttl, tp: px * (1 + dir * p.tpBps / 1e4), sl: px * (1 - dir * p.slBps / 1e4), hold: p.hold };
    };
  }
  throw new Error('unknown family ' + p.fam);
}

// ───────────── simulator
const FEES = {
  standard: { maker: 2.0, taker: 6.0, slip: 1.5 },   // bps per side: BloFin standard tier, slippage on market/stop fills
  vip1: { maker: 0.6, taker: 5.0, slip: 1.5 },
  zero: { maker: 0, taker: 0, slip: 0 },
};
function run(D, p, fees, from, to, keepTrades) {
  from = from || 0; to = to || D.n;
  const intent = family(D, p), tick = p.touch ? 0 : 0.1; // touch = optimistic fills, for comparison only
  let pend = null, pos = null;
  const tr = [];
  for (let i = from; i < to; i++) {
    const o = D.o[i], h = D.h[i], l = D.l[i], c = D.c[i];
    // 1) working entry order
    if (pend && !pos) {
      if (i > pend.exp) pend = null;
      else if (pend.kind === 'market') {
        const ep = o * (1 + pend.dir * fees.slip / 1e4);
        pos = { dir: pend.dir, ep, fi: i, tp: pend.tp + (ep - pend.px), sl: pend.sl + (ep - pend.px), hold: pend.hold, feeIn: fees.taker, kind: 'market' }; pend = null;
      } else if (pend.dir > 0 ? l <= pend.px - tick : h >= pend.px + tick) {
        pos = { dir: pend.dir, ep: pend.px, fi: i, tp: pend.tp, sl: pend.sl, hold: pend.hold, feeIn: fees.maker, kind: 'limit' }; pend = null;
      }
      // fill-bar stop check (target not allowed on the fill bar)
      if (pos && pos.fi === i && pos.kind === 'limit') {
        if (pos.dir > 0 ? l <= pos.sl : h >= pos.sl) { close(i, pos.sl, 'stop'); }
      } else if (pos && pos.fi === i) {
        if (pos.dir > 0 ? l <= pos.sl : h >= pos.sl) close(i, pos.sl, 'stop');
      }
    }
    // 2) manage an open position on later bars
    if (pos && i > pos.fi) {
      const d = pos.dir;
      if (d > 0 ? o <= pos.sl : o >= pos.sl) close(i, o, 'stop');
      else if (d > 0 ? l <= pos.sl : h >= pos.sl) close(i, pos.sl, 'stop');
      else if (d > 0 ? h >= pos.tp + tick : l <= pos.tp - tick) close(i, pos.tp, 'target');
      else if (i - pos.fi >= pos.hold) close(i, c, 'time');
    }
    // 3) new intent at this close
    if (!pos && !pend) {
      const x = intent(i);
      if (x) pend = Object.assign({ exp: i + x.ttl }, x);
    }
  }
  function close(i, px, why) {
    const d = pos.dir;
    let xp = px, feeOut;
    if (why === 'target') feeOut = fees.maker; else { xp = px * (1 - d * fees.slip / 1e4); feeOut = fees.taker; }
    const gross = d * (xp - pos.ep) / pos.ep * 1e4; // bps (stop/time slippage already in xp)
    const net = gross - pos.feeIn - feeOut;
    const mIn = pos.feeIn === fees.maker && pos.kind !== 'market', mOut = why === 'target';
    tr.push(keepTrades ? { et: D.t[pos.fi], xt: D.t[i], dir: d, ep: pos.ep, xp, gross, net, why, bars: i - pos.fi, mIn, mOut } : { xt: D.t[i], gross, net, why, mIn, mOut });
    pos = null;
  }
  return summarize(tr, D.t[from], D.t[Math.min(to, D.n) - 1]);
}
function summarize(tr, t0, t1) {
  const days = Math.max(1, (t1 - t0) / 86400), n = tr.length;
  let g = 0, net = 0, w = 0, gw = 0, gl = 0, eq = 0, peak = 0, mdd = 0;
  const daily = new Map();
  for (const x of tr) {
    g += x.gross; net += x.net; if (x.net > 0) { w++; gw += x.net; } else gl -= x.net;
    eq += x.net; if (eq > peak) peak = eq; if (peak - eq > mdd) mdd = peak - eq;
    const dk = Math.floor(x.xt / 86400); daily.set(dk, (daily.get(dk) || 0) + x.net);
  }
  const dv = [...daily.values()], dm = dv.reduce((a, b) => a + b, 0) / Math.max(1, days), dsd = Math.sqrt(dv.reduce((a, b) => a + (b - dm) * (b - dm), 0) / Math.max(1, dv.length));
  const why = {}; for (const x of tr) why[x.why] = (why[x.why] || 0) + 1;
  return {
    n, perDay: n / days, grossBps: n ? g / n : 0, netBps: n ? net / n : 0, win: n ? w / n : 0, pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0),
    totalPct: net / 100, // % of equity at 1× notional
    maxDDPct: mdd / 100, dailyPct: dm / 100, sharpe: dsd > 0 ? (dm / dsd) * Math.sqrt(365) : 0, posDays: dv.length ? dv.filter((x) => x > 0).length / dv.length : 0, why, trades: tr,
  };
}
function reprice(res, fees, t0, t1) {
  const tr = res.trades.map((x) => Object.assign({}, x, { net: x.gross - (x.mIn ? fees.maker : fees.taker) - (x.mOut ? fees.maker : fees.taker) }));
  return summarize(tr, t0, t1);
}
module.exports = { reprice, summarize, loadHF, slice, run, FEES, family, ema, sma, sd, atr, imb, slope, volRatio };
