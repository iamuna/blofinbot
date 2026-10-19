/* Probe: a test-only strategy that exercises the whole trade path (idea → risk → order → fill → exit) on the paper
 * account: every third minute it buys BTC at market with a tight target and a 2-minute time stop. Never listed in
 * strategies/index.js; enabled only through config `extraStrategies` (the CI smoke run).
 */
'use strict';
module.exports = {
  name: 'probe', version: 1, tfs: [1], needsRef: false, params: { coin: 'BTC', every: 3 },
  onBar(ev, api) {
    if (ev.coin !== api.p.coin || Math.floor(ev.t / 60000) % api.p.every) return null;
    const px = ev.bar.c;
    return { coin: ev.coin, side: 1, entry: { kind: 'taker', px }, stop: px * 0.995, target: px * 1.0005, trail: null, timeStopMin: 2, why: 'probe' };
  },
};
