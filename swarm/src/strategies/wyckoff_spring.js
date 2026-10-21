/* Wyckoff spring (and its mirror, the upthrust), added at Ibrahim's request (2026-10-21) from Mitch Ray TA's video:
 *   "A spring: the chart falls below its support, makes a new panic low, then springs back into its trading range.
 *    After the spring there is likely a test. A high-quality test puts in a higher bottom than the spring. If price
 *    respects the support on the test, a position can be justified. The stop goes below the low of the spring. At
 *    least three points of profit for each point risked: three to one at all times."
 * Mechanical version:
 *   range:  the lowest low / highest high of the last rangeBars closed bars (support / resistance), between minW and
 *           maxW ATRs wide (a real trading range, not a trend or a flat line).
 *   spring: a bar pierces support by minPierce..maxPierce ATR and a close back above support follows within
 *           springBars bars (the same bar counts).
 *   test:   within testBars bars price comes back to support (low within testZone ATR above it) without breaking the
 *           spring low (a higher bottom); entry when a bar then closes up, above support.
 *   stop:   stopPad ATR below the spring low; target rr × risk (3 by default). Shorts: the mirror (upthrust).
 * ATR is the strategy's own (Wilder, atrLen) on its timeframe, so seeded history is enough to start.
 * The plugin's own tfs stay within the plugin check's list; the 1h and 4h variants pick theirs with onlyTfs (config).
 */
'use strict';
function update(s, b, p) {
  const tr = s.pc == null ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - s.pc), Math.abs(b.l - s.pc));
  s.atr = s.atr == null ? tr : (s.atr * (p.atrLen - 1) + tr) / p.atrLen;
  s.prevC = s.pc; s.pc = b.c; s.n++;
  s.bars.push({ h: b.h, l: b.l }); if (s.bars.length > p.rangeBars + 1) s.bars.shift();
}
// look for a spring / upthrust or advance the test; returns 1 / -1 when a test confirms
function scan(s, b, p) {
  const atr = s.atr;
  if (s.ph) { // after the spring: wait for the test
    const ph = s.ph, side = ph.side; ph.n++;
    if (ph.n > p.testBars || side * (b.c - ph.level) < -p.testZone * atr || (side > 0 ? b.l < ph.ext : b.h > ph.ext)) { s.ph = null; return 0; }
    const reach = side > 0 ? b.l : b.h;
    if (ph.n > 1 && side * (reach - ph.level) <= p.testZone * atr) ph.touched = true;
    if (ph.touched && side * (b.c - s.prevC) > 0 && side * (b.c - ph.level) > 0 && ph.n > 1) { const r = { side, level: ph.level, ext: ph.ext }; s.ph = null; s.last = r; return side; }
    return 0;
  }
  if (s.pend) { // pierced, waiting for the close back inside
    const pd = s.pend; pd.ext = pd.side > 0 ? Math.min(pd.ext, b.l) : Math.max(pd.ext, b.h); pd.ttl--;
    if (pd.side * (pd.level - pd.ext) > p.maxPierce * atr) { s.pend = null; return 0; }
    if (pd.side * (b.c - pd.level) > 0) { s.ph = { side: pd.side, level: pd.level, ext: pd.ext, n: 0, touched: false }; s.pend = null; }
    else if (pd.ttl <= 0) s.pend = null;
    return 0;
  }
  if (s.bars.length < p.rangeBars + 1) return 0;
  const win = s.bars.slice(0, -1); let sup = Infinity, res = -Infinity;
  for (const x of win) { if (x.l < sup) sup = x.l; if (x.h > res) res = x.h; }
  const w = (res - sup) / atr;
  if (!(w >= p.minW && w <= p.maxW)) return 0;
  for (const [side, level, ext] of [[1, sup, b.l], [-1, res, b.h]]) {
    const pierce = side * (level - ext) / atr;
    if (pierce < p.minPierce || pierce > p.maxPierce || !p.sides.includes(side)) continue;
    if (side * (b.c - level) > 0) s.ph = { side, level, ext, n: 0, touched: false };
    else s.pend = { side, level, ext, ttl: p.springBars - 1 };
    return 0;
  }
  return 0;
}
module.exports = {
  name: 'wyckoff-spring', version: 1, tfs: [30, 45], needsRef: false,
  params: { tf: 45, rangeBars: 40, minW: 3, maxW: 15, minPierce: 0.1, maxPierce: 2, springBars: 3, testBars: 20, testZone: 0.5, stopPad: 0.2, rr: 3, atrLen: 14, holdBars: 60, entry: 'taker', cooldownBars: 10, sides: [1, -1] },
  bounds: { rangeBars: [20, 120], rr: [2, 5], testBars: [5, 40], holdBars: [20, 120] },
  onBar(ev, api) {
    const { coin, tf, bar } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) { // first bar seen: replay the seeded history (no ideas from the past)
      st.m = { n: 0, bars: [], pc: null, prevC: null, atr: null, ph: null, pend: null };
      const h = api.hist(coin, tf), n = h ? h.len : 0;
      for (let i = n - 1; i >= 1; i--) { const x = h.at(i); scan(st.m, x, p); update(st.m, x, p); }
    }
    const s = st.m;
    const side = s.n > p.rangeBars ? scan(s, bar, p) : 0;
    update(s, bar, p);
    if (!side || !(s.atr > 0) || (st.until || 0) > api.now) return null;
    const c = bar.c, stop = s.last.ext - side * p.stopPad * s.atr;
    if (side * (c - stop) <= 0) return null;
    const risk = Math.abs(c - stop);
    const entry = p.entry === 'maker' ? { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true } : { kind: 'taker', px: c };
    return { coin, side, entry, stop, target: c + side * p.rr * risk, trail: null, timeStopMin: p.holdBars * tf,
      why: `${tf}m Wyckoff ${side > 0 ? 'spring' : 'upthrust'} at ${s.last.level.toPrecision(6)}, test held (${side > 0 ? 'higher low' : 'lower high'}), ${p.rr}:1` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
