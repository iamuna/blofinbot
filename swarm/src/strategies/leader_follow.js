/* Leader follow: when BTC makes an outsized 1-minute move, coins that usually move with it (beta) but have not
 * caught up yet are bought (sold) at market, targeting most of the expected catch-up within 10 minutes.
 * Evidence: fast lead-lag between coins exists, though at tick level BTC often lags (Long 2025); from a home PC
 * only minute-scale lags are reachable. Weakest prior — first to be cut if it does not pay.
 */
'use strict';
module.exports = {
  name: 'leader-follow', version: 1, tfs: [1], needsRef: false,
  params: { leader: 'BTC', btcZ: 3, minBtcBps: 25, minBeta: 0.8, lagFrac: 0.5, minGapBps: 20, targetFrac: 0.7, stopAtr: 1.5, holdMin: 10, cooldownMin: 15, minBars: 240 },
  bounds: { btcZ: [2, 6], minBtcBps: [15, 60], lagFrac: [0.2, 0.8], minGapBps: [10, 50], targetFrac: [0.4, 1], holdMin: [3, 30] },
  onBar(ev, api) {
    const { f, bar, coin } = ev, p = api.p, st = api.state(coin);
    if (coin === p.leader || f.bars < p.minBars || !(f.atr > 0) || (st.until || 0) > api.now) return null;
    const L = api.fs.btcLast.get(1);
    if (!L || L.t !== ev.t || Math.abs(L.retZ) < p.btcZ || Math.abs(L.ret) * 1e4 < p.minBtcBps) return null;
    if (!(f.beta >= p.minBeta)) return null;
    const side = Math.sign(L.ret), expected = f.beta * Math.abs(L.ret), own = side * f.ret;
    if (own > p.lagFrac * expected) return null; // already moved
    const gap = expected - Math.max(0, own);
    if (gap * 1e4 < p.minGapBps) return null;
    const px = bar.c;
    return {
      coin, side, entry: { kind: 'taker', px, waitMin: 1 },
      stop: px - side * p.stopAtr * f.atr, target: px * (1 + side * p.targetFrac * gap), trail: null, timeStopMin: p.holdMin,
      why: `BTC ${(L.ret * 1e4).toFixed(0)} bps (z ${L.retZ.toFixed(1)}), ${coin} beta ${f.beta.toFixed(2)} moved ${(f.ret * 1e4).toFixed(0)} bps, gap ${(gap * 1e4).toFixed(0)} bps`,
    };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownMin * 60000; },
};
