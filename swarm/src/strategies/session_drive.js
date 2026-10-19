/* Session open drive: a strong, busy first half hour of a session tends to keep going.
 * Evidence: Bitcoin's first half-hour return predicts the last half-hour, most in high-volume or volatile
 * sessions (Shen, Urquhart & Wang 2022); the Monday Asia-open trend effect (Concretum).
 * Session opens (UTC): Asia 00:00, Europe 07:00, US 13:30. Trade the direction of the opening 30-minute bar when
 * it moved more than 1 ATR on above-normal volume; stop beyond the other end of that bar; trail; hold ≤ 3 h.
 */
'use strict';
module.exports = {
  name: 'session-drive', version: 1, tfs: [30], needsRef: false,
  params: { opens: [0, 420, 810], moveAtr: 1.0, volZ: 1.0, stopPadAtr: 0.1, maxRiskAtr: 2.5, trailAtr: 1.5, trailAfterR: 1.0, holdMin: 180, waitMin: 10, minBars: 60 },
  bounds: { moveAtr: [0.5, 2], volZ: [0, 2.5], trailAtr: [0.8, 3], holdMin: [60, 300] },
  onBar(ev, api) {
    const { f, bar, coin, t } = ev, p = api.p;
    const d = new Date(t), m = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (!p.opens.includes(m) || f.bars < p.minBars || !(f.atr > 0)) return null;
    const move = bar.c - bar.o;
    if (Math.abs(move) < p.moveAtr * f.atr || f.volZ < p.volZ) return null;
    const side = Math.sign(move), px = bar.c;
    const stop = side > 0 ? bar.l - p.stopPadAtr * f.atr : bar.h + p.stopPadAtr * f.atr;
    if (Math.abs(px - stop) > p.maxRiskAtr * f.atr) return null;
    return {
      coin, side, entry: { kind: 'maker', px, waitMin: p.waitMin, fallback: 'cancel', chase: true }, stop, target: null,
      trail: { dist: p.trailAtr * f.atr, afterR: p.trailAfterR }, timeStopMin: p.holdMin,
      why: `${['Asia', 'Europe', 'US'][p.opens.indexOf(m)]} open drive ${(move / f.atr).toFixed(1)} ATR, volZ ${f.volZ.toFixed(1)}`,
    };
  },
};
