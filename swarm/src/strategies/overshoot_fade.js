/* Overshoot fade: after an extreme 1–5 minute move pushed by aggressive takers (and often liquidations), rest a
 * maker order a little further out and take half the move back.
 * Evidence: 15-minute reversal in 98% of 183 coins, but ~1 bp average — too small; it grows with the size of the
 * move and after taker-driven moves (Kitron & Wengrowicz 2026). So only the extremes are traded.
 */
'use strict';
module.exports = {
  name: 'overshoot-fade', version: 1, tfs: [1, 3, 5], needsRef: true,
  params: { retZ: 4, flowZ: 1.5, volZ: 2, minMoveBps: 40, limitFrac: 0.15, targetFrac: 0.5, stopPadAtr: 0.5, holdMin: 30, waitMin: 3, cooldownMin: 30, minBars: 120 },
  bounds: { retZ: [3, 7], flowZ: [0.5, 3], minMoveBps: [20, 120], limitFrac: [0, 0.5], targetFrac: [0.25, 0.8], holdMin: [10, 60] },
  onBar(ev, api) {
    const { f, bar, coin } = ev, p = api.p, st = api.state(coin);
    if (f.bars < p.minBars || !(f.atr > 0) || (st.until || 0) > api.now) return null;
    if (Math.abs(f.retZ) < p.retZ || Math.abs(f.ret) * 1e4 < p.minMoveBps || f.volZ < p.volZ) return null;
    const dir = Math.sign(f.ret);
    if (f.flowZ == null || dir * f.flowZ < p.flowZ) return null; // the move must be taker-driven
    const side = -dir, range = bar.h - bar.l;
    const px = bar.c - dir * p.limitFrac * range; // a little further in the direction of the move
    const extreme = dir > 0 ? bar.h : bar.l;
    const stop = extreme + dir * p.stopPadAtr * f.atr;
    const target = px + side * p.targetFrac * range;
    const liq = api.liqSum(coin, 5), forced = dir < 0 ? liq.long : liq.short;
    return {
      coin, side, entry: { kind: 'maker', px, waitMin: p.waitMin, fallback: 'cancel', chase: false }, stop, target, trail: null, timeStopMin: p.holdMin,
      why: `${ev.tf}m ${dir > 0 ? 'spike' : 'flush'} ${(f.ret * 1e4).toFixed(0)} bps (z ${f.retZ.toFixed(1)}, flow z ${f.flowZ.toFixed(1)})${forced ? `, $${Math.round(forced / 1000)}k liquidated` : ''}`,
    };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownMin * 60000; },
};
