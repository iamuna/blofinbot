/* Sentinel (upswarm GUIDE §6.6, G6): idea and coin sanity before any new risk. Exits are never blocked.
 *
 * checkIdea(idea, ctx) → null when the idea may go on, else the reason it may not. Runs in the coordinator, on every
 * idea of a strategy in trade, before fusion — the brain (where strategy code runs) already checks the basics
 * (kit.js validIdea); this is the trusted second look, with the things that check let through on 2026-10-23
 * (IRYS: a negative target price and a stop 343% away):
 *   - a target, when there is one, above 0;
 *   - the stop at most maxStopDistPct of the entry away (default 25%);
 *   - the stop at least minStopCostX × the round-trip cost away (default 2 × 15 bps: taker in and out plus slippage),
 *     so costs cannot eat most of the risk before the trade starts;
 *   - the coin listed for at least minListedDays (default 30) when its listing date is known (universe: the
 *     Binance perpetual's onboard date) — a coin with no history has no volatility to size on.
 * Coin shocks (a coin that jumped or crashed in an hour) are the data guard's job: it marks them not tradable for 24 h
 * (market/data_guard.js, reason 'shock'), which every new-risk path already respects.
 * Thresholds: code defaults, overridable in config `sentinel` (a protected config section: a change waits for Ibrahim).
 */
'use strict';
const DAY = 86400000;
const DEFAULTS = { maxStopDistPct: 0.25, minStopCostX: 2, roundTripBps: 15, minListedDays: 30 };

// code defaults < config `sentinel` < the signed risk.json (risk v2 key maxStopDistPct, docs/RISK_V2.md)
function settings(cfg, limits) { const o = Object.assign({}, DEFAULTS, (cfg && cfg.sentinel) || {}); if (limits && Number.isFinite(limits.maxStopDistPct)) o.maxStopDistPct = limits.maxStopDistPct; return o; }

// idea: {coin, side, entry:{px}, stop, target?}; ctx: {now, inst(coin) → {listedAt?}, cfg, limits}
function checkIdea(idea, ctx = {}) {
  const S = settings(ctx.cfg, ctx.limits), px = idea && idea.entry && idea.entry.px;
  if (!(px > 0) || !(idea.stop > 0)) return 'no entry or stop price';
  if (idea.target != null && !(idea.target > 0)) return `target price ${idea.target} is not above 0`;
  const dist = Math.abs(px - idea.stop) / px;
  if (dist > S.maxStopDistPct) return `stop ${(dist * 100).toFixed(1)}% from the entry (at most ${(S.maxStopDistPct * 100).toFixed(0)}%)`;
  const minBps = S.minStopCostX * S.roundTripBps;
  if (dist * 1e4 < minBps) return `stop ${(dist * 1e4).toFixed(1)} bps from the entry: less than ${S.minStopCostX}× the ${S.roundTripBps} bps round-trip cost`;
  const inst = ctx.inst ? ctx.inst(idea.coin) : null, now = ctx.now != null ? ctx.now : Date.now();
  if (inst && Number.isFinite(inst.listedAt) && inst.listedAt > 0 && now - inst.listedAt < S.minListedDays * DAY) {
    return `listed ${((now - inst.listedAt) / DAY).toFixed(0)} days ago (needs ${S.minListedDays})`;
  }
  return null;
}

module.exports = { checkIdea, settings, DEFAULTS };
