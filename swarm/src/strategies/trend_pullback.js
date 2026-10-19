/* Trend pullback: when the big-picture trend (hours to weeks) is clear, buy dips (sell rallies) of about one ATR
 * below the 20-bar average on 5/15-minute bars, with a resting maker order a little further out.
 * Evidence: our 1h–3M trend engine (Sharpe ~1.0 on coins it never saw); liquid coins show momentum, not reversal,
 * at daily horizons (Zaremba et al. 2021). Target 1.5R, stop 2 ATR beyond the entry, time stop 2 hours.
 */
'use strict';
module.exports = {
  name: 'trend-pullback', version: 1, tfs: [5, 15], needsRef: false,
  params: { minBias: 0.5, dipAtr: 1.0, barZ: 1.0, limitAtr: 0.3, stopAtr: 2.0, targetR: 1.5, holdMin: 120, waitMin: 15, cooldownMin: 60, minBars: 60 },
  bounds: { minBias: [0.3, 0.9], dipAtr: [0.5, 2], limitAtr: [0, 1], stopAtr: [1, 3.5], targetR: [0.8, 3], holdMin: [30, 240] },
  onBar(ev, api) {
    const { f, bar, coin } = ev, p = api.p, st = api.state(coin);
    if (f.bars < p.minBars || !(f.atr > 0) || (st.until || 0) > api.now) return null;
    const rg = api.regime(coin);
    if (!rg.warm || Math.abs(rg.bias) < p.minBias) return null;
    const side = Math.sign(rg.bias);
    if (side * (bar.c - f.ema20) > -p.dipAtr * f.atr) return null; // not a real dip
    if (side * f.retZ > -p.barZ) return null; // this bar did not move against the trend
    if (f.flowZ != null && side * f.flowZ < -3) return null; // a selling (buying) flood: wait
    const px = bar.c - side * p.limitAtr * f.atr, stop = px - side * p.stopAtr * f.atr;
    return {
      coin, side, entry: { kind: 'maker', px, waitMin: p.waitMin, fallback: 'cancel', chase: false },
      stop, target: px + side * p.targetR * Math.abs(px - stop), trail: null, timeStopMin: p.holdMin,
      why: `bias ${rg.bias.toFixed(2)}, ${ev.tf}m dip ${((bar.c - f.ema20) / f.atr).toFixed(1)} ATR from ema20`,
    };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownMin * 60000; },
};
