/* Dip reversal: buy an outsized 15-minute drop and hold it for about an hour.
 * Mechanism: forced and panicked selling (stops, liquidations, market sells into a thin book) pushes the price
 * past what holders will accept; whoever provides liquidity into it is paid when it settles back.
 * Evidence (our data, exploratory — docs/RESEARCH_LOG.md, 2026-10-20): on 31 coins × 6.5 months of 1-minute bars,
 * after a 15-minute drop of 3.5+ standard deviations the next 60 minutes averaged +28 bps (3,525 distinct times,
 * t 5.2; +22 bps after removing the whole market's move), +36 bps outside the majors, positive in 6 of 7 months.
 * Today's coins rose a lot over that period, which flatters buying dips: the live shadow record decides.
 */
'use strict';
module.exports = {
  name: 'dip-reversal', version: 1, tfs: [5], needsRef: false,
  params: { z: 3.5, lookBars: 3, volBars: 288, stopX: 1.0, minStopAtr: 1.5, holdMin: 60, entry: 'maker', waitMin: 3, cooldownMin: 60, minBars: 300 },
  bounds: { z: [2.5, 6], stopX: [0.5, 2], holdMin: [30, 120], waitMin: [1, 10] },
  onBar(ev, api) {
    const { coin, bar, f } = ev, p = api.p, st = api.state(coin);
    if (f.bars < p.minBars || !(f.atr > 0) || (st.until || 0) > api.now) return null;
    const h = api.hist(coin, 5);
    if (!h || h.len < p.volBars + p.lookBars + 2) return null;
    // the last 15 minutes' return against the spread of 15-minute returns over the day before
    const r = Math.log(h.at(0).c / h.at(p.lookBars).c);
    let s = 0, s2 = 0, n = 0;
    for (let k = 1; k <= p.volBars; k++) { const x = Math.log(h.at(k).c / h.at(k + p.lookBars).c); s += x; s2 += x * x; n++; }
    const sd = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
    if (!(sd > 0) || r / sd > -p.z) return null;
    const px = bar.c, drop = h.at(p.lookBars).c - px;
    const stop = px - Math.max(p.stopX * drop, p.minStopAtr * f.atr);
    const entry = p.entry === 'taker' ? { kind: 'taker', px } : { kind: 'maker', px, waitMin: p.waitMin, fallback: 'cancel', chase: true };
    return { coin, side: 1, entry, stop, target: null, trail: null, timeStopMin: p.holdMin, why: `15m drop ${(r * 1e4).toFixed(0)} bps (z ${(r / sd).toFixed(1)})` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownMin * 60000; },
};
