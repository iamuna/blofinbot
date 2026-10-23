/* Wedge breakout, added 2026-10-23 at Ibrahim's request (Mitch Ray TA, "HOW TO Fibonacci!" and "How to Trade
 * Bitcoin and Cryptocurrency Effectively"):
 *   "A falling wedge pattern, bullish divergence down here … we broke to the upside. Rule of thumb: from the high
 *    point to the low point of the pattern's structure, the primary target for a falling wedge is the 50%
 *    retrace, the secondary the 61.8%." A rising wedge with bearish divergence is the mirror: a breakdown.
 * Mechanical version (falling wedge → long):
 *   pivots: fractal swing highs / lows (the extreme of pivotK bars on each side).
 *   wedge:  the last three swing highs fall and the last three swing lows fall, all inside maxSpan bars, the highs
 *           falling faster than the lows (the lines converge), the pattern at least minHeightAtr ATR tall.
 *   divergence (needDiv): RSI at the last swing low above RSI at the one before (lower low, higher RSI).
 *   entry:  the first close above the upper line (through the first and last swing highs), within maxAfter bars
 *           of the last pivot; taker at the close.
 *   stop:   stopPad ATR below the wedge's lowest low. Target: tgt (0.5) retracement of the wedge's high → low.
 *           Skipped when the target pays less than minRR × risk. Time stop holdBars.
 * Rising wedge → short: rising highs and lows, the lows rising faster, close below the lower line, bearish
 * divergence at the last swing high, target the tgt retracement of the wedge's low → high.
 */
'use strict';

function upd(s, b, p) {
  const tr = s.pc == null ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - s.pc), Math.abs(b.l - s.pc));
  s.atr = s.atr == null ? tr : (s.atr * (p.atrLen - 1) + tr) / p.atrLen;
  if (s.pc != null) { const d = b.c - s.pc, L = p.rsiLen; s.ag = (s.ag * (L - 1) + Math.max(d, 0)) / L; s.al = (s.al * (L - 1) + Math.max(-d, 0)) / L; }
  const rsi = s.al > 0 ? 100 - 100 / (1 + s.ag / s.al) : s.ag > 0 ? 100 : 50;
  s.pc = b.c; s.n++;
  s.bars.push({ k: s.n, h: b.h, l: b.l, c: b.c, rsi });
  if (s.bars.length > 2 * p.pivotK + 1) s.bars.shift();
  // a pivot pivotK bars ago, confirmed now
  const B = s.bars, K = p.pivotK;
  if (B.length < 2 * K + 1) return;
  const j = K;
  for (const side of [1, -1]) {
    const x = side > 0 ? B[j].h : B[j].l; let ok = true;
    for (let i = 0; i < B.length; i++) { if (i === j) continue; const d = side * ((side > 0 ? B[i].h : B[i].l) - x); if (i < j ? d >= 0 : d > 0) { ok = false; break; } } // a tie goes to the earlier bar
    if (!ok) continue;
    const list = side > 0 ? s.highs : s.lows;
    list.push({ k: B[j].k, px: x, rsi: B[j].rsi }); if (list.length > 6) list.shift();
  }
}
const lineAt = (a, b, k) => a.px + ((b.px - a.px) * (k - a.k)) / (b.k - a.k);
// the wedge whose break this bar is: side +1 falling wedge broken up, −1 rising wedge broken down
function check(s, b, p, side) {
  const hs = s.highs.slice(-3), ls = s.lows.slice(-3);
  if (hs.length < 3 || ls.length < 3) return null;
  const first = Math.min(hs[0].k, ls[0].k), lastPiv = Math.max(hs[2].k, ls[2].k);
  if (s.n - first > p.maxSpan || s.n - lastPiv > p.maxAfter) return null;
  const fall = (a) => a[0].px > a[1].px && a[1].px > a[2].px, rise = (a) => a[0].px < a[1].px && a[1].px < a[2].px;
  const sl = (a) => (a[2].px - a[0].px) / (a[2].k - a[0].k);
  const top = Math.max(hs[0].px, hs[1].px, hs[2].px), bot = Math.min(ls[0].px, ls[1].px, ls[2].px);
  if (top - bot < p.minHeightAtr * s.atr) return null;
  if (side > 0) {
    if (!(fall(hs) && fall(ls) && sl(hs) < sl(ls))) return null;
    const up = lineAt(hs[0], hs[2], s.n), upPrev = lineAt(hs[0], hs[2], s.n - 1);
    if (!(b.c > up && s.prevC <= upPrev)) return null;
    const div = ls[2].rsi > ls[1].rsi;
    if (p.needDiv && !div) return null;
    return { side, from: hs[0].px, ext: bot, div };
  }
  if (!(rise(hs) && rise(ls) && sl(ls) > sl(hs))) return null;
  const dn = lineAt(ls[0], ls[2], s.n), dnPrev = lineAt(ls[0], ls[2], s.n - 1);
  if (!(b.c < dn && s.prevC >= dnPrev)) return null;
  const div = hs[2].rsi < hs[1].rsi;
  if (p.needDiv && !div) return null;
  return { side, from: ls[0].px, ext: top, div };
}

module.exports = {
  name: 'wedge-break', version: 1, tfs: [30, 45], needsRef: false,
  params: { tf: 45, pivotK: 3, maxSpan: 120, maxAfter: 15, minHeightAtr: 3, rsiLen: 14, atrLen: 14, needDiv: true, stopPad: 0.5, tgt: 0.5, minRR: 1,
    holdBars: 60, entry: 'taker', cooldownBars: 5, sides: [1, -1] },
  bounds: { maxSpan: [40, 240], tgt: [0.382, 0.786], minRR: [0.5, 3], holdBars: [20, 120] },
  onBar(ev, api) {
    const { coin, tf, bar } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) { // first bar seen: replay the seeded history (no ideas from the past)
      st.m = { n: 0, pc: null, prevC: null, atr: null, ag: 0, al: 0, bars: [], highs: [], lows: [] };
      const h = api.hist(coin, tf), n = h ? h.len : 0;
      for (let i = n - 1; i >= 1; i--) { st.m.prevC = st.m.pc; upd(st.m, h.at(i), p); }
    }
    const s = st.m;
    s.prevC = s.pc; upd(s, bar, p);
    if (s.n < 50 || !(s.atr > 0) || (st.until || 0) > api.now) return null;
    for (const side of p.sides) {
      const w = check(s, bar, p, side);
      if (!w) continue;
      const c = bar.c, stop = w.ext - side * p.stopPad * s.atr;
      const target = w.ext + side * p.tgt * Math.abs(w.from - w.ext);
      if (side * (c - stop) <= 0 || side * (target - c) < p.minRR * Math.abs(c - stop)) continue;
      const entry = p.entry === 'maker' ? { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true } : { kind: 'taker', px: c };
      return { coin, side, entry, stop, target, trail: null, timeStopMin: p.holdBars * tf,
        why: `${tf}m ${side > 0 ? 'falling wedge broken up' : 'rising wedge broken down'}${w.div ? ' with RSI divergence' : ''}, target ${p.tgt * 100}% of the pattern` };
    }
    return null;
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
