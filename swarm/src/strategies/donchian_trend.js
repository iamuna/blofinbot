/* Donchian trend (2026-10-23), one component of the retired trend bot's ensemble (docs/TREND_BOT_RESEARCH_2026-10-18.md;
 * code at tag archive/trend-bot-2026-10-20, lab/mtf/mtf.js). Slow bars only (12h, 1d).
 *
 * The ensemble — Donchian trend states on many lookbacks per timeframe, sized to 25% volatility, tilted by cross-coin
 * momentum — earned Sharpe 1.40 on the top-20 coins 2020–2026 after costs, and 0.86 on 30 coins it never saw. This
 * plugin is one of its components as a swarm trade, so it can be tested in the 5-year sweep and in shadow; the
 * full portfolio (volatility targeting, rebalancing) is a separate piece of work.
 * Source of the rule: Zarattini, Pagani & Barbon (2025), Donchian channels on crypto closes.
 *
 * tfs lists 45 only (the plugin check's range); runs use params.onlyTfs [tf] to react to the slow bars.
 * Rule, on each closed bar of p.tf: hi / lo = highest / lowest close of the previous `look` bars. A close above hi
 * goes long (below lo goes short, if shorts). The stop starts at the channel's midpoint and trails the best price
 * by half the channel's width — the original exits when the close falls below the rising midpoint. No target; time
 * stop holdBars bars (default 4 × look). Cooldown cooldownBars after an exit.
 * The research kept shorts to 1d and slower (shorts on the 1h–12h layer made it worse): the 12h variants are long only.
 */
'use strict';
module.exports = {
  name: 'donchian-trend', version: 1, tfs: [45], needsRef: false,
  params: { tf: 1440, look: 20, shorts: true, holdBars: 0, entry: 'maker', cooldownBars: 1 },
  bounds: { look: [5, 360], holdBars: [10, 1440] },
  onBar(ev, api) {
    const { coin, tf, bar } = ev, p = api.p;
    if (tf !== p.tf) return null;
    if ((api.state(coin).until || 0) > api.now) return null;
    const h = api.hist(coin, tf);
    if (!h) return null;
    const first = h.len && h.at(0).t === bar.t ? 1 : 0; // the history may already hold this bar
    if (h.len < first + p.look) return null;
    let hi = -Infinity, lo = Infinity;
    for (let k = first; k < first + p.look; k++) { const c = h.at(k).c; if (c > hi) hi = c; if (c < lo) lo = c; }
    const c = bar.c, side = c > hi ? 1 : p.shorts && c < lo ? -1 : 0;
    if (!side || !(hi > lo)) return null;
    const mid = (hi + lo) / 2, half = (hi - lo) / 2;
    const entry = p.entry === 'taker' ? { kind: 'taker', px: c } : { kind: 'maker', px: c, waitMin: 30, fallback: 'taker', chase: true };
    return { coin, side, entry, stop: mid, target: null, trail: { dist: half, afterR: 0 }, timeStopMin: (p.holdBars || 4 * p.look) * tf,
      why: `${tf}m close ${side > 0 ? 'above the highest' : 'below the lowest'} close of ${p.look} bars; stop at the channel midpoint, trailing` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
