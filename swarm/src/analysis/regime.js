/* Regime per coin: the big-picture trend bias and the current market state.
 *
 * bias (−1…+1): average vote of Donchian trend states on hourly bars — lookbacks 24, 72, 168 hours, 4-hour
 *   bars 30 and 90, daily bars 10 and 20 (enter on a close beyond the channel, exit at its midpoint; the same
 *   rule as the 1h→3M trend engine). Needs ~20 days of hourly history (warm-up or seed()).
 * state: 'trend' when the 15-minute efficiency ratio er20 ≥ 0.35, 'range' when ≤ 0.2, else 'mixed'.
 * volPct: where the current 15-minute ATR% sits among the last 7 days (0…1).
 * session: asia (00–07 UTC), europe (07–13:30), us (13:30–21), late (21–24).
 */
'use strict';
const { Ring } = require('./ta');

const H = 3600000;
const SETS = [{ k: 1, L: [24, 72, 168] }, { k: 4, L: [30, 90] }, { k: 24, L: [10, 20] }];

class Donchian {
  constructor(L) { this.L = L; this.state = 0; this.stop = 0; }
  push(ring) { // ring of closes (newest first via at(0)); call after pushing the new close
    if (ring.len < this.L + 1) return this.state;
    const c = ring.at(0); let hi = -Infinity, lo = Infinity;
    for (let k = 1; k <= this.L; k++) { const x = ring.at(k); if (x > hi) hi = x; if (x < lo) lo = x; }
    const mid = (hi + lo) / 2;
    if (this.state > 0) { this.stop = Math.max(this.stop, mid); if (c < this.stop) this.state = 0; }
    else if (this.state < 0) { this.stop = Math.min(this.stop, mid); if (c > this.stop) this.state = 0; }
    if (this.state === 0) { if (c > hi) { this.state = 1; this.stop = mid; } else if (c < lo) { this.state = -1; this.stop = mid; } }
    return this.state;
  }
}

function session(t) {
  const d = new Date(t), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m < 420 ? 'asia' : m < 810 ? 'europe' : m < 1260 ? 'us' : 'late';
}

class RegimeState {
  constructor() { this.c = new Map(); }
  st(coin) {
    let s = this.c.get(coin);
    if (!s) {
      s = { sets: SETS.map((x) => ({ k: x.k, closes: new Ring(Math.max(...x.L) + 2), cur: null, d: x.L.map((L) => new Donchian(L)) })), atr15: new Ring(672), state: 'mixed', er: NaN, volPct: NaN, bias: 0, hours: 0 };
      this.c.set(coin, s);
    }
    return s;
  }
  // feed hourly bars (seed from REST history, or closed from 15-minute events by onEvent)
  onHour(coin, t, close) {
    const s = this.st(coin);
    if (t <= (s.lastHour || -Infinity)) return; // already seen (seeded history and live bars overlap)
    s.lastHour = t; s.hours++;
    for (const set of s.sets) {
      const span = set.k * H, b = Math.floor(t / span) * span;
      if (set.cur && set.cur.t !== b) { set.closes.push(set.cur.c); for (const d of set.d) d.push(set.closes); set.cur = null; }
      set.cur = { t: b, c: close };
      if (t + H === b + span) { set.closes.push(close); for (const d of set.d) d.push(set.closes); set.cur = null; }
    }
    let n = 0, sum = 0; for (const set of s.sets) for (const d of set.d) { n++; sum += d.state; }
    s.bias = n ? sum / n : 0;
  }
  // feature events: 15-minute bars drive the state, and every 4th one closes an hour
  onEvent(ev) {
    if (ev.tf !== 15) return;
    const s = this.st(ev.coin);
    s.er = ev.f.er20; s.state = s.er >= 0.35 ? 'trend' : s.er <= 0.2 ? 'range' : 'mixed';
    s.atr15.push(ev.f.atrPct);
    let below = 0; for (let k = 0; k < s.atr15.len; k++) if (s.atr15.at(k) < ev.f.atrPct) below++;
    s.volPct = s.atr15.len > 20 ? below / s.atr15.len : NaN;
    if ((ev.t + 15 * 60000) % H === 0) this.onHour(ev.coin, ev.t + 15 * 60000 - H, ev.bar.c);
  }
  get(coin, t) { const s = this.st(coin); return { bias: s.bias, state: s.state, er: s.er, volPct: s.volPct, session: session(t), warm: s.hours >= 24 * 21 }; }
}

module.exports = { RegimeState, Donchian, session };
