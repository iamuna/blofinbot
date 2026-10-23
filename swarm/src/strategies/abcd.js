/* AB=CD pattern, added 2026-10-23 at Ibrahim's request (Mitch Ray TA, "HOW TO TRADE the Bearish ABCD Pattern"):
 *   "One impulse up (A→B), sell off and hit a 62% retrace — 78.6% is not out of the realm of possibility (B→C) —
 *    then run up to the 1.272 extension of BC, maybe the 1.618 (D). Take the short up there; when you get to the
 *    1.272 you must look at your oscillators: bearish divergence. The leg CD should be proportionate to AB.
 *    Targets: Fibonacci from the bottom of the structure (A) to the high (D): 38.2%, 50%, 61.8% — layer out."
 * Mechanical version (bearish; bullish is the mirror):
 *   swings: zigzag with the 23.6% rule (a turn counts once price came back confirm × the leg, ≥ minRevAtr ATR).
 *   A, B, C: the last three swings, A low, B high, C low; AB ≥ minLegAtr ATR; C retraces bc[0]..bc[1] of AB.
 *   zone:   D1 = C + 1.272 × BC, D2 = C + 1.618 × BC; CD / AB at D1 within sym[0]..sym[1] (symmetry).
 *   entry:  mode 'confirm' (default): price reaches D1 within waitBars, then the first bar that closes down (below
 *           its open and the previous close) enters, if RSI at the zone's high is below RSI at B by minRsiDelta
 *           (bearish divergence) when needDiv. mode 'limit': a resting sell at D1 for waitBars.
 *           A close beyond D2 (+ stopPad ATR) or back below C cancels the setup.
 *   stop:   stopPad ATR beyond D2. Target: tgt (0.5 — the middle of the 38.2/50/61.8 layers) of A→D back from D,
 *           D = the zone's extreme so far (or D1 for limits). Time stop holdBars.
 */
'use strict';

function upd(s, b, p) {
  const tr = s.pc == null ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - s.pc), Math.abs(b.l - s.pc));
  s.atr = s.atr == null ? tr : (s.atr * (p.atrLen - 1) + tr) / p.atrLen;
  if (s.pc != null) { const d = b.c - s.pc, L = p.rsiLen; s.ag = (s.ag * (L - 1) + Math.max(d, 0)) / L; s.al = (s.al * (L - 1) + Math.max(-d, 0)) / L; }
  s.rsi = s.al > 0 ? 100 - 100 / (1 + s.ag / s.al) : s.ag > 0 ? 100 : 50;
  s.prevC = s.pc; s.pc = b.c; s.n++;
}
function zig(s, b, p) {
  const z = s.z, atr = s.atr;
  if (z.dir === 0) {
    if (b.h > z.hi) { z.hi = b.h; z.hiR = s.rsi; } if (b.l < z.lo) { z.lo = b.l; z.loR = s.rsi; }
    if (z.hi - z.lo >= p.minRevAtr * 2 * atr) {
      if (b.h >= z.hi) { z.piv.push({ px: z.lo, hi: false, rsi: z.loR }); z.dir = 1; z.ext = b.h; z.extR = s.rsi; }
      else { z.piv.push({ px: z.hi, hi: true, rsi: z.hiR }); z.dir = -1; z.ext = b.l; z.extR = s.rsi; }
    }
    return null;
  }
  const last = z.piv[z.piv.length - 1], d = z.dir;
  if (d * ((d > 0 ? b.h : b.l) - z.ext) > 0) { z.ext = d > 0 ? b.h : b.l; z.extR = s.rsi; return null; }
  if (d * (z.ext - (d > 0 ? b.l : b.h)) >= Math.max(p.confirm * Math.abs(z.ext - last.px), p.minRevAtr * atr)) {
    const q = { px: z.ext, hi: d > 0, rsi: z.extR }; z.piv.push(q); if (z.piv.length > 8) z.piv.shift();
    z.dir = -d; z.ext = d > 0 ? b.l : b.h; z.extR = s.rsi;
    return q;
  }
  return null;
}
// a waiting setup sees the bar first (its D may be the swing the zigzag confirms on this same bar)
function wait(s, b, p) {
  const u = s.setup;
  if (!u) return null;
  u.n++;
  const side = u.side, reach = side > 0 ? b.l : b.h;
  if (u.n > p.waitBars || side * (u.D2 - b.c) > p.stopPad * s.atr) { s.setup = null; return null; } // too late, or closed beyond the stop
  if (side * (reach - u.D1) <= 0) { // in the zone
    u.reached = true;
    if (u.ext == null || side * (reach - u.ext) < 0) { u.ext = reach; u.extR = s.rsi; }
  }
  if (!u.reached) { if (side * (b.c - u.C) > 0) s.setup = null; return null; } // back beyond C before D: the pattern failed
  if (!(side * (b.c - b.o) > 0 && side * (b.c - s.prevC) > 0)) return null; // wait for a bar that turns
  const div = side * (u.extR - u.Brsi) > p.minRsiDelta; // bearish: RSI at D below RSI at B; bullish: above
  s.setup = null;
  return p.needDiv && !div ? null : Object.assign({ fire: 'confirm', div }, u);
}
function step(s, b, p) {
  upd(s, b, p);
  if (s.n <= p.atrLen) return null;
  const fired = wait(s, b, p);
  const q = zig(s, b, p);
  if (q && !fired) {
    s.setup = null;
    const P = s.z.piv;
    if (P.length >= 3) {
      const [A, B, C] = P.slice(-3), side = C.hi ? 1 : -1; // C a high → bullish AB=CD (D below); C a low → bearish
      const ab = Math.abs(B.px - A.px), bc = Math.abs(B.px - C.px), r = bc / ab;
      const D1 = C.px - side * p.d[0] * bc, D2 = C.px - side * p.d[1] * bc, sym = Math.abs(D1 - C.px) / ab;
      if (ab >= p.minLegAtr * s.atr && r >= p.bc[0] && r <= p.bc[1] && sym >= p.sym[0] && sym <= p.sym[1] && D1 > 0 && D2 > 0) {
        const u = { side, A: A.px, B: B.px, Brsi: B.rsi, C: C.px, D1, D2, n: 0, reached: false, ext: null, extR: null };
        if (p.mode === 'limit') return Object.assign({ fire: 'limit' }, u);
        s.setup = u;
      }
    }
  }
  return fired;
}

module.exports = {
  name: 'abcd', version: 1, tfs: [30, 45], needsRef: false,
  params: { tf: 45, mode: 'confirm', confirm: 0.236, minRevAtr: 1, minLegAtr: 4, bc: [0.55, 0.81], d: [1.272, 1.618], sym: [0.7, 1.3],
    rsiLen: 14, minRsiDelta: 0, needDiv: true, stopPad: 0.5, tgt: 0.5, waitBars: 30, holdBars: 60, atrLen: 14, entry: 'taker', cooldownBars: 2, sides: [1, -1] },
  bounds: { bc: [0.5, 0.886], tgt: [0.236, 0.786], waitBars: [10, 60], holdBars: [20, 120] },
  onBar(ev, api) {
    const { coin, tf, bar } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) { // first bar seen: replay the seeded history (no ideas from the past)
      st.m = { n: 0, pc: null, prevC: null, atr: null, ag: 0, al: 0, rsi: 50, z: { dir: 0, hi: -Infinity, lo: Infinity, ext: 0, piv: [] }, setup: null };
      const h = api.hist(coin, tf), n = h ? h.len : 0;
      for (let i = n - 1; i >= 1; i--) step(st.m, h.at(i), p);
    }
    const s = st.m, u = step(s, bar, p);
    if (!u || !p.sides.includes(u.side) || (st.until || 0) > api.now) return null;
    const side = u.side, c = bar.c, stop = u.D2 + side * -1 * p.stopPad * s.atr;
    const why = `${tf}m ${side > 0 ? 'bullish' : 'bearish'} AB=CD: BC ${(Math.abs(u.B - u.C) / Math.abs(u.B - u.A) * 100).toFixed(0)}% of AB, D zone ${u.D1.toPrecision(6)}–${u.D2.toPrecision(6)}`;
    if (u.fire === 'limit') {
      const D = u.D1, target = D + side * p.tgt * Math.abs(D - u.A);
      if (side * (D - stop) <= 0 || side * (bar.c - D) <= 0) return null;
      return { coin, side, entry: { kind: 'maker', px: D, waitMin: p.waitBars * tf, fallback: 'cancel' }, stop, target, trail: null, timeStopMin: p.holdBars * tf, why: `${why}, limit at 1.272` };
    }
    const D = u.ext, target = D + side * p.tgt * Math.abs(D - u.A);
    if (side * (c - stop) <= 0 || side * (target - c) <= 0) return null;
    const entry = p.entry === 'maker' ? { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true } : { kind: 'taker', px: c };
    return { coin, side, entry, stop, target, trail: null, timeStopMin: p.holdBars * tf, why: `${why}, turned at ${D.toPrecision(6)}${u.div ? ' with RSI divergence' : ''}` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
