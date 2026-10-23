/* Excursions: how far price went for and against an idea after it was given, in R — the "is there any direction in
 * this signal?" test, before fills and costs.
 *
 * Ported from the 1-minute bot's outcome labels (iamuna/1-min-blofin-bot, btc_bot/outcomes.py: forward returns at
 * 1–240 minutes and MFE/MAE at 5/15/60), changed in two ways for the swarm:
 *   - measured per IDEA, in R (1 R = the idea's own entry-to-stop distance, at least 10 bps, as ExecSim), at horizons
 *     counted in the idea's own bars, so 1h and 1d ideas are comparable;
 *   - streamed: feed 1-minute bars in time order and nothing about the future is ever stored or read early.
 * The deep review (docs/DEEP_REVIEW_2026-10-23.md) used this diagnostic from scratch scripts — MFE ≈ MAE ≈ 1–1.2 R for
 * every pattern family that lost — and this makes it a permanent tool (research/event_study.js runs it on plugins).
 *
 * Per idea and horizon h (bars of the idea's timeframe after the signal bar's close):
 *   fwdR  = side × (close at h − entry) ÷ risk      mfeR / maeR = best / worst excursion up to h ÷ risk (maeR ≤ 0)
 * and once: first = +1 if price reached +1 R before −1 R, −1 if −1 R first (or both in the same minute: counted
 * against, as ExecSim does), 0 if neither by the last horizon.
 */
'use strict';
const MIN = 60000, MIN_RISK_BPS = 10;

class ExcursionTracker {
  constructor(o = {}) {
    this.horizons = (o.horizons || [1, 3, 6, 12, 24, 48]).slice().sort((a, b) => a - b);
    this.onDone = o.onDone || (() => {});
    this.open = new Map(); // coin → [tracked ideas]
    this.done = [];
  }
  // idea: {id, coin, side, tf, t (signal bar's close, ms), entry: {px}, stop}; ctx: anything to keep with it
  add(idea, ctx) {
    const px = idea.entry.px, riskFrac = Math.max(Math.abs(px - idea.stop) / px, MIN_RISK_BPS / 1e4);
    const x = { idea, ctx: ctx || null, px, risk: riskFrac * px, hi: -Infinity, lo: Infinity, k: 0, first: 0, rows: [] };
    const list = this.open.get(idea.coin); if (list) list.push(x); else this.open.set(idea.coin, [x]);
  }
  // a closed 1-minute bar {t (open time), h, l, c} of `coin`
  onBar(coin, bar) {
    const list = this.open.get(coin); if (!list) return;
    for (let j = list.length - 1; j >= 0; j--) {
      const x = list[j], i = x.idea, s = i.side;
      if (bar.t < i.t) continue; // the minute that closed the signal bar is not after it
      if (bar.h > x.hi) x.hi = bar.h; if (bar.l < x.lo) x.lo = bar.l;
      if (!x.first) {
        const up = s > 0 ? bar.h >= x.px + x.risk : bar.l <= x.px - x.risk, down = s > 0 ? bar.l <= x.px - x.risk : bar.h >= x.px + x.risk;
        if (down) x.first = -1; else if (up) x.first = 1;
      }
      const end = bar.t + MIN;
      while (x.k < this.horizons.length && end >= i.t + this.horizons[x.k] * i.tf * MIN) {
        const fav = s > 0 ? x.hi - x.px : x.px - x.lo, adv = s > 0 ? x.lo - x.px : x.px - x.hi;
        x.rows.push({ h: this.horizons[x.k], fwdR: (s * (bar.c - x.px)) / x.risk, mfeR: fav / x.risk, maeR: adv / x.risk });
        x.k++;
      }
      if (x.k === this.horizons.length) { list.splice(j, 1); this.finish(x, end); }
    }
  }
  finish(x, endT) {
    const rec = { id: x.idea.id, strategy: x.idea.strategy, coin: x.idea.coin, tf: x.idea.tf, side: x.idea.side, t: x.idea.t, riskBps: +((x.risk / x.px) * 1e4).toFixed(2), first: x.first, rows: x.rows, ctx: x.ctx };
    this.done.push(rec);
    this.onDone(x.idea, rec, endT);
  }
  pendingFor(coin) { return (this.open.get(coin) || []).length; }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
function tstat(a) {
  const n = a.length; if (n < 2) return NaN;
  const m = mean(a), sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (n - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(n) : NaN;
}
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);

// records → {n, costR, plusFirst, horizons: [{h, fwdR, t, mfeR, maeR, edge}]}. costR: the round trip (maker in,
// taker out + slippage by default) as a fraction of the average risk — what the move has to beat.
function summarize(recs, o = {}) {
  const n = recs.length; if (!n) return { n: 0 };
  const rtBps = o.roundTripBps == null ? 2 + 6 + 1.5 : o.roundTripBps;
  const decided = recs.filter((r) => r.first !== 0);
  const hs = [...new Set(recs.flatMap((r) => r.rows.map((x) => x.h)))].sort((a, b) => a - b);
  return {
    n, costR: r3(mean(recs.map((r) => rtBps / r.riskBps))),
    plusFirst: decided.length ? r3(decided.filter((r) => r.first > 0).length / decided.length) : null, decided: decided.length,
    horizons: hs.map((h) => {
      const rows = recs.map((r) => r.rows.find((x) => x.h === h)).filter(Boolean), f = rows.map((x) => x.fwdR);
      const mfe = mean(rows.map((x) => x.mfeR)), mae = mean(rows.map((x) => x.maeR));
      // edge: favourable over adverse excursion — about 1 means no direction (the deep review's losers)
      return { h, n: rows.length, fwdR: r3(mean(f)), t: r3(tstat(f)), mfeR: r3(mfe), maeR: r3(mae), edge: r3(mae < 0 ? mfe / -mae : NaN) };
    }),
  };
}

module.exports = { ExcursionTracker, summarize, tstat };
