/* ma-retest-plus: the 21/200 EMA retest (ma-21-200, mode 'retest' / 'pullback' — the swarm's best-evidenced
 * strategy) with Mitch Ray TA's confluence checks as switches, added 2026-10-23 to test whether his "coinciding
 * variables" improve a strategy that already has an edge. With every switch off it trades exactly like ma-21-200
 * (same entries, stops and targets; a test checks this). The switches:
 *   noDiv     skip a long while the last two swing highs (fractal pivots, pivotK bars each side, the newer within
 *             divLook bars) show bearish RSI divergence (higher high, lower RSI by minRsiDelta) — "we developed
 *             bearish divergence and that was it"; shorts: the mirror on swing lows.
 *   htf       time-scale hopping: the higher timeframe's EMA fast/slow must point the same way (0 = off).
 *   zone      the pull-back must have retraced zone[0]..zone[1] of the impulse before it (lowest low → highest high
 *             of the last fibLook bars for longs); zone[1] null = no upper limit. [0.382, null] is the tested rule:
 *             "a retrace that has not reached the golden zone is not a real swing" — at 4h it doubled avg R in all
 *             three samples (docs/VIDEO_STRATEGIES_2026-10-23.md).
 *   tgtMode   'rr' (default): rr × risk. 'fib': the ext (1.272) extension of that impulse; skipped below minRR.
 */
'use strict';
function push(m, b, p) {
  const c = b.c;
  m.n++; m.closes.push(c); m.sf += c; m.ss += c;
  if (m.closes.length > p.fast) m.sf -= m.closes[m.closes.length - 1 - p.fast];
  if (m.closes.length > p.slow) { m.ss -= m.closes[0]; m.closes.shift(); }
  m.ef += (2 / (p.fast + 1)) * (c - m.ef); m.es += (2 / (p.slow + 1)) * (c - m.es);
  // RSI, recent bars and fractal pivots for the confluence switches
  if (m.pc != null) { const d = c - m.pc, L = p.rsiLen; m.ag = (m.ag * (L - 1) + Math.max(d, 0)) / L; m.al = (m.al * (L - 1) + Math.max(-d, 0)) / L; }
  m.pc = c;
  const rsi = m.al > 0 ? 100 - 100 / (1 + m.ag / m.al) : m.ag > 0 ? 100 : 50;
  m.bars.push({ k: m.n, h: b.h, l: b.l, rsi }); if (m.bars.length > p.fibLook + 2 * p.pivotK + 2) m.bars.shift();
  const B = m.bars, K = p.pivotK, j = B.length - 1 - K;
  if (j >= K) for (const side of [1, -1]) {
    const x = side > 0 ? B[j].h : B[j].l; let ok = true;
    for (let i = j - K; i <= j + K; i++) { if (i === j) continue; const d = side * ((side > 0 ? B[i].h : B[i].l) - x); if (i < j ? d >= 0 : d > 0) { ok = false; break; } } // a tie goes to the earlier bar
    if (ok) { const list = side > 0 ? m.highs : m.lows; list.push({ k: B[j].k, px: x, rsi: B[j].rsi }); if (list.length > 6) list.shift(); }
  }
}
function lines(m, p) {
  const fast = p.kind === 'sma' ? m.sf / p.fast : m.ef, slow = p.kind === 'sma' ? m.ss / p.slow : m.es;
  const rel = fast > slow ? 1 : fast < slow ? -1 : 0;
  const crossed = rel !== 0 && m.rel !== 0 && rel !== m.rel;
  if (rel !== m.rel) { m.touched = false; m.ext = 0; }
  m.rel = rel; m.crossAgo = crossed ? 0 : m.crossAgo + 1;
  return { fast, slow, rel, crossed };
}
// bearish divergence against a long (side +1) on the last two swing highs; bullish against a short
function againstDiv(m, p, side) {
  const list = side > 0 ? m.highs : m.lows;
  if (list.length < 2) return false;
  const [P1, P2] = list.slice(-2);
  if (m.n - P2.k > p.divLook) return false;
  return side * (P2.px - P1.px) > 0 && side * (P1.rsi - P2.rsi) > p.minRsiDelta;
}
function htfSide(api, coin, p) {
  const h = api.hist(coin, p.htf), n = h ? h.len : 0;
  if (n < p.slow + 10) return 0;
  let ef = h.at(n - 1).c, es = ef;
  for (let k = n - 1; k >= 0; k--) { const c = h.at(k).c; ef += (2 / (p.fast + 1)) * (c - ef); es += (2 / (p.slow + 1)) * (c - es); }
  return ef > es ? 1 : ef < es ? -1 : 0;
}
// the impulse before the pull-back: long → highest high of the last fibLook bars and the lowest low before it
function impulse(m, p, side) {
  let A = null, X = null;
  for (const b of m.bars) { const x = side > 0 ? b.h : b.l; if (!A || side * (x - A.px) > 0) A = { k: b.k, px: x }; }
  for (const b of m.bars) { if (b.k >= A.k) break; const x = side > 0 ? b.l : b.h; if (!X || side * (x - X.px) < 0) X = { px: x }; }
  return X ? { A: A.px, X: X.px } : null;
}

module.exports = {
  name: 'ma-retest-plus', version: 1, tfs: [30, 45], needsRef: false,
  params: { mode: 'retest', tf: 45, fast: 21, slow: 200, kind: 'ema', retestBars: 48, stopAtr: 1, rr: 2, trailAtr: 0, trailAfterR: 1, holdBars: 48, entry: 'maker', cooldownBars: 4,
    noDiv: false, htf: 0, zone: null, tgtMode: 'rr', ext: 1.272, minRR: 1, rsiLen: 14, pivotK: 2, divLook: 30, minRsiDelta: 2, fibLook: 60 },
  bounds: { retestBars: [12, 96], stopAtr: [0.5, 3], rr: [0, 4], holdBars: [12, 96] },
  onBar(ev, api) {
    const { coin, tf, bar, f } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) { // first bar seen: start from the history already loaded for this timeframe (seeded at start-up)
      const h = api.hist(coin, tf), n = h ? h.len : 0;
      st.m = { n: 0, ef: n > 1 ? h.at(n - 1).c : bar.c, es: n > 1 ? h.at(n - 1).c : bar.c, closes: [], sf: 0, ss: 0, rel: 0, crossAgo: Infinity, touched: false, ext: 0,
        pc: null, ag: 0, al: 0, bars: [], highs: [], lows: [] };
      for (let k = n - 1; k >= 1; k--) { push(st.m, h.at(k), p); if (st.m.n >= p.slow + 10) lines(st.m, p); }
    }
    const m = st.m, c = bar.c;
    push(m, bar, p);
    if (m.n < p.slow + 10 || !(f.atr > 0)) return null;
    const { fast, slow, rel, crossed } = lines(m, p);
    if (!rel || (st.until || 0) > api.now) return null;
    const side = rel;
    const beyondBoth = side * (c - fast) > 0 && side * (c - slow) > 0;
    let go = false, extreme = c;
    if (p.mode === 'cross') go = crossed && beyondBoth;
    else {
      if (p.mode === 'retest' && m.crossAgo > p.retestBars) return null;
      const reach = side > 0 ? bar.l : bar.h;
      if (side * (reach - fast) <= 0 && side * (c - slow) > 0) {
        m.ext = m.touched ? (side > 0 ? Math.min(m.ext, bar.l) : Math.max(m.ext, bar.h)) : reach; m.touched = true;
      }
      if (side * (c - slow) <= 0) { m.touched = false; return null; }
      if (m.touched && side * (c - fast) > 0) { go = true; extreme = m.ext; m.touched = false; }
    }
    if (!go) return null;
    const stop = extreme - side * p.stopAtr * f.atr;
    if (side * (c - stop) <= 0) return null;
    const risk = Math.abs(c - stop), tags = [];
    // the confluence switches
    if (p.noDiv && againstDiv(m, p, side)) return null;
    if (p.htf) { if (htfSide(api, coin, p) !== side) return null; tags.push(`${p.htf}m agrees`); }
    const imp = (p.zone || p.tgtMode === 'fib') ? impulse(m, p, side) : null;
    if (p.zone) {
      if (!imp || imp.A === imp.X) return null;
      const ret = (imp.A - extreme) / (imp.A - imp.X);
      if (ret < p.zone[0] || (p.zone[1] != null && ret > p.zone[1])) return null; // [min, null] = a minimum depth only
      tags.push(`pull-back ${(ret * 100).toFixed(0)}%`);
    }
    let target = p.rr > 0 ? c + side * p.rr * risk : null;
    if (p.tgtMode === 'fib') {
      if (!imp) return null;
      target = imp.X + p.ext * (imp.A - imp.X); // left to right: from the impulse's start through its end
      if (side * (target - c) < p.minRR * risk) return null;
      tags.push(`target ${p.ext} ext`);
    }
    const entry = p.entry === 'taker' ? { kind: 'taker', px: c } : { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true };
    return { coin, side, entry, stop, target,
      trail: p.trailAtr > 0 ? { dist: p.trailAtr * f.atr, afterR: p.trailAfterR } : null, timeStopMin: p.holdBars * tf,
      why: `${tf}m ${p.kind}${p.fast} ${side > 0 ? 'above' : 'below'} ${p.kind}${p.slow}, ${p.mode}${m.crossAgo < Infinity ? `, cross ${m.crossAgo} bars ago` : ''}${p.noDiv ? ', no divergence against' : ''}${tags.length ? ', ' + tags.join(', ') : ''}` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
