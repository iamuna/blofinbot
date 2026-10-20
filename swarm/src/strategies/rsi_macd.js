/* RSI + MACD: the classic retail combination, tested at Ibrahim's request (2026-10-20).
 * RSI(14) and MACD(12, 26, 9) on the closes of the chosen timeframe; every signal is taken at the bar's close.
 *   mode 'reversal': MACD crosses above its signal line while RSI was oversold (< os) in the last lookBars bars →
 *                    long; mirrored for shorts (cross below, RSI was > 100 − os).
 *   mode 'trend':    MACD crosses above its signal line with RSI above 50 (and MACD above zero if zeroLine) →
 *                    long; mirrored for shorts.
 * Stop stopAtr × ATR, target rr × the risk (the usual 1:2), time stop holdBars bars. Entry taker (as the online
 * versions do) or maker.
 */
'use strict';
module.exports = {
  name: 'rsi-macd', version: 1, tfs: [5, 15, 30], needsRef: false,
  params: { mode: 'reversal', tf: 15, rsiLen: 14, fast: 12, slow: 26, sig: 9, os: 30, lookBars: 5, zeroLine: false, stopAtr: 1.5, rr: 2, holdBars: 24, entry: 'taker', waitMin: 3, cooldownBars: 3, minBars: 100 },
  bounds: { os: [20, 40], stopAtr: [1, 3], rr: [1, 4], holdBars: [8, 48] },
  onBar(ev, api) {
    const { coin, tf, bar, f } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) st.m = new Map();
    let s = st.m.get(tf);
    const c = bar.c;
    if (!s) { s = { n: 0, prev: c, ef: c, es: c, sg: 0, ag: 0, al: 0, rsi: [], hist: 0 }; st.m.set(tf, s); return null; }
    // RSI (Wilder) and MACD, updated once per closed bar
    const d = c - s.prev; s.prev = c; s.n++;
    const L = p.rsiLen;
    s.ag = (s.ag * (L - 1) + Math.max(d, 0)) / L; s.al = (s.al * (L - 1) + Math.max(-d, 0)) / L;
    const rsi = s.al > 0 ? 100 - 100 / (1 + s.ag / s.al) : 100;
    s.rsi.push(rsi); if (s.rsi.length > p.lookBars) s.rsi.shift();
    const kf = 2 / (p.fast + 1), ks = 2 / (p.slow + 1), kg = 2 / (p.sig + 1);
    s.ef += kf * (c - s.ef); s.es += ks * (c - s.es);
    const macd = s.ef - s.es;
    s.sg += kg * (macd - s.sg);
    const hist = macd - s.sg, prevHist = s.hist; s.hist = hist;
    if (s.n < p.minBars || f.bars < 30 || !(f.atr > 0) || (st.until || 0) > api.now) return null;
    const crossUp = prevHist <= 0 && hist > 0, crossDn = prevHist >= 0 && hist < 0;
    let side = 0;
    if (p.mode === 'reversal') {
      if (crossUp && Math.min(...s.rsi) < p.os) side = 1;
      else if (crossDn && Math.max(...s.rsi) > 100 - p.os) side = -1;
    } else {
      if (crossUp && rsi > 50 && (!p.zeroLine || macd > 0)) side = 1;
      else if (crossDn && rsi < 50 && (!p.zeroLine || macd < 0)) side = -1;
    }
    if (!side) return null;
    const risk = p.stopAtr * f.atr;
    const entry = p.entry === 'maker' ? { kind: 'maker', px: c, waitMin: p.waitMin, fallback: 'cancel', chase: true } : { kind: 'taker', px: c };
    return { coin, side, entry, stop: c - side * risk, target: c + side * p.rr * risk, trail: null, timeStopMin: p.holdBars * tf,
      why: `${tf}m MACD cross ${side > 0 ? 'up' : 'down'}, RSI ${rsi.toFixed(0)} (${p.mode})` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * r.idea.tf * 60000; },
};
