/* Squeeze ride: when a coin jumps hard in 15 minutes while open interest FALLS, shorts are being forced out (stops
 * and liquidations buy at market) — and a squeeze that is under way tends to keep going for the next hour.
 * Evidence (our data, exploratory — docs/RESEARCH_LOG.md, 2026-10-20): after a 15-minute rise of 3.5+ standard
 * deviations with open interest down 1.5%+, the next 60 minutes averaged +78 bps (241 distinct times, t 2.5;
 * +48 bps, t 1.6, after removing the market's move). Weaker evidence than dip-reversal: shadow decides.
 */
'use strict';
module.exports = {
  name: 'squeeze-ride', version: 1, tfs: [5], needsRef: true,
  params: { z: 3.5, oiDrop: 0.015, lookBars: 3, volBars: 288, minStopAtr: 1.5, holdMin: 60, entry: 'maker', waitMin: 3, cooldownMin: 60, minBars: 300 },
  bounds: { z: [2.5, 6], oiDrop: [0.005, 0.05], holdMin: [30, 120], waitMin: [1, 10] },
  onBar(ev, api) {
    const { coin, bar, f } = ev, p = api.p, st = api.state(coin);
    if (f.bars < p.minBars || !(f.atr > 0) || (st.until || 0) > api.now) return null;
    const h = api.hist(coin, 5);
    if (!h || h.len < p.volBars + p.lookBars + 2) return null;
    const r = Math.log(h.at(0).c / h.at(p.lookBars).c);
    let s = 0, s2 = 0, n = 0;
    for (let k = 1; k <= p.volBars; k++) { const x = Math.log(h.at(k).c / h.at(k + p.lookBars).c); s += x; s2 += x * x; n++; }
    const sd = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
    if (!(sd > 0) || r / sd < p.z) return null;
    const oi = api.oiChange(coin, 15);
    if (oi == null || oi > -p.oiDrop) return null;
    const px = bar.c, base = h.at(p.lookBars).c;
    const stop = Math.min(base, px - p.minStopAtr * f.atr); // a full give-back of the squeeze ends it
    const entry = p.entry === 'taker' ? { kind: 'taker', px } : { kind: 'maker', px, waitMin: p.waitMin, fallback: 'cancel', chase: true };
    return { coin, side: 1, entry, stop, target: null, trail: null, timeStopMin: p.holdMin, why: `15m jump +${(r * 1e4).toFixed(0)} bps (z ${(r / sd).toFixed(1)}) with open interest ${(oi * 100).toFixed(1)}%` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownMin * 60000; },
};
