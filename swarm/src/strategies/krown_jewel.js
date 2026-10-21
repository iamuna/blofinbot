/* Krown-style trend + Stochastic RSI, added at Ibrahim's request (2026-10-21) after Erik Krown (Krown Trading).
 * Krown's own "Jewel" is a paid, invite-only script (Stochastic + RSI, read against trend tools, meant for the 1h and
 * 2h charts); its exact rules are not public. This is an approximation from what is public, not his indicator:
 *   trend:  EMA fast (21) above EMA mid (55), close above EMA slow (200) → only longs; mirrored for shorts.
 *   timing: Stochastic RSI (RSI 14, stoch 14, %K 3, %D 3): %K crosses above %D after %K was below os (oversold)
 *           within the last lookBars bars → long; mirrored (cross down from above 100 − os) → short.
 * Stop stopAtr × ATR, target rr × risk (0 = none), optional trailing stop, time stop holdBars bars.
 * The plugin's own tfs stay within the plugin check's list; the 1h and 2h variants pick theirs with onlyTfs (config).
 */
'use strict';
function ema(prev, x, len) { return prev + (2 / (len + 1)) * (x - prev); }
// one close into RSI, Stochastic RSI and the three EMAs
function step(s, c, p) {
  const d = c - s.prev; s.prev = c; s.n++;
  const L = p.rsiLen;
  s.ag = (s.ag * (L - 1) + Math.max(d, 0)) / L; s.al = (s.al * (L - 1) + Math.max(-d, 0)) / L;
  const rsi = s.al > 0 ? 100 - 100 / (1 + s.ag / s.al) : 100;
  s.rsis.push(rsi); if (s.rsis.length > p.stochLen) s.rsis.shift();
  const lo = Math.min(...s.rsis), hi = Math.max(...s.rsis);
  const raw = hi > lo ? (100 * (rsi - lo)) / (hi - lo) : 50;
  s.raws.push(raw); if (s.raws.length > p.k) s.raws.shift();
  const k = s.raws.reduce((a, b) => a + b, 0) / s.raws.length;
  s.ks.push(k); if (s.ks.length > Math.max(p.d, p.lookBars + 1)) s.ks.shift();
  const dl = s.ks.slice(-p.d).reduce((a, b) => a + b, 0) / Math.min(p.d, s.ks.length);
  const prevK = s.k, prevD = s.d; s.k = k; s.d = dl;
  s.ef = ema(s.ef, c, p.fast); s.em = ema(s.em, c, p.mid); s.es = ema(s.es, c, p.slow);
  return { k, d: dl, prevK, prevD, rsi };
}
module.exports = {
  name: 'krown-jewel', version: 1, tfs: [30, 45], needsRef: false,
  params: { tf: 45, rsiLen: 14, stochLen: 14, k: 3, d: 3, os: 20, lookBars: 3, fast: 21, mid: 55, slow: 200, stopAtr: 1.5, rr: 2, trailAtr: 0, trailAfterR: 1, holdBars: 48, entry: 'maker', cooldownBars: 6, minBars: 220 },
  bounds: { os: [10, 30], stopAtr: [1, 3], rr: [0, 4], holdBars: [12, 96] },
  onBar(ev, api) {
    const { coin, tf, bar, f } = ev, p = api.p;
    if (tf !== p.tf) return null;
    const st = api.state(coin);
    if (!st.m) { // first bar seen: start from the history already loaded for this timeframe (seeded at start-up)
      const h = api.hist(coin, tf), n = h ? h.len : 0, c0 = n > 1 ? h.at(n - 1).c : bar.c;
      st.m = { n: 0, prev: c0, ag: 0, al: 0, rsis: [], raws: [], ks: [], k: 50, d: 50, ef: c0, em: c0, es: c0 };
      for (let i = n - 2; i >= 1; i--) step(st.m, h.at(i).c, p);
    }
    const s = st.m, c = bar.c;
    const { k, d, prevK, prevD } = step(s, c, p);
    if (s.n < p.minBars || !(f.atr > 0) || (st.until || 0) > api.now) return null;
    const up = prevK <= prevD && k > d, dn = prevK >= prevD && k < d;
    const recent = s.ks.slice(-p.lookBars - 1, -1);
    let side = 0;
    if (up && Math.min(...recent) < p.os && s.ef > s.em && c > s.es) side = 1;
    else if (dn && Math.max(...recent) > 100 - p.os && s.ef < s.em && c < s.es) side = -1;
    if (!side) return null;
    const risk = p.stopAtr * f.atr;
    const entry = p.entry === 'taker' ? { kind: 'taker', px: c } : { kind: 'maker', px: c, waitMin: 3, fallback: 'cancel', chase: true };
    return { coin, side, entry, stop: c - side * risk, target: p.rr > 0 ? c + side * p.rr * risk : null,
      trail: p.trailAtr > 0 ? { dist: p.trailAtr * f.atr, afterR: p.trailAfterR } : null, timeStopMin: p.holdBars * tf,
      why: `${tf}m stoch RSI cross ${side > 0 ? 'up from oversold' : 'down from overbought'} (K ${k.toFixed(0)}), EMA ${p.fast}/${p.mid} ${side > 0 ? 'up' : 'down'}, ${side > 0 ? 'above' : 'below'} EMA ${p.slow}` };
  },
  onClose(coin, r, k) { k.state(coin).until = r.exitT + k.p.cooldownBars * k.p.tf * 60000; },
};
