/* Deleveraging flush reversal (researcher, 2026-10-23). Slow bars (12h / 1d).
 *
 * Mechanism: when open interest falls hard over a few days while price moves hard in one direction, positions are
 * being closed by force or in a hurry — long liquidations and margin calls into a drop (long flush), or shorts
 * squeezed out into a rally (short squeeze). Those traders must trade regardless of value, so the price overshoots;
 * once the forced flow is spent (the leverage is gone, which is what the falling open interest shows), the
 * overshoot should partly revert. Long after a long flush, short after a short squeeze — entered only when a bar
 * closes back past the previous bar's extreme, i.e. after the forced flow has visibly stopped.
 * Source: Coval & Stafford, "Asset fire sales (and purchases) in equity markets" (JFE 86, 2007): forced selling
 * (buying) by funds under flow pressure moves prices away from value and the move reverses over the following weeks;
 * Brunnermeier & Pedersen, "Market liquidity and funding liquidity" (RFS 2009): margin-driven liquidity spirals.
 * Own data: 15-minute event study 2026-10-20, drop with open interest −1.5% → +25 bps after 60 minutes (t 1.2,
 * weak). Candle tests never saw open interest; this is the first slow strategy that does.
 *
 * tfs lists 45 only (the plugin check's range); runs use params.onlyTfs [tf] to react to the slow bars.
 * Rule, on closed bars of p.tf: sample the latest open interest (≤ 20 minutes old) and the close every bar. If over
 * the last lookbackH hours open interest fell by ≥ oiDrop and the close moved ≥ moveAtr × ATR, the coin is armed
 * for armBars bars (long after a drop, short after a rise). While armed, a close beyond the previous bar's high
 * (long) / low (short) enters. Stop stopAtr × ATR beyond the extreme since arming; no target; time stop holdBars
 * bars; cooldown cooldownBars after an exit.
 */
'use strict';
module.exports = {
  name: 'oi-flush', version: 1, tfs: [45], needsRef: false,
  params: { tf: 720, lookbackH: 72, oiDrop: 0.15, moveAtr: 2.5, armBars: 3, stopAtr: 0.5, holdBars: 10, cooldownBars: 6, entry: 'maker' },
  bounds: { lookbackH: [24, 168], oiDrop: [0.05, 0.4], moveAtr: [1, 5], armBars: [1, 6], stopAtr: [0.25, 2], holdBars: [3, 30] },
  onBar(ev, api) {
    const { coin, tf, bar, f } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.hist) { st.hist = []; st.arm = null; }
    const x = api.ctx(coin), last = x && x.oi ? x.oi.last : null;
    const oi = last && last.oi > 0 && api.now - last.t < 20 * 60000 ? last.oi : null;
    const need = Math.max(1, Math.round(p.lookbackH * 60 / tf));
    const prev = st.hist.length ? st.hist[st.hist.length - 1] : null;
    st.hist.push({ oi, c: bar.c, h: bar.h, l: bar.l });
    if (st.hist.length > need + 1) st.hist.shift();
    if (!(f && f.atr > 0) || !prev) return null;
    // arm: open interest down hard over the lookback, price moved hard
    const base = st.hist.length === need + 1 ? st.hist[0] : null;
    if (oi != null && base && base.oi != null) {
      const dOi = oi / base.oi - 1, move = bar.c - base.c;
      if (dOi <= -p.oiDrop && Math.abs(move) >= p.moveAtr * f.atr) {
        const side = move < 0 ? 1 : -1;
        const ext = side > 0 ? bar.l : bar.h;
        if (!st.arm || st.arm.side !== side) { st.arm = { side, left: p.armBars, ext, dOi, move: move / base.c }; return null; } // the first flush bar never enters
        st.arm.left = p.armBars + 1; st.arm.dOi = dOi; st.arm.move = move / base.c; // still flushing: stay armed, a turn may enter
      }
    }
    const a = st.arm;
    if (!a) return null;
    a.ext = a.side > 0 ? Math.min(a.ext, bar.l) : Math.max(a.ext, bar.h);
    if ((st.until || 0) > api.now) { a.left--; if (a.left <= 0) st.arm = null; return null; }
    const turned = a.side > 0 ? bar.c > prev.h : bar.c < prev.l;
    if (!turned) { a.left--; if (a.left <= 0) st.arm = null; return null; }
    st.arm = null;
    const side = a.side, c = bar.c, stop = a.ext - side * p.stopAtr * f.atr;
    if (side * (c - stop) <= 0) return null;
    const entry = p.entry === 'taker' ? { kind: 'taker', px: c } : { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true };
    return { coin, side, entry, stop, target: null, trail: null, timeStopMin: p.holdBars * tf,
      why: `${tf}m: open interest ${(a.dOi * 100).toFixed(1)}% over ${p.lookbackH}h while price ${(a.move * 100).toFixed(1)}% (${side > 0 ? 'long flush' : 'short squeeze'}), close turned past the previous bar` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
