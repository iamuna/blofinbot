/* 21 / 200 moving averages, tested at Ibrahim's request (2026-10-20). Moving averages of the chosen timeframe's
 * closes (EMA or SMA, both lengths settable). Price's position against both lines decides the side:
 *   long side:  fast above slow and price above both;  short side: fast below slow and price below both.
 *   mode 'cross':    enter on the bar the fast line crosses the slow one, if price is already on the right side.
 *   mode 'retest':   after a cross (within retestBars), wait for price to pull back to the fast line (a bar's low
 *                    touches it, the close stays beyond the slow line) and enter when a bar closes back beyond the
 *                    fast line — "21 crosses above 200, price corrects and holds above it: long".
 *   mode 'pullback': the same pull-back-and-hold entry at any time while the trend holds (no recent cross needed).
 * Stop stopAtr × ATR beyond the pull-back's extreme (or the entry, for 'cross'); target rr × risk (0 = none);
 * optional trailing stop; time stop holdBars bars.
 */
'use strict';
module.exports = {
  name: 'ma-21-200', version: 1, tfs: [5, 15, 30, 45], needsRef: false,
  params: { mode: 'retest', tf: 15, fast: 21, slow: 200, kind: 'ema', retestBars: 48, stopAtr: 1, rr: 2, trailAtr: 0, trailAfterR: 1, holdBars: 48, entry: 'maker', cooldownBars: 4 },
  bounds: { retestBars: [12, 96], stopAtr: [0.5, 3], rr: [0, 4], holdBars: [12, 96] },
  onBar(ev, api) {
    const { coin, tf, bar, f } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) st.m = { n: 0, ef: bar.c, es: bar.c, closes: [], sf: 0, ss: 0, rel: 0, crossAgo: Infinity, side: 0, touched: false, ext: 0 };
    const m = st.m, c = bar.c;
    // moving averages
    m.n++; m.closes.push(c); m.sf += c; m.ss += c;
    if (m.closes.length > p.fast) m.sf -= m.closes[m.closes.length - 1 - p.fast];
    if (m.closes.length > p.slow) { m.ss -= m.closes[0]; m.closes.shift(); }
    m.ef += (2 / (p.fast + 1)) * (c - m.ef); m.es += (2 / (p.slow + 1)) * (c - m.es);
    if (m.n < p.slow + 10 || !(f.atr > 0)) return null;
    const fast = p.kind === 'sma' ? m.sf / p.fast : m.ef, slow = p.kind === 'sma' ? m.ss / p.slow : m.es;
    const rel = fast > slow ? 1 : fast < slow ? -1 : 0;
    const crossed = rel !== 0 && m.rel !== 0 && rel !== m.rel;
    if (rel !== m.rel) { m.touched = false; m.ext = 0; }
    m.rel = rel;
    m.crossAgo = crossed ? 0 : m.crossAgo + 1;
    if (!rel || (st.until || 0) > api.now) return null;
    const side = rel;
    const beyondBoth = side * (c - fast) > 0 && side * (c - slow) > 0;
    let go = false, extreme = c;
    if (p.mode === 'cross') go = crossed && beyondBoth;
    else {
      if (p.mode === 'retest' && m.crossAgo > p.retestBars) return null;
      const reach = side > 0 ? bar.l : bar.h;
      if (side * (reach - fast) <= 0 && side * (c - slow) > 0) { // pulled back to the fast line, still beyond the slow one
        m.ext = m.touched ? (side > 0 ? Math.min(m.ext, bar.l) : Math.max(m.ext, bar.h)) : reach; m.touched = true;
      }
      if (side * (c - slow) <= 0) { m.touched = false; return null; } // fell through the slow line: no trend left
      if (m.touched && side * (c - fast) > 0) { go = true; extreme = m.ext; m.touched = false; }
    }
    if (!go) return null;
    const stop = extreme - side * p.stopAtr * f.atr;
    if (side * (c - stop) <= 0) return null;
    const risk = Math.abs(c - stop);
    const entry = p.entry === 'taker' ? { kind: 'taker', px: c } : { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true };
    return { coin, side, entry, stop, target: p.rr > 0 ? c + side * p.rr * risk : null,
      trail: p.trailAtr > 0 ? { dist: p.trailAtr * f.atr, afterR: p.trailAfterR } : null, timeStopMin: p.holdBars * tf,
      why: `${tf}m ${p.kind}${p.fast} ${side > 0 ? 'above' : 'below'} ${p.kind}${p.slow}, ${p.mode}${m.crossAgo < Infinity ? `, cross ${m.crossAgo} bars ago` : ''}` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
