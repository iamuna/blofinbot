/* Intraday trend: 15/30/45-minute breakouts confirmed by volume and a clean path, sized to volatility.
 * Evidence: volatility-targeted high-frequency trend ensembles on BTC, gross Sharpe ~1.6 over 2018–2025
 * (Concretum); our own 1h–3M trend engine. Entry with a maker order at the breakout close; ATR stop; trailing
 * stop once the trade is 1R up; time stop after holdBars bars.
 */
'use strict';
module.exports = {
  name: 'intraday-trend', version: 1, tfs: [15, 30, 45], needsRef: false,
  params: { minVotes: 2, volZ: 0.5, er: 0.3, stopAtr: 2.0, trailAtr: 3.0, trailAfterR: 1.0, holdBars: 8, waitMin: 5, againstBias: -0.34, cooldownBars: 4, minBars: 60 },
  bounds: { volZ: [0, 2], er: [0.15, 0.5], stopAtr: [1, 3.5], trailAtr: [1.5, 5], holdBars: [4, 16] },
  onBar(ev, api) {
    const { f, bar, coin, tf } = ev, p = api.p, st = api.state(coin);
    if (f.bars < p.minBars || !(f.atr > 0) || (st.until || 0) > api.now) return null;
    const up = (bar.c > f.dc20h) + (bar.c > f.dc55h) + (f.ema20 > f.ema50 && f.slope20 > 0.1);
    const dn = (bar.c < f.dc20l) + (bar.c < f.dc55l) + (f.ema20 < f.ema50 && f.slope20 < -0.1);
    const side = up >= p.minVotes && dn === 0 ? 1 : dn >= p.minVotes && up === 0 ? -1 : 0;
    if (!side || f.volZ < p.volZ || !(f.er20 >= p.er)) return null;
    if (f.flowZ != null && f.flowZ * side < -0.5) return null; // takers pushing the other way
    const rg = api.regime(coin);
    if (rg.warm && rg.bias * side < p.againstBias) return null;
    const px = bar.c;
    return {
      coin, side, entry: { kind: 'maker', px, waitMin: p.waitMin, fallback: 'cancel' },
      stop: px - side * p.stopAtr * f.atr, target: null, trail: { dist: p.trailAtr * f.atr, afterR: p.trailAfterR },
      timeStopMin: p.holdBars * tf,
      why: `${tf}m breakout ${Math.max(up, dn)}/3, volZ ${f.volZ.toFixed(1)}, er ${f.er20.toFixed(2)}, bias ${rg.bias.toFixed(2)}`,
    };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * r.idea.tf * 60000; },
};
