/* Adaptive score (2026-10-23), ported from the 1-minute bot (iamuna/1-min-blofin-bot, btc_bot/learning.py
 * StrategySpec + btc_bot/features.py scores). There it ran on BTC 1m bars and lost after costs, so nothing was
 * promoted; the swarm's 5-year sweep says the same of every 1–45 minute strategy. Its idea is a trend-plus-momentum
 * filter, the family that does hold up here on slow bars (ma-retest, rsi-macd-trend @ 4h–1d), so it is brought over
 * for the sweep and shadow on 4h / 12h / 1d — not as a claim that it works. See expansion/README.md.
 *
 * Scores on each closed bar of p.tf (same arithmetic as the Python original):
 *   trend    = ±30 (close vs EMA20) ±30 (EMA20 vs EMA50) ±40 (EMA50 vs EMA200)   → one of ±100, ±40, ±20
 *   momentum = clamp((RSI14 − 50) × 1.4, ±50) ± 30 (MACD 12/26/9 histogram sign) + clamp(ROC12% × 8, ±20)
 *   RSI14 is the simple-average (Cutler) RSI the original used; volume ratio = this bar's quote volume ÷ the mean of
 *   the last 20 (this one included).
 * Long: trend ≥ trendMin, momentum ≥ momentumMin, rsiLongMin ≤ RSI ≤ rsiLongMax, volume ratio ≥ minVolRatio
 *   (and, with candleConfirm, a bullish engulfing / hammer / outside bar). Short: the mirror image.
 * Stop stopAtr × ATR from the close, target targetR × the risk, time stop holdBars bars (the original had none; the
 * kit requires one). ATR is the swarm's Wilder ATR14 (the original averaged the last 20 true ranges).
 * Note: trend takes only the values above, so any trendMin in (40, 100] means "all three EMAs stacked".
 * tfs lists 45 only (the plugin check's range); variants set params.onlyTfs [tf] to react to the slow bars.
 */
'use strict';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ema = (old, x, n) => (old == null ? x : old + (2 / (n + 1)) * (x - old));
const keepLast = (arr, n) => { if (arr.length > n) arr.splice(0, arr.length - n); };

// Japanese candle of the newest bar against the one before (btc_bot/patterns.py candle_pattern)
function candle(prev, cur) {
  if (!prev) return '';
  const o = cur.o, h = cur.h, l = cur.l, c = cur.c, body = Math.abs(c - o), rng = Math.max(h - l, 1e-12);
  const upper = h - Math.max(o, c), lower = Math.min(o, c) - l;
  if (body / rng <= 0.08) return 'doji';
  if (lower >= body * 2.2 && upper <= Math.max(body * 0.5, rng * 0.12)) return 'hammer';
  if (upper >= body * 2.2 && lower <= Math.max(body * 0.5, rng * 0.12)) return 'shooting_star';
  if (c > o && prev.c < prev.o && o <= prev.c && c >= prev.o) return 'bullish_engulfing';
  if (c < o && prev.c > prev.o && o >= prev.c && c <= prev.o) return 'bearish_engulfing';
  if (h <= prev.h && l >= prev.l) return 'inside_bar';
  if (h >= prev.h && l <= prev.l) return 'outside_bar';
  return '';
}

// one closed bar into the running indicators; returns the scores once there is enough history
function push(m, b) {
  const c = b.c;
  m.n++;
  m.e20 = ema(m.e20, c, 20); m.e50 = ema(m.e50, c, 50); m.e200 = ema(m.e200, c, 200);
  m.mf = ema(m.mf, c, 12); m.ms = ema(m.ms, c, 26);
  const macd = m.mf - m.ms; m.sig = ema(m.sig, macd, 9);
  if (m.prevC != null) { m.d.push(c - m.prevC); keepLast(m.d, 14); }
  m.closes.push(c); keepLast(m.closes, 13);
  m.vols.push(b.q > 0 ? b.q : b.v || 0); keepLast(m.vols, 20);
  const pat = candle(m.prevBar, b);
  m.prevC = c; m.prevBar = { o: b.o, h: b.h, l: b.l, c };
  let rsi = null;
  if (m.d.length === 14) {
    let g = 0, lo = 0; for (const x of m.d) { if (x > 0) g += x; else lo -= x; }
    rsi = lo === 0 ? 100 : 100 - 100 / (1 + g / lo);
  }
  const roc = m.closes.length === 13 && m.closes[0] ? (c / m.closes[0] - 1) * 100 : null;
  const vAvg = m.vols.length === 20 ? m.vols.reduce((a, x) => a + x, 0) / 20 : null;
  const vr = vAvg ? m.vols[m.vols.length - 1] / vAvg : null;
  const trend = (c > m.e20 ? 30 : -30) + (m.e20 > m.e50 ? 30 : -30) + (m.e50 > m.e200 ? 40 : -40);
  let mom = 0;
  if (rsi != null) mom += clamp((rsi - 50) * 1.4, -50, 50);
  mom += macd - m.sig > 0 ? 30 : -30;
  if (roc != null) mom += clamp(roc * 8, -20, 20);
  return { trend, mom, rsi, vr, pat };
}

const LONG_CANDLES = ['bullish_engulfing', 'hammer', 'outside_bar'], SHORT_CANDLES = ['bearish_engulfing', 'shooting_star', 'outside_bar'];

module.exports = {
  name: 'adaptive-score', version: 1, tfs: [45], needsRef: false,
  params: {
    tf: 240, trendMin: 55, momentumMin: 20, minVolRatio: 0.75, rsiLongMin: 48, rsiLongMax: 75, rsiShortMin: 25, rsiShortMax: 52,
    targetR: 1.8, stopAtr: 1.0, candleConfirm: false, holdBars: 60, minBars: 210, entry: 'maker', cooldownBars: 1,
  },
  // the ranges the 1-minute bot's mutator kept its challengers in (learning.py mutate), plus the time stop
  bounds: { trendMin: [25, 85], momentumMin: [5, 60], minVolRatio: [0.2, 2.5], targetR: [0.8, 4], stopAtr: [0.5, 2.5], holdBars: [12, 120], candleConfirm: [false, true] },
  onBar(ev, api) {
    const { coin, tf, bar, f } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) { // first bar seen: start from the history already loaded for this timeframe
      st.m = { n: 0, e20: null, e50: null, e200: null, mf: null, ms: null, sig: null, d: [], closes: [], vols: [], prevC: null, prevBar: null };
      const h = api.hist(coin, tf), n = h ? h.len : 0, first = n && h.at(0).t === bar.t ? 1 : 0;
      for (let k = n - 1; k >= first; k--) push(st.m, h.at(k));
    }
    const s = push(st.m, bar);
    if (st.m.n < p.minBars || !(f.atr > 0) || s.rsi == null) return null;
    if ((st.until || 0) > api.now) return null;
    if (s.vr != null && s.vr < p.minVolRatio) return null;
    let side = 0;
    if (s.trend >= p.trendMin && s.mom >= p.momentumMin && s.rsi >= p.rsiLongMin && s.rsi <= p.rsiLongMax) side = 1;
    else if (s.trend <= -p.trendMin && s.mom <= -p.momentumMin && s.rsi >= p.rsiShortMin && s.rsi <= p.rsiShortMax) side = -1;
    if (!side) return null;
    if (p.candleConfirm && !(side > 0 ? LONG_CANDLES : SHORT_CANDLES).includes(s.pat)) return null;
    const c = bar.c, risk = p.stopAtr * f.atr, stop = c - side * risk;
    const entry = p.entry === 'taker' ? { kind: 'taker', px: c } : { kind: 'maker', px: c, waitMin: Math.min(30, tf), fallback: 'cancel', chase: true };
    return {
      coin, side, entry, stop, target: p.targetR > 0 ? c + side * p.targetR * risk : null, trail: null, timeStopMin: p.holdBars * tf,
      why: `${tf}m trend ${s.trend}, momentum ${s.mom.toFixed(0)}, RSI ${s.rsi.toFixed(0)}, volume ×${s.vr == null ? '?' : s.vr.toFixed(2)}${s.pat ? `, ${s.pat}` : ''}`,
    };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
