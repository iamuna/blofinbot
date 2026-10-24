/* PIVOT-MATRIX (v1.3 spec, added at Ibrahim's request 2026-10-23): swing pivots are respected (break of structure →
 * continuation) or swept (swing failure → reversal).
 *   pivots: a fractal high/low (higher/lower than f bars on each side), known only f bars later (no repaint); a new
 *           pivot of the other kind counts only if it is at least zz ATRs from the last one (ZigZag), one of the same
 *           kind replaces the last if it goes further. Each pivot is judged when it is confirmed, with what was known
 *           then (the spec's Python builds the ZigZag over the whole history first and so never sees the pivots a
 *           later one replaced: look-ahead).
 *   bias:   EMA 50 vs EMA 200 of the closes of the higher timeframe (htf minutes), CLOSED bars only (the spec's
 *           resample-and-forward-fill gives each bar the close of the higher-timeframe bar it sits in: look-ahead).
 *   Setup A (BOS): the close crosses the last swing high + bosBuf ATR (the previous close did not), bias not short →
 *           long, stop stopTol ATR under min(last swing low, bar low). Mirror for shorts.
 *   Setup B (sweep): the bar trades under the last swing low and closes back above it, on an up bar → long, stop
 *           sweepTol ATR under the bar's low. Mirror for shorts. Both setups on one bar → nothing.
 *   target: the previous swing high (the opposing pivot before the last one) if it is above the entry, else none.
 *   exits:  the spec trails the stop to each new swing pivot, which the swarm's trader cannot do; here the trader's
 *           ATR trail (trailAtr ATR behind the best price once afterR is reached) stands in for it, plus a time stop
 *           (holdBars). Entry: taker at the next open (the spec fills at the signal close).
 * The spec's portfolio layer (1% risk, 100 positions, correlation blocks and trims, notional cap) is the risk agent's
 * job in the swarm: config/risk.json (6% open risk, 4× gross, 2× net BTC exposure, per-coin notional) applies to every
 * order. Funding is charged by the backtest and the trader at each settlement.
 * The plugin's own tfs stay within the plugin check's list; the 1h and 4h variants pick theirs with onlyTfs.
 */
'use strict';
function bar(s, b, p, tfMs, t) {
  // ATR (Wilder, seeded with the first range, as pandas ewm adjust=False)
  const tr = s.pc == null ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - s.pc), Math.abs(b.l - s.pc));
  s.atr = s.atr == null ? tr : s.atr + (tr - s.atr) / p.atrLen;
  s.bars.push({ h: b.h, l: b.l, atr: s.atr }); if (s.bars.length > 2 * p.f + 1) s.bars.shift();
  // a fractal at the middle bar is confirmed now (f bars later): judged with what is known now
  if (s.bars.length === 2 * p.f + 1) {
    const m = s.bars[p.f], left = s.bars.slice(0, p.f), right = s.bars.slice(p.f + 1);
    if (left.every((x) => m.h > x.h) && right.every((x) => m.h > x.h)) pivot(s, 1, m.h, m.atr, p);
    if (left.every((x) => m.l < x.l) && right.every((x) => m.l < x.l)) pivot(s, -1, m.l, m.atr, p);
  }
  // the higher timeframe: an EMA step when one of its bars closes (only closed bars count)
  const hk = Math.floor(t / (p.htf * 60000)), end = (hk + 1) * p.htf * 60000;
  if (t + tfMs >= end) { const a = 2 / (p.fast + 1), z = 2 / (p.slow + 1); s.ef = s.ef == null ? b.c : s.ef + a * (b.c - s.ef); s.es = s.es == null ? b.c : s.es + z * (b.c - s.es); s.htfN++; }
  s.prevC = s.pc; s.pc = b.c; s.n++;
}
function pivot(s, type, px, atr, p) {
  if (s.type === type) { // same kind: replaces the last one if it goes further
    if (type * (px - s.last) > 0) { if (type > 0) s.H = px; else s.L = px; s.last = px; }
    return;
  }
  if (s.last != null && Math.abs(px - s.last) < p.zz * atr) return; // too small a swing
  if (type > 0) { s.pH = s.H; s.H = px; } else { s.pL = s.L; s.L = px; }
  s.type = type; s.last = px;
}
module.exports = {
  name: 'pivot-matrix', version: 1, tfs: [15], needsRef: false,
  params: { f: 2, atrLen: 14, zz: 1.5, bosBuf: 0.1, stopTol: 0.5, sweepTol: 0.75, htf: 240, fast: 50, slow: 200, minHtfBars: 50, trailAtr: 3, afterR: 1, holdBars: 192, setups: ['bos', 'sweep'] },
  bounds: { zz: [1, 3], bosBuf: [0.05, 0.3], stopTol: [0.25, 1], sweepTol: [0.5, 1.5], holdBars: [48, 384] },
  onBar(ev, api) {
    const { coin, tf, t, bar: b } = ev, p = api.p, tfMs = tf * 60000;
    const st = api.state(coin);
    if (!st.m) { // first bar seen: replay the seeded history (no ideas from the past)
      st.m = { n: 0, bars: [], pc: null, prevC: null, atr: null, H: null, L: null, pH: null, pL: null, type: 0, last: null, ef: null, es: null, htfN: 0 };
      const h = api.hist(coin, tf), n = h ? h.len : 0;
      for (let i = n - 1; i >= 1; i--) { const x = h.at(i); bar(st.m, x, p, tfMs, x.t); }
    }
    const s = st.m, H = s.H, L = s.L, prevC = s.pc, atr = s.atr; // levels as known before this bar
    bar(s, b, p, tfMs, t);
    if (H == null || L == null || prevC == null || !(atr > 0)) return null;
    const C = b.c, bias = s.htfN >= p.minHtfBars ? (s.ef > s.es ? 1 : -1) : 0, a = s.atr;
    const upLvl = H + p.bosBuf * a, dnLvl = L - p.bosBuf * a;
    const bosUp = p.setups.includes('bos') && C > upLvl && prevC <= upLvl, bosDn = p.setups.includes('bos') && C < dnLvl && prevC >= dnLvl;
    const swDn = p.setups.includes('sweep') && b.l < L && C > L && C > b.o, swUp = p.setups.includes('sweep') && b.h > H && C < H && C < b.o;
    const long = (bosUp && bias >= 0) || swDn, short = (bosDn && bias <= 0) || swUp;
    if (long === short) return null;
    const side = long ? 1 : -1, bos = long ? bosUp && bias >= 0 : bosDn && bias <= 0;
    const stop = long ? (bos ? Math.min(L, b.l) - p.stopTol * a : b.l - p.sweepTol * a) : (bos ? Math.max(H, b.h) + p.stopTol * a : b.h + p.sweepTol * a);
    const opp = long ? s.pH : s.pL, target = opp != null && side * (opp - C) > 0 ? opp : null;
    if (side * (C - stop) <= 0) return null;
    return { coin, side, entry: { kind: 'taker', px: C }, stop, target, trail: { dist: p.trailAtr * a, afterR: p.afterR }, timeStopMin: p.holdBars * tf,
      why: `${tf}m ${bos ? 'break of structure' : 'sweep'} ${long ? `above ${(bos ? H : L).toPrecision(6)}` : `below ${(bos ? L : H).toPrecision(6)}`}, bias ${bias > 0 ? 'up' : bias < 0 ? 'down' : 'none'}${target ? `, target ${target.toPrecision(6)}` : ''}` };
  },
};
