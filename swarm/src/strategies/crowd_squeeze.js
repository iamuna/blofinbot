/* Crowd squeeze: when funding is extreme (one side is paying heavily to hold) and open interest is still rising,
 * a breakout against the crowded side can force them out. Trade that breakout on 5/15-minute bars.
 * Evidence: perpetual premiums follow past returns and crowding (He, Manela, Ross & von Wachter); clustered
 * liquidations amplify moves (qualitative). Weak prior: starts small, kept only if it pays.
 */
'use strict';
module.exports = {
  name: 'crowd-squeeze', version: 1, tfs: [5, 15], needsRef: true,
  params: { fundingAbs: 0.0003, oiUpPct: 0.02, oiMin: 60, stopAtr: 1.5, targetAtr: 3, holdMin: 90, waitMin: 5, cooldownMin: 120, minBars: 60 },
  bounds: { fundingAbs: [0.0001, 0.001], oiUpPct: [0, 0.08], stopAtr: [1, 3], targetAtr: [1.5, 6], holdMin: [30, 240] },
  onBar(ev, api) {
    const { f, bar, coin } = ev, p = api.p, st = api.state(coin);
    if (f.bars < p.minBars || !(f.atr > 0) || (st.until || 0) > api.now) return null;
    const x = api.ctx(coin);
    if (x.funding == null || Math.abs(x.funding) < p.fundingAbs) return null;
    const crowd = Math.sign(x.funding), side = -crowd;
    const oi = api.oiChange(coin, p.oiMin);
    if (oi == null || oi < p.oiUpPct) return null;
    const broke = side > 0 ? bar.c > f.dc20h : bar.c < f.dc20l;
    if (!broke || (f.flowZ != null && side * f.flowZ < 0.5)) return null;
    const px = bar.c;
    return {
      coin, side, entry: { kind: 'maker', px, waitMin: p.waitMin, fallback: 'cancel' },
      stop: px - side * p.stopAtr * f.atr, target: px + side * p.targetAtr * f.atr, trail: null, timeStopMin: p.holdMin,
      why: `funding ${(x.funding * 100).toFixed(3)}%/8h (${crowd > 0 ? 'longs' : 'shorts'} crowded), OI +${(oi * 100).toFixed(1)}%/${p.oiMin}m, ${ev.tf}m break`,
    };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownMin * 60000; },
};
