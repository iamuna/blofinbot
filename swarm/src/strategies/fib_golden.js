/* Fibonacci golden-zone pullback, added 2026-10-23 at Ibrahim's request (Mitch Ray TA, "HOW TO Fibonacci! Trading
 * Bitcoin and Cryptocurrency"):
 *   "We can't anchor a swing high until we've hit a 23.6% retrace." "In an uptrend you go from your swing low to
 *    your swing high … we can retrace 38%, 50% or 62% of the way: the golden zone." "We touched the 61.8% retrace,
 *    nothing lower, bullish harami and we were gone again." Deeper retraces (78.6%, 88.6%) are harmonic
 *    territory; 1.272 is the first extension target. Fibonacci left to right only, wick to wick.
 * Mechanical version:
 *   swings: a zigzag on the chosen timeframe whose turn is confirmed when price comes back confirm (0.236) of the
 *           leg it just made (and at least minRevAtr ATR) — the 23.6% anchoring rule; wicks on both ends.
 *   trend:  the last two swing highs and lows rise (higher high, higher low) for longs; fall for shorts.
 *   setup:  a swing high just confirmed: leg = swing low → swing high, at least minLegAtr ATR.
 *   entry:  price trades into the golden zone (below the zone[0] retracement) and a bar closes up (close above its
 *           open and the previous close) while no close below the stopFib retracement has happened; enter at that
 *           close (maker, chasing). One entry per leg; a new swing ends the setup.
 *   stop:   stopPad ATR beyond the stopFib (0.786) retracement. Target: the ext (1.272) extension of the leg.
 *           Skipped when the target pays less than minRR × risk. Time stop holdBars.
 * Shorts: the mirror (lower highs and lows, swing high → swing low, golden zone above).
 */
'use strict';

function atrUpd(s, b, p) {
  const tr = s.pc == null ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - s.pc), Math.abs(b.l - s.pc));
  s.atr = s.atr == null ? tr : (s.atr * (p.atrLen - 1) + tr) / p.atrLen;
  s.prevC = s.pc; s.pc = b.c; s.n++;
}
// zigzag with the 23.6% rule; returns the pivot confirmed on this bar or null
function zig(s, b, p) {
  const z = s.z, atr = s.atr;
  if (z.dir === 0) {
    z.hi = Math.max(z.hi, b.h); z.lo = Math.min(z.lo, b.l);
    if (z.hi - z.lo >= p.minRevAtr * 2 * atr) {
      if (b.h >= z.hi) { z.piv.push({ px: z.lo, hi: false, n: s.n }); z.dir = 1; z.ext = b.h; z.extN = s.n; }
      else { z.piv.push({ px: z.hi, hi: true, n: s.n }); z.dir = -1; z.ext = b.l; z.extN = s.n; }
    }
    return null;
  }
  const last = z.piv[z.piv.length - 1];
  if (z.dir === 1) {
    if (b.h > z.ext) { z.ext = b.h; z.extN = s.n; return null; }
    if (z.ext - b.l >= Math.max(p.confirm * (z.ext - last.px), p.minRevAtr * atr)) {
      const q = { px: z.ext, hi: true, n: z.extN }; z.piv.push(q); z.dir = -1; z.ext = b.l; z.extN = s.n;
      if (z.piv.length > 8) z.piv.shift();
      return q;
    }
  } else {
    if (b.l < z.ext) { z.ext = b.l; z.extN = s.n; return null; }
    if (b.h - z.ext >= Math.max(p.confirm * (last.px - z.ext), p.minRevAtr * atr)) {
      const q = { px: z.ext, hi: false, n: z.extN }; z.piv.push(q); z.dir = 1; z.ext = b.h; z.extN = s.n;
      if (z.piv.length > 8) z.piv.shift();
      return q;
    }
  }
  return null;
}
function step(s, b, p) {
  const q = s.n > p.atrLen ? zig(s, b, p) : null;
  if (q) {
    s.setup = null;
    const P = s.z.piv, n = P.length;
    if (n >= 4) {
      const side = q.hi ? 1 : -1; // a swing high confirmed: an up-leg ended, look for a long pullback
      const [e1, x1, e2, x2] = P.slice(-4); // e = extreme of the trend side, x = the other
      // long: x2 = the high just confirmed, e2 = the low before it, x1 / e1 the high / low before those
      const trend = side > 0 ? x2.px > x1.px && e2.px > e1.px : x2.px < x1.px && e2.px < e1.px;
      const leg = Math.abs(x2.px - e2.px);
      if (trend && leg >= p.minLegAtr * s.atr) s.setup = { side, from: e2.px, to: x2.px, leg, touched: false, n: 0 };
    }
  }
  atrUpd(s, b, p);
  const u = s.setup;
  if (!u || q) return null;
  u.n++;
  const lvl = (f) => u.to - u.side * f * u.leg;
  if (u.side * (b.c - lvl(p.stopFib)) < 0 || u.n > p.waitBars) { s.setup = null; return null; } // too deep or too late
  if (u.side * ((u.side > 0 ? b.l : b.h) - lvl(p.zone[0])) <= 0) u.touched = true;
  if (u.touched && u.side * (b.c - b.o) > 0 && u.side * (b.c - s.prevC) > 0 && u.side * (b.c - lvl(p.zone[1])) > 0) {
    s.setup = null;
    return u;
  }
  return null;
}

module.exports = {
  name: 'fib-golden', version: 1, tfs: [30, 45], needsRef: false,
  params: { tf: 45, confirm: 0.236, minRevAtr: 1, minLegAtr: 4, zone: [0.382, 0.618], stopFib: 0.786, stopPad: 0.25, ext: 1.272, minRR: 1,
    waitBars: 30, holdBars: 60, atrLen: 14, entry: 'maker', cooldownBars: 2, sides: [1, -1] },
  bounds: { confirm: [0.15, 0.382], stopFib: [0.618, 1], ext: [1, 1.618], minLegAtr: [2, 8], holdBars: [20, 120] },
  onBar(ev, api) {
    const { coin, tf, bar } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) { // first bar seen: replay the seeded history (no ideas from the past)
      st.m = { n: 0, pc: null, prevC: null, atr: null, z: { dir: 0, hi: -Infinity, lo: Infinity, ext: 0, extN: 0, piv: [] }, setup: null };
      const h = api.hist(coin, tf), n = h ? h.len : 0;
      for (let i = n - 1; i >= 1; i--) step(st.m, h.at(i), p);
    }
    const s = st.m, u = step(s, bar, p);
    if (!u || !p.sides.includes(u.side) || (st.until || 0) > api.now) return null;
    const side = u.side, c = bar.c;
    const stop = u.to - side * p.stopFib * u.leg - side * p.stopPad * s.atr;
    const target = u.from + side * p.ext * u.leg;
    if (side * (c - stop) <= 0 || side * (target - c) < p.minRR * Math.abs(c - stop)) return null;
    const entry = p.entry === 'taker' ? { kind: 'taker', px: c } : { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true };
    const depth = side * (u.to - (side > 0 ? Math.min(bar.l, c) : Math.max(bar.h, c))) / u.leg;
    return { coin, side, entry, stop, target, trail: null, timeStopMin: p.holdBars * tf,
      why: `${tf}m golden-zone ${side > 0 ? 'pullback in an uptrend' : 'rally in a downtrend'} (leg ${(u.leg / s.atr).toFixed(1)} ATR, retraced ~${(depth * 100).toFixed(0)}%), target ${p.ext} extension` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
