/* Funding-crowd fade (researcher, 2026-10-21). Slow bars (4h / 12h).
 *
 * Mechanism: when a perpetual's funding rate stays high for days, leveraged longs are crowded and paying to hold
 * (retail trend-chasing demand for leverage). Once price starts to fall, the most leveraged of them hit their
 * liquidation prices or cut, and forced selling pushes price further: the crash risk that high carry predicts.
 * Shorts are also paid the funding while they hold. The mirror (funding deeply negative for days, shorts crowded,
 * price starts to rise) is the long side.
 * Source: Schmeling, Schrimpf & Todorov, "Crypto carry" (BIS WP 1087, 2023; Management Science): high crypto carry
 * (futures premium / funding) predicts future crash risk and liquidations of leveraged longs. Our own 5-year sweep:
 * the positive slow strategies earn mostly on the short side.
 *
 * tfs lists 45 only (the plugin check's range); runs use params.onlyTfs [tf] to react to the slow bars.
 * Rule, on closed bars of p.tf: sample the last settled funding rate every bar; if the average over lookbackH hours
 * and the latest rate are both ≥ fundHi (or both ≤ −fundHi), and the bar closes beyond the extreme of the previous
 * breakBars bars against the crowd, enter against the crowd. Stop stopAtr × ATR beyond the extreme of the last
 * breakBars bars (this one included); no target; time stop holdBars bars. Cooldown cooldownBars after an exit.
 */
'use strict';
module.exports = {
  name: 'funding-fade', version: 1, tfs: [45], needsRef: false,
  params: { tf: 240, lookbackH: 72, fundHi: 0.0003, breakBars: 3, stopAtr: 0.5, holdBars: 12, cooldownBars: 6, entry: 'maker' },
  bounds: { lookbackH: [24, 168], fundHi: [0.0001, 0.001], breakBars: [1, 6], stopAtr: [0.25, 2], holdBars: [6, 30] },
  onBar(ev, api) {
    const { coin, tf, bar, f } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.fund) { st.fund = []; st.bars = []; }
    const x = api.ctx(coin), rate = x ? x.funding : null;
    const need = Math.max(1, Math.round(p.lookbackH * 60 / tf));
    if (rate != null) { st.fund.push(rate); if (st.fund.length > need) st.fund.shift(); }
    const prev = st.bars.slice();
    st.bars.push({ h: bar.h, l: bar.l }); if (st.bars.length > p.breakBars + 1) st.bars.shift();
    if (rate == null || st.fund.length < need || prev.length < p.breakBars || !(f && f.atr > 0)) return null;
    if ((st.until || 0) > api.now) return null;
    const avg = st.fund.reduce((a, b) => a + b, 0) / st.fund.length;
    let crowd = 0;
    if (avg >= p.fundHi && rate >= p.fundHi) crowd = 1; else if (avg <= -p.fundHi && rate <= -p.fundHi) crowd = -1;
    if (!crowd) return null;
    const side = -crowd, c = bar.c, look = prev.slice(-p.breakBars);
    const lo = Math.min(...look.map((b) => b.l)), hi = Math.max(...look.map((b) => b.h));
    const broke = side < 0 ? c < lo : c > hi;
    if (!broke) return null;
    const ext = side < 0 ? Math.max(hi, bar.h) : Math.min(lo, bar.l);
    const stop = ext - side * p.stopAtr * f.atr;
    if (side * (c - stop) <= 0) return null;
    const entry = p.entry === 'taker' ? { kind: 'taker', px: c } : { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true };
    return { coin, side, entry, stop, target: null, trail: null, timeStopMin: p.holdBars * tf,
      why: `${tf}m: funding ${(avg * 100).toFixed(3)}%/8h avg over ${p.lookbackH}h (${crowd > 0 ? 'longs' : 'shorts'} crowded), close broke the ${p.breakBars}-bar ${side < 0 ? 'low' : 'high'}` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
