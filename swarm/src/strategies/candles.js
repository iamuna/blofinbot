/* Japanese candlestick patterns, each one a strategy (Ibrahim, 2026-10-21). One plugin; the config runs one
 * variant per pattern family (param `pattern`) on the 1h and 4h charts, in shadow. Each family trades both sides.
 * Textbook definitions (Nison), made mechanical; sizes are measured against the strategy's own ATR(atrLen).
 * Reversal patterns need a prior move the other way: the close before the pattern is at least trendAtr ATR
 * below (bullish) / above (bearish) the close trendBars bars earlier. Continuation patterns (marubozu,
 * three-methods) need the move in their own direction.
 *   engulfing      bull: down bar, then an up bar whose body covers it                bear: the mirror
 *   hammer         bull: hammer after a fall                                          bear: hanging man after a rise
 *   star           bull: inverted hammer after a fall                                 bear: shooting star after a rise
 *   morning-star   bull: long down, small body, up close past the first bar's middle  bear: evening star
 *   piercing       bull: long down, up bar opening at/under its close, closing past its middle   bear: dark cloud cover
 *   soldiers       bull: three white soldiers after a fall                            bear: three black crows after a rise
 *   harami         bull: long down, small up body inside it                           bear: the mirror
 *   tweezer        bull: down bar then up bar with the same low (tweezer bottom)      bear: tweezer top
 *   doji           bull: dragonfly doji after a fall                                  bear: gravestone doji after a rise
 *   marubozu       a full-body bar (almost no wicks) of at least 1 ATR, with the move  (continuation)
 *   three-inside   a harami, then a close beyond the first bar's open                  (three inside up / down)
 *   three-outside  an engulfing, then a close beyond the engulfing close               (three outside up / down)
 *   three-methods  long bar, three small bars inside it, long bar closing past it      (rising / falling three methods)
 *   doji-star      morning/evening star whose middle bar is a doji beyond both neighbours (abandoned baby without gaps)
 * Entry at the pattern's close (taker), stop stopPad ATR beyond the pattern's extreme, target rr × risk, time stop.
 * The plugin's own tfs stay within the plugin check's list; the variants pick 1h / 4h with onlyTfs (config).
 */
'use strict';
const FAMILIES = ['engulfing', 'hammer', 'star', 'morning-star', 'piercing', 'soldiers', 'harami', 'tweezer', 'doji', 'marubozu', 'three-inside', 'three-outside', 'three-methods', 'doji-star'];
const CONT = new Set(['marubozu', 'three-methods']);
const LEN = { engulfing: 2, hammer: 1, star: 1, 'morning-star': 3, piercing: 2, soldiers: 3, harami: 2, tweezer: 2, doji: 1, marubozu: 1, 'three-inside': 3, 'three-outside': 3, 'three-methods': 5, 'doji-star': 3 };
const body = (b) => Math.abs(b.c - b.o), rng = (b) => b.h - b.l, up = (b) => b.c > b.o, dn = (b) => b.c < b.o;
const upper = (b) => b.h - Math.max(b.o, b.c), lower = (b) => Math.min(b.o, b.c) - b.l, mid = (b) => (b.o + b.c) / 2;
// bars of the pattern in time order (x = the last); returns 1 (bullish), -1 (bearish) or 0
function detect(fam, x, atr) {
  const n = x.length, a = x[n - 3], b = x[n - 2], c = x[n - 1], long = (k) => body(k) >= 0.6 * atr;
  const engulf = (p, q) => (dn(p) && up(q) && q.o <= p.c && q.c >= p.o && body(q) > body(p) ? 1 : up(p) && dn(q) && q.o >= p.c && q.c <= p.o && body(q) > body(p) ? -1 : 0);
  const harami = (p, q) => (long(p) && dn(p) && up(q) && q.o >= p.c && q.c <= p.o && body(q) <= 0.5 * body(p) ? 1 : long(p) && up(p) && dn(q) && q.o <= p.c && q.c >= p.o && body(q) <= 0.5 * body(p) ? -1 : 0);
  const star3 = (p, m, q, small) => (long(p) && dn(p) && small(m) && up(q) && q.c > mid(p) ? 1 : long(p) && up(p) && small(m) && dn(q) && q.c < mid(p) ? -1 : 0);
  switch (fam) {
    case 'engulfing': return engulf(b, c);
    case 'hammer': return rng(c) > 0 && body(c) <= 0.35 * rng(c) && lower(c) >= 2 * body(c) && upper(c) <= 0.15 * rng(c) ? 2 : 0; // side from the prior move
    case 'star': return rng(c) > 0 && body(c) <= 0.35 * rng(c) && upper(c) >= 2 * body(c) && lower(c) <= 0.15 * rng(c) ? 2 : 0;
    case 'doji': return rng(c) >= 0.5 * atr && body(c) <= 0.1 * rng(c) ? (lower(c) >= 0.6 * rng(c) && upper(c) <= 0.1 * rng(c) ? 1 : upper(c) >= 0.6 * rng(c) && lower(c) <= 0.1 * rng(c) ? -1 : 0) : 0;
    case 'morning-star': return star3(a, b, c, (m) => body(m) <= 0.3 * body(a));
    case 'doji-star': { const s = star3(a, b, c, (m) => rng(m) > 0 && body(m) <= 0.1 * rng(m)); return s > 0 && b.l < a.l && b.l < c.l ? 1 : s < 0 && b.h > a.h && b.h > c.h ? -1 : 0; }
    case 'piercing': return long(b) && dn(b) && up(c) && c.o <= b.c && c.c > mid(b) && c.c < b.o ? 1 : long(b) && up(b) && dn(c) && c.o >= b.c && c.c < mid(b) && c.c > b.o ? -1 : 0;
    case 'soldiers': {
      const ok = (k, d) => body(k) >= 0.5 * atr && (d > 0 ? up(k) && upper(k) <= 0.3 * rng(k) : dn(k) && lower(k) <= 0.3 * rng(k));
      if ([a, b, c].every((k) => ok(k, 1)) && b.c > a.c && c.c > b.c && b.o >= a.o && b.o <= a.c && c.o >= b.o && c.o <= b.c) return 1;
      if ([a, b, c].every((k) => ok(k, -1)) && b.c < a.c && c.c < b.c && b.o <= a.o && b.o >= a.c && c.o <= b.o && c.o >= b.c) return -1;
      return 0;
    }
    case 'harami': return harami(b, c);
    case 'tweezer': return dn(b) && up(c) && Math.abs(b.l - c.l) <= 0.1 * atr ? 1 : up(b) && dn(c) && Math.abs(b.h - c.h) <= 0.1 * atr ? -1 : 0;
    case 'marubozu': return body(c) >= atr && body(c) >= 0.9 * rng(c) ? (up(c) ? 1 : -1) : 0;
    case 'three-inside': { const h = harami(a, b); return h > 0 && up(c) && c.c > a.o ? 1 : h < 0 && dn(c) && c.c < a.o ? -1 : 0; }
    case 'three-outside': { const e = engulf(a, b); return e > 0 && up(c) && c.c > b.c ? 1 : e < 0 && dn(c) && c.c < b.c ? -1 : 0; }
    case 'three-methods': {
      const f = x[n - 5], mids = x.slice(n - 4, n - 1);
      const inside = mids.every((k) => k.h <= f.h && k.l >= f.l && body(k) <= 0.5 * body(f));
      if (body(f) >= atr && inside && up(f) && up(c) && c.c > f.c && body(c) >= 0.6 * atr) return 1;
      if (body(f) >= atr && inside && dn(f) && dn(c) && c.c < f.c && body(c) >= 0.6 * atr) return -1;
      return 0;
    }
    default: return 0;
  }
}
module.exports = {
  name: 'candles', version: 1, tfs: [30, 45], needsRef: false, FAMILIES,
  params: { pattern: 'engulfing', tf: 45, atrLen: 14, trendBars: 10, trendAtr: 1, stopPad: 0.2, rr: 2, holdBars: 30, cooldownBars: 5, entry: 'taker' },
  bounds: { trendBars: [5, 30], rr: [1, 4], holdBars: [10, 60] },
  detect,
  onBar(ev, api) {
    const { coin, tf, bar } = ev, p = api.p;
    if (tf !== p.tf || !LEN[p.pattern]) return null;
    const st = api.state(coin);
    const keep = p.trendBars + 6;
    const push = (s, b) => {
      const tr = s.pc == null ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - s.pc), Math.abs(b.l - s.pc));
      s.atr = s.atr == null ? tr : (s.atr * (p.atrLen - 1) + tr) / p.atrLen; s.pc = b.c; s.n++;
      s.bars.push({ o: b.o, h: b.h, l: b.l, c: b.c }); if (s.bars.length > keep) s.bars.shift();
    };
    if (!st.m) { st.m = { n: 0, bars: [], atr: null, pc: null }; const h = api.hist(coin, tf), n = h ? h.len : 0; for (let i = n - 1; i >= 1; i--) push(st.m, h.at(i)); }
    const s = st.m, atrBefore = s.atr;
    push(s, bar);
    const L = LEN[p.pattern];
    if (s.n < Math.max(p.atrLen + 1, keep) || !(atrBefore > 0) || (st.until || 0) > api.now) return null;
    const pat = s.bars.slice(-L), before = s.bars.slice(0, s.bars.length - L);
    let side = detect(p.pattern, s.bars, atrBefore);
    if (!side) return null;
    // the prior move: reversal patterns trade against it, continuation patterns with it
    const ref = before[before.length - 1 - p.trendBars] || before[0], last = before[before.length - 1];
    const move = (last.c - ref.c) / atrBefore, prior = move <= -p.trendAtr ? -1 : move >= p.trendAtr ? 1 : 0;
    if (side === 2) side = -prior; // hammer / star shapes: bullish after a fall, bearish after a rise
    if (!side || !prior) return null;
    if (CONT.has(p.pattern) ? prior !== side : prior !== -side) return null;
    const c = bar.c, ext = side > 0 ? Math.min(...pat.map((k) => k.l)) : Math.max(...pat.map((k) => k.h));
    const stop = ext - side * p.stopPad * atrBefore;
    if (side * (c - stop) <= 0) return null;
    const risk = Math.abs(c - stop);
    const entry = p.entry === 'maker' ? { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true } : { kind: 'taker', px: c };
    return { coin, side, entry, stop, target: c + side * p.rr * risk, trail: null, timeStopMin: p.holdBars * tf,
      why: `${tf}m ${side > 0 ? 'bullish' : 'bearish'} ${p.pattern} after a ${prior > 0 ? 'rise' : 'fall'} of ${Math.abs(move).toFixed(1)} ATR` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
