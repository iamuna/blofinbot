/* Mixing bowl: Mitch Ray TA's "cake-baking" confluence method, added 2026-10-23 at Ibrahim's request (videos
 * "HOW TO SWING TRADE! SECRETS TO SUCCESS!" and "How to Trade Bitcoin and Cryptocurrency Effectively").
 *   "You can't make a cake with one ingredient … coinciding variables": a reversal is taken only where several
 *   independent reasons line up, the stop sits moderately beyond the critical support (not where everyone's stop
 *   is), targets are Fibonacci levels of the drop, and the trade must offer about 3:1 before it is taken.
 * Mechanical version, at every newly confirmed swing low (long) or swing high (short) on the chosen timeframe
 * (a fractal pivot: the extreme of pivotK bars on each side, so it is known pivotK bars later):
 *   1 flour    RSI divergence against the previous swing (minGap..maxGap bars back): classic (new low, higher RSI)
 *              or hidden (higher low, lower RSI) if `hidden`
 *   2 + milk   MACD-line divergence on the same two swings ("divergence on multiple oscillators")
 *   3 sugar    critical support "looking left": at least srTouches older pivots (highs or lows, leftMin..win bars
 *              back) within srTol ATR of the swing — historical chop
 *   4 eggs     a pattern: double bottom (the two lows within dbTol ATR) or a falling wedge (three lower highs and
 *              three lower lows, the highs falling faster)
 *   5 baking   Fibonacci golden zone: the swing retraced zone[0]..zone[1] (± zoneTol) of the last impulse
 *     powder   (lowest low → highest high of the last fibLook bars)
 *   6 butter   time-scale hopping: RSI divergence on the higher timeframe htf too (a new or equal low there with a
 *     /oil     higher RSI than its earlier low, last htfLook bars)
 *   7 bowl     the higher timeframe's trend agrees (close above its EMA bowlLen for longs)
 * Enter (taker at the confirming close) when the score ≥ minScore and, if needDiv, ingredient 1 or 2 is present.
 * Stop stopPad ATR beyond the lower of the swing and the support level. Target: the first of tgts (Fibonacci
 * retracements of the drop, high of the last fibLook bars → swing) that pays ≥ minRR × risk; none → no trade
 * ("measure the ingredients"). Time stop holdBars. Shorts are the mirror image.
 * tfs stay within the plugin check's list; the 4h / 12h / 1d variants pick theirs with onlyTfs (config).
 */
'use strict';

// RSI (Wilder), MACD line and ATR, one closed bar at a time; keeps the last `win` bars with their values
function upd(s, b, p) {
  const c = b.c;
  if (!s.n) { s.ef = c; s.es = c; s.sg = 0; s.ag = 0; s.al = 0; s.atr = b.h - b.l; }
  else {
    const d = c - s.pc, L = p.rsiLen;
    s.ag = (s.ag * (L - 1) + Math.max(d, 0)) / L; s.al = (s.al * (L - 1) + Math.max(-d, 0)) / L;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - s.pc), Math.abs(b.l - s.pc));
    s.atr = (s.atr * (p.atrLen - 1) + tr) / p.atrLen;
  }
  s.ef += (2 / (p.fast + 1)) * (c - s.ef); s.es += (2 / (p.slow + 1)) * (c - s.es);
  const macd = s.ef - s.es; s.sg += (2 / (p.sig + 1)) * (macd - s.sg);
  const rsi = s.al > 0 ? 100 - 100 / (1 + s.ag / s.al) : s.ag > 0 ? 100 : 50;
  s.pc = c; s.n++;
  s.bars.push({ k: s.n, o: b.o, h: b.h, l: b.l, c, rsi, macd, atr: s.atr });
  if (s.bars.length > p.win) s.bars.shift();
}
// a pivot pivotK bars ago, confirmed now: side +1 = swing low, −1 = swing high
function pivotAt(s, p, side) {
  const B = s.bars, K = p.pivotK, j = B.length - 1 - K;
  if (j < K) return null;
  const x = side > 0 ? B[j].l : B[j].h;
  for (let i = j - K; i <= j + K; i++) { if (i === j) continue; const y = side > 0 ? B[i].l : B[i].h; if (i < j ? side * (y - x) <= 0 : side * (y - x) < 0) return null; } // a tie goes to the earlier bar
  return { k: B[j].k, px: x, rsi: B[j].rsi, macd: B[j].macd, atr: B[j].atr, side };
}
// RSI over a list of closes (oldest first)
function rsiList(cl, L) {
  const out = []; let ag = 0, al = 0;
  for (let i = 0; i < cl.length; i++) {
    if (i) { const d = cl[i] - cl[i - 1]; ag = (ag * (L - 1) + Math.max(d, 0)) / L; al = (al * (L - 1) + Math.max(-d, 0)) / L; }
    out.push(al > 0 ? 100 - 100 / (1 + ag / al) : ag > 0 ? 100 : 50);
  }
  return out;
}
// higher timeframe: divergence (side +1: a new/equal low with higher RSI) and trend (close beyond EMA bowlLen)
function htfRead(api, coin, p, side) {
  const h = api.hist(coin, p.htf); const n = h ? h.len : 0;
  if (n < Math.max(p.htfLook, p.bowlLen) + 20) return { div: false, bowl: false };
  const bars = []; for (let k = n - 1; k >= 0; k--) bars.push(h.at(k));
  const r = rsiList(bars.map((b) => b.c), p.rsiLen);
  let e = bars[0].c; const kk = 2 / (p.bowlLen + 1); for (const b of bars) e += kk * (b.c - e);
  const last = bars.length - 1, ext = (b) => (side > 0 ? b.l : b.h);
  let m1 = -1, m2 = -1;
  for (let i = last - p.htfLook; i <= last; i++) {
    if (i < 0) continue;
    if (i > last - p.htfRecent) { if (m2 < 0 || side * (ext(bars[i]) - ext(bars[m2])) < 0) m2 = i; }
    else if (m1 < 0 || side * (ext(bars[i]) - ext(bars[m1])) < 0) m1 = i;
  }
  const atrH = bars.slice(-14).reduce((a, b) => a + (b.h - b.l), 0) / 14;
  const div = m1 >= 0 && m2 >= 0 && side * (ext(bars[m2]) - ext(bars[m1])) <= 0.25 * atrH && side * (r[m2] - r[m1]) > p.minRsiDelta;
  return { div, bowl: side * (bars[last].c - e) > 0 };
}
// falling wedge (side +1) / rising wedge (side −1) on the last three pivot highs and lows
function wedge(s, side) {
  const hs = s.highs.slice(-3), ls = s.lows.slice(-3);
  if (hs.length < 3 || ls.length < 3) return false;
  const dn = (a) => a[0].px > a[1].px && a[1].px > a[2].px, up = (a) => a[0].px < a[1].px && a[1].px < a[2].px;
  const slope = (a) => (a[2].px - a[0].px) / Math.max(1, a[2].k - a[0].k);
  return side > 0 ? dn(hs) && dn(ls) && slope(hs) < slope(ls) : up(hs) && up(ls) && slope(ls) > slope(hs);
}
// highest high (side +1) / lowest low (side −1) between bar counts k0..k1, and the opposite extreme before it
function impulse(s, k0, k1, side) {
  let A = null;
  for (const b of s.bars) { if (b.k < k0 || b.k > k1) continue; const x = side > 0 ? b.h : b.l; if (!A || side * (x - A.px) > 0) A = { k: b.k, px: x }; }
  if (!A) return null;
  let X = null;
  for (const b of s.bars) { if (b.k < A.k - (k1 - k0) || b.k >= A.k) continue; const x = side > 0 ? b.l : b.h; if (!X || side * (x - X.px) < 0) X = { k: b.k, px: x }; }
  return X ? { A, X } : null;
}

function evaluate(s, api, coin, p, side, P2) {
  const pivots = side > 0 ? s.lows : s.highs;
  let P1 = null;
  for (let i = pivots.length - 2; i >= 0; i--) { const g = P2.k - pivots[i].k; if (g >= p.minGap && g <= p.maxGap) { P1 = pivots[i]; break; } if (g > p.maxGap) break; }
  const atr = P2.atr, got = [];
  let divR = false, divM = false;
  if (P1) {
    const beyond = side * (P2.px - P1.px) < 0; // a new extreme: classic divergence; else hidden
    if (beyond || p.hidden) {
      const sgn = beyond ? 1 : -1;
      divR = sgn * side * (P2.rsi - P1.rsi) > p.minRsiDelta;
      divM = sgn * side * (P2.macd - P1.macd) > 0;
    }
  }
  if (divR) got.push('RSI div'); if (divM) got.push('MACD div');
  // look left: older pivots near this price
  let touches = 0, level = P2.px;
  for (const q of s.highs.concat(s.lows)) {
    if (q.k > P2.k - p.leftMin || q.k < P2.k - p.win) continue;
    if (Math.abs(q.px - P2.px) <= p.srTol * atr) { touches++; if (side * (level - q.px) > 0) level = q.px; }
  }
  if (touches >= p.srTouches) got.push(`S/R x${touches}`); else level = P2.px;
  if ((P1 && Math.abs(P2.px - P1.px) <= p.dbTol * atr) || wedge(s, side)) got.push(P1 && Math.abs(P2.px - P1.px) <= p.dbTol * atr ? 'double bottom' : 'wedge');
  // long: the highest high of the last fibLook bars (the drop's start, anchor of the targets) and the low before it
  // (the impulse whose retracement is measured); short: the mirror
  const imp = impulse(s, P2.k - p.fibLook, P2.k, side);
  if (imp && Math.abs(imp.A.px - imp.X.px) >= p.minLegAtr * atr) {
    const ret = (imp.A.px - P2.px) / (imp.A.px - imp.X.px);
    if (ret >= p.zone[0] - p.zoneTol && ret <= p.zone[1] + p.zoneTol) got.push(`fib ${(ret * 100).toFixed(0)}%`);
  }
  const H = p.htf ? htfRead(api, coin, p, side) : { div: false, bowl: false };
  if (H.div) got.push(`${p.htf}m div`);
  if (H.bowl) got.push('bowl');
  if (p.needDiv && !divR && !divM) return null;
  if (got.length < p.minScore) return null;
  return { got, level, top: imp ? imp.A.px : null };
}

module.exports = {
  name: 'mixing-bowl', version: 1, tfs: [30, 45], needsRef: false,
  params: { tf: 45, htf: 1440, win: 300, pivotK: 2, minGap: 5, maxGap: 60, rsiLen: 14, fast: 12, slow: 26, sig: 9, atrLen: 14,
    minRsiDelta: 2, hidden: true, leftMin: 10, srTol: 0.5, srTouches: 2, dbTol: 0.5, fibLook: 120, minLegAtr: 3, zone: [0.382, 0.618], zoneTol: 0.03,
    htfLook: 40, htfRecent: 3, bowlLen: 50, minScore: 4, needDiv: true, stopPad: 0.5, tgts: [0.382, 0.618, 1], minRR: 3, holdBars: 60,
    entry: 'taker', cooldownBars: 6, sides: [1, -1], minBars: 150 },
  bounds: { minScore: [3, 6], minRR: [1.5, 4], stopPad: [0.2, 1.5], holdBars: [20, 120] },
  onBar(ev, api) {
    const { coin, tf, bar } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) { // first bar seen: replay the seeded history (no ideas from the past)
      st.m = { n: 0, bars: [], lows: [], highs: [] };
      const h = api.hist(coin, tf), n = h ? h.len : 0;
      for (let i = n - 1; i >= 1; i--) { upd(st.m, h.at(i), p); track(st.m, p); }
    }
    const s = st.m;
    upd(s, bar, p);
    const fresh = track(s, p);
    if (s.n < p.minBars || (st.until || 0) > api.now) return null;
    for (const P2 of fresh) {
      const side = P2.side;
      if (!p.sides.includes(side)) continue;
      const e = evaluate(s, api, coin, p, side, P2);
      if (!e) continue;
      const c = bar.c, atr = s.atr;
      const stop = Math.min(side * P2.px, side * e.level) * side - side * p.stopPad * atr;
      if (side * (c - stop) <= 0) continue;
      const risk = Math.abs(c - stop);
      if (e.top == null) continue;
      let target = null, f = null;
      for (const g of p.tgts) { const tg = P2.px + g * (e.top - P2.px); if (side * (tg - c) >= p.minRR * risk) { target = tg; f = g; break; } }
      if (target == null) continue;
      const entry = p.entry === 'maker' ? { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true } : { kind: 'taker', px: c };
      return { coin, side, entry, stop, target, trail: null, timeStopMin: p.holdBars * tf,
        why: `${tf}m mixing bowl ${side > 0 ? 'long' : 'short'} (${e.got.length}: ${e.got.join(', ')}), target ${(f * 100).toFixed(1)}% of the ${side > 0 ? 'drop' : 'rally'}, ${(Math.abs(target - c) / risk).toFixed(1)}:1` };
    }
    return null;
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
// record pivots confirmed on the newest bar; returns them
function track(s, p) {
  const out = [];
  for (const side of [1, -1]) {
    const q = pivotAt(s, p, side);
    if (!q) continue;
    const list = side > 0 ? s.lows : s.highs;
    if (list.length && list[list.length - 1].k === q.k) continue;
    list.push(q); if (list.length > 40) list.shift();
    out.push(q);
  }
  return out;
}
