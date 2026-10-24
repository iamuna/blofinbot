/* ORB retest (2026-10-23): the New York opening-range breakout, entered on a pullback to a "common-sense level".
 * Source: Trade with Pat, "If I Could Only Trade ONE 5 Minute Scalping Strategy" (YouTube OkwrhkWfFC0, 2026-10-18);
 * the TradingView version is docs/pine/orb_common_sense_scalper.pine.
 *
 * 1. Opening range: high / low of the 9:30–9:45 New York 15-minute candle (three 5m bars; DST handled below).
 * 2. Break & close: the first 5m close outside the range, before 12:00 New York, sets the side.
 * 3. Don't chase: rest a maker limit at the nearest proven level between the close and the far side of the range —
 *    a flip zone (a swing high the break went through that at least minTouches swings sit on; lows for shorts),
 *    else a demand / supply zone (the last candle before impulseN strong candles the trade's way, not revisited),
 *    else the range edge. Stop beyond the other side of the range ('range') or beyond the zone ('zone');
 *    target tgtR × risk; the order waits until 12:00 and the trade is closed around 15:55 New York.
 * Differences from the video / Pine version: no half-off at 1R with break-even (the sim takes one exit; break-even
 * cost the robust five 10% of their R, RESEARCH_LOG 2026-10-23); an unfilled order is not pulled early when
 * price closes through the stop or reaches the target first, it simply waits out the window.
 * One trade a day per coin by default; after an order that never fills, a fresh break counts once price has closed
 * back inside the range.
 */
'use strict';
const DAY = 1440, MIN = 60000;

// New York's offset from UTC in minutes: −240 from the second Sunday of March 07:00 UTC to the first Sunday of
// November 06:00 UTC, else −300
function nyOffset(t) {
  const y = new Date(t).getUTCFullYear();
  const sunday = (m, n) => { const d1 = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + ((7 - d1) % 7) + 7 * (n - 1); };
  const start = Date.UTC(y, 2, sunday(2, 2), 7), end = Date.UTC(y, 10, sunday(10, 1), 6);
  return t >= start && t < end ? -240 : -300;
}
const nyMin = (t) => (((Math.floor(t / MIN) + nyOffset(t)) % DAY) + DAY) % DAY;
const nyDay = (t) => Math.floor((Math.floor(t / MIN) + nyOffset(t)) / DAY);

// swing points among bars at offsets [from, to] of the history (newest first); each needs piv bars on both sides
function swings(h, from, to, piv) {
  const out = [];
  for (let k = from + piv; k <= to && k + piv < h.len; k++) {
    const b = h.at(k);
    let hi = true, lo = true;
    for (let j = 1; j <= piv; j++) {
      const a = h.at(k - j), c = h.at(k + j);
      if (!(b.h > a.h && b.h >= c.h)) hi = false;
      if (!(b.l < a.l && b.l <= c.l)) lo = false;
    }
    if (hi) out.push({ px: b.h, high: true, k });
    if (lo) out.push({ px: b.l, high: false, k });
  }
  return out;
}

// flip zone: the nearest old resistance below the close (long) / old support above it (short), past the bound
function flipLevel(sw, side, close, bound, tol, minTouches) {
  let best = null;
  for (const s of sw) {
    if (s.high !== side > 0) continue;
    if (!(side > 0 ? s.px < close && s.px > bound : s.px > close && s.px < bound)) continue;
    let touches = 0;
    for (const o of sw) if (Math.abs(o.px - s.px) <= tol) touches++;
    if (touches >= minTouches && (!best || side * (s.px - best.px) > 0)) best = s;
  }
  return best;
}

// demand (long) / supply (short) zone: the base candle before n strong candles the trade's way (the breakout candle
// may be the last of them), untouched since. at(0) = the breakout bar, at(1) the bar before it …
function zoneLevel(at, len, side, close, bound, n, minBody, look) {
  let bodySum = 0, cnt = 0;
  for (let i = 1; i <= 20 && i < len; i++) { bodySum += Math.abs(at(i).c - at(i).o); cnt++; }
  const avgBody = cnt ? bodySum / cnt : 0;
  for (let k = n; k <= look && k < len; k++) {
    let ok = true;
    for (let j = 1; j <= n && ok; j++) { const b = at(k - j), body = b.c - b.o; if (side * body <= 0 || Math.abs(body) < minBody * avgBody) ok = false; }
    if (!ok) continue;
    const base = at(k), top = side > 0 ? base.h : base.l, bot = side > 0 ? base.l : base.h;
    let fresh = true;
    for (let m = 0; m < k - n && fresh; m++) if (side > 0 ? at(m).l <= top : at(m).h >= top) fresh = false;
    if (fresh && side * (close - top) > 0 && side * (bot - bound) > 0) return { top, bot, k };
  }
  return null;
}

module.exports = {
  name: 'orb-retest', version: 2, tfs: [5], needsRef: false, // v2: the zone finder sees the newest zones, breakout candle included
  params: {
    orStart: 570, orMin: 15, entryEnd: 720, dayEnd: 955, // New York minutes of the day: 9:30, 15 min, 12:00, 15:55
    level: 'auto', // 'auto' (flip → zone → edge), 'flip', 'zone', 'edge'
    pivot: 3, flipLook: 120, minTouches: 2, tolAtr: 0.25, impulseN: 3, impulseBody: 1.0, zoneLook: 60,
    stop: 'range', stopPadAtr: 0.1, tgtR: 2, minRiskBps: 25, maxTrades: 1, rebreak: true, withBias: false, minBars: 150,
  },
  bounds: { tgtR: [1, 4], minTouches: [1, 4], tolAtr: [0.1, 0.6], stopPadAtr: [0, 0.5], minRiskBps: [10, 80] },
  onBar(ev, api) {
    const { coin, tf, bar, f } = ev, p = api.p;
    if (tf !== 5 || !(f.atr > 0) || f.bars < p.minBars) return null;
    const h = api.hist(coin, 5);
    if (!h) return null;
    const first = h.len && h.at(0).t === bar.t ? 1 : 0; // the history may already hold this bar
    const st = api.state(coin), day = nyDay(bar.t), m = nyMin(bar.t), orEnd = p.orStart + p.orMin;
    if (st.day !== day) { st.day = day; st.orH = null; st.orL = null; st.armed = false; st.needInside = false; st.trades = 0; st.pending = false; }

    // step 1: the range is set when its last 5m bar closes
    if (m + 5 === orEnd) {
      const bars = [bar];
      for (let k = first; k < h.len && bars.length < p.orMin / 5; k++) { const b = h.at(k); if (nyDay(b.t) === day && nyMin(b.t) >= p.orStart) bars.push(b); else break; }
      if (bars.length === p.orMin / 5) { st.orH = Math.max(...bars.map((b) => b.h)); st.orL = Math.min(...bars.map((b) => b.l)); st.armed = true; }
      return null;
    }
    if (st.orH == null || m < orEnd || m + 5 > p.entryEnd) return null;
    const c = bar.c;
    if (st.needInside) { if (c <= st.orH && c >= st.orL) { st.needInside = false; st.armed = true; } return null; }
    if (!st.armed || st.pending || st.trades >= p.maxTrades) return null;

    // step 2: break & close outside the range
    const side = c > st.orH ? 1 : c < st.orL ? -1 : 0;
    if (!side) return null;
    st.armed = false;
    const skip = () => { if (p.rebreak) st.needInside = true; return null; };
    if (p.withBias && side * api.regime(coin).bias <= 0) return skip();

    // step 3: the common-sense level
    const bound = side > 0 ? st.orL : st.orH, tol = p.tolAtr * f.atr;
    let lvl = null;
    if (p.level === 'auto' || p.level === 'flip') {
      const s = flipLevel(swings(h, first, first + p.flipLook, p.pivot), side, c, bound, tol, p.minTouches);
      if (s) lvl = { px: s.px, edge: s.px - side * tol, kind: 'flip zone' };
    }
    if (!lvl && (p.level === 'auto' || p.level === 'zone')) {
      const z = zoneLevel((i) => (i === 0 ? bar : h.at(first + i - 1)), h.len - first + 1, side, c, bound, p.impulseN, p.impulseBody, p.zoneLook);
      if (z) lvl = { px: z.top, edge: z.bot, kind: side > 0 ? 'demand zone' : 'supply zone' };
    }
    if (!lvl && (p.level === 'auto' || p.level === 'edge')) lvl = { px: side > 0 ? st.orH : st.orL, edge: (st.orH + st.orL) / 2, kind: 'range edge' };
    if (!lvl) return skip();

    const px = lvl.px, stop = (p.stop === 'zone' ? lvl.edge : side > 0 ? st.orL : st.orH) - side * p.stopPadAtr * f.atr;
    const risk = side * (px - stop);
    if (!(risk > 0) || (risk / px) * 1e4 < p.minRiskBps) return skip();
    const now = api.now, nowM = nyMin(now - MIN) + 1; // the bar's close in New York minutes (13:00 stays 13:00, not 0)
    st.pending = true;
    return {
      coin, side, entry: { kind: 'maker', px, waitMin: Math.max(1, p.entryEnd - nowM), fallback: 'cancel' },
      stop, target: px + side * p.tgtR * risk, trail: null, timeStopMin: Math.max(5, p.dayEnd - nowM),
      why: `5m close ${side > 0 ? 'above' : 'below'} the NY opening range ${st.orL}–${st.orH}; limit at the ${lvl.kind}, stop beyond the ${p.stop === 'zone' ? 'zone' : 'range'}, ${p.tgtR}R`,
    };
  },
  onClose(coin, r, k) {
    const st = k.state(coin);
    st.pending = false;
    if (r.outcome === 'unfilled' || r.outcome === 'stop-crossed-before-fill') { if (k.p.rebreak) st.needInside = true; } else st.trades = (st.trades || 0) + 1;
  },
};
