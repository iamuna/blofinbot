/* Harmonic patterns (Scott Carney's Gartley, Bat, Butterfly, Crab), tested at Ibrahim's request (2026-10-20).
 * Swings: a zigzag on the chosen timeframe — a swing ends when price comes back devAtr × ATR from its extreme.
 * When the fourth swing point C is confirmed, the last four points X-A-B-C are checked against each pattern's
 * Fibonacci ratios (B as a retracement of XA, C of AB); D is the pattern's XA level (0.786 Gartley, 0.886 Bat,
 * 1.27 Butterfly, 1.618 Crab) and must also sit inside the pattern's BC extension range. A resting limit order
 * waits at D (the Potential Reversal Zone) for waitBars bars; bullish patterns buy, bearish ones sell.
 * Stop stopXA × |XA| beyond D (at least minStopAtr × ATR); target tgt × AD back from D (Carney's 0.382 / 0.618).
 */
'use strict';
const PATTERNS = [
  { name: 'gartley', b: [0.588, 0.648], d: 0.786, bc: [1.13, 1.618] },
  { name: 'bat', b: [0.382, 0.5], d: 0.886, bc: [1.618, 2.618] },
  { name: 'butterfly', b: [0.756, 0.816], d: 1.27, bc: [1.618, 2.24] },
  { name: 'crab', b: [0.382, 0.618], d: 1.618, bc: [2.24, 3.618] },
];

module.exports = {
  name: 'harmonic', version: 1, tfs: [5, 15, 30], needsRef: false,
  params: { tf: 15, patterns: ['gartley', 'bat', 'butterfly', 'crab'], devAtr: 2.5, minLegAtr: 4, c: [0.382, 0.886], bcTol: 0.05, stopXA: 0.13, minStopAtr: 1, tgt: 0.382, waitBars: 12, holdBars: 24, minBars: 50 },
  bounds: { devAtr: [1.5, 5], stopXA: [0.05, 0.3], tgt: [0.236, 1], waitBars: [4, 48], holdBars: [8, 96] },
  onBar(ev, api) {
    const { coin, tf, bar, f } = ev, p = api.p;
    if (tf !== p.tf || !(f.atr > 0)) return null;
    const st = api.state(coin);
    if (!st.z) st.z = { dir: 0, ext: 0, hi: bar.h, lo: bar.l, piv: [] };
    const z = st.z, thr = p.devAtr * f.atr;
    let newPivot = false;
    // zigzag: dir +1 = rising (ext = the high so far), −1 = falling (ext = the low so far)
    if (z.dir === 1) {
      if (bar.h > z.ext) z.ext = bar.h;
      else if (z.ext - bar.l >= thr) { z.piv.push({ px: z.ext, hi: true }); z.dir = -1; z.ext = bar.l; newPivot = true; }
    } else if (z.dir === -1) {
      if (bar.l < z.ext) z.ext = bar.l;
      else if (bar.h - z.ext >= thr) { z.piv.push({ px: z.ext, hi: false }); z.dir = 1; z.ext = bar.h; newPivot = true; }
    } else {
      z.hi = Math.max(z.hi, bar.h); z.lo = Math.min(z.lo, bar.l);
      if (bar.h - z.lo >= thr) { z.piv.push({ px: z.lo, hi: false }); z.dir = 1; z.ext = bar.h; }
      else if (z.hi - bar.l >= thr) { z.piv.push({ px: z.hi, hi: true }); z.dir = -1; z.ext = bar.l; }
    }
    if (z.piv.length > 6) z.piv.shift();
    if (!newPivot || z.piv.length < 4 || f.bars < p.minBars || (st.until || 0) > api.now) return null;
    const [X, A, B, C] = z.piv.slice(-4);
    const side = C.hi ? 1 : -1; // C a high → bullish pattern (D below), C a low → bearish
    const xa = A.px - X.px, ab = B.px - A.px, bc = C.px - B.px;
    if (Math.abs(xa) < p.minLegAtr * f.atr || side * xa <= 0) return null;
    const bR = Math.abs(ab / xa), cR = Math.abs(bc / ab);
    if (cR < p.c[0] || cR > p.c[1]) return null;
    for (const P of PATTERNS) {
      if (!p.patterns.includes(P.name) || bR < P.b[0] || bR > P.b[1]) continue;
      const D = A.px - P.d * xa;
      const ext = Math.abs((C.px - D) / bc);
      if (ext < P.bc[0] * (1 - p.bcTol) || ext > P.bc[1] * (1 + p.bcTol)) continue;
      if (!(D > 0) || side * (bar.c - D) <= 0) return null; // already through D: the zone is gone
      const risk = Math.max(p.stopXA * Math.abs(xa), p.minStopAtr * f.atr);
      const target = D + side * p.tgt * Math.abs(A.px - D);
      return { coin, side, entry: { kind: 'maker', px: D, waitMin: p.waitBars * tf, fallback: 'cancel' }, stop: D - side * risk, target, trail: null,
        timeStopMin: p.holdBars * tf, why: `${side > 0 ? 'bullish' : 'bearish'} ${P.name} ${tf}m: B ${bR.toFixed(2)} XA, C ${cR.toFixed(2)} AB, D at ${P.d} XA` };
    }
    return null;
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + 2 * k.p.tf * 60000; },
};
