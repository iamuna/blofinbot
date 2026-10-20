/* Strategy kit: the one interface every strategy plugin implements, and the host that runs it.
 *
 * A strategy module exports:
 *   name, version, tfs: [minutes…] it reacts to, params (defaults), bounds ({param: [min, max]} for the tuner),
 *   needsRef (true if it needs Binance flow/liquidations), onBar(ev, api) → idea | idea[] | null.
 * ev  = feature event {coin, tf, t, bar, f} (see analysis/features.js); decisions happen at the bar's close.
 * api = { p (params), now (close time ms), fs (FeatureState), regime(coin), hist(coin, tf) (Ring of bars, newest
 *         first), ctx(coin) (funding, OI, liquidations, book), state(coin) (the strategy's own per-coin memory),
 *         tradable(coin), coins() }
 * An idea: {coin, side: +1 long | −1 short, entry: {kind: 'maker'|'taker', px, waitMin, fallback: 'taker'|'cancel', chase},
 *           (chase: the maker order follows the best price until it fills or the wait ends; else it rests at px)
 *           stop, target (or null), trail: {atr, afterR} (or null), timeStopMin, why}
 * The host adds strategy/version/tf/t/id, checks the levels make sense, and enforces one open idea per coin
 * (a strategy is told when its trade ends through onClose and can set its own cooldowns).
 */
'use strict';
const crypto = require('crypto');

// which version of a strategy produced an idea: plugin version + effective parameters. Shadow evidence only counts
// for the version being judged (factory/gate.js), so a parameter change starts a fresh out-of-sample record.
function paramsHash(version, p) { return crypto.createHash('sha256').update(JSON.stringify([version || 1, Object.keys(p || {}).sort().map((k) => [k, p[k]])])).digest('hex').slice(0, 10); }

function validIdea(i) {
  if (!i || (i.side !== 1 && i.side !== -1) || !i.entry || !(i.entry.px > 0) || !(i.stop > 0)) return 'missing side/entry/stop';
  if (i.side * (i.entry.px - i.stop) <= 0) return 'stop on the wrong side of the entry';
  if (i.target != null && i.side * (i.target - i.entry.px) <= 0) return 'target on the wrong side of the entry';
  if (!(i.timeStopMin > 0)) return 'no time stop';
  return null;
}

class StrategyHost {
  constructor(strategy, o = {}) {
    this.s = strategy; this.name = o.name || strategy.name; this.p = Object.assign({}, strategy.params, o.params || {});
    this.fs = o.fs; this.regimeState = o.regime; this.tradableFn = o.tradable || (() => true);
    this.states = new Map(); this.open = new Map(); this.seq = 0; this.stats = { ideas: 0, rejected: 0, errors: 0 }; this.lastError = null;
    this.tfs = new Set(this.p.onlyTfs || strategy.tfs); // onlyTfs (a variant's setting) picks the timeframes, wider or narrower
    this.ph = paramsHash(strategy.version, this.p);
  }
  state(coin) { let x = this.states.get(coin); if (!x) this.states.set(coin, (x = {})); return x; }
  onEvent(ev) {
    if (!this.tfs.has(ev.tf) || ev.f.partial) return [];
    // generic filters any variant may set: onlyTfs, coins (whitelist), sides ([1] long only, [-1] short only)
    if (this.p.onlyTfs && !this.p.onlyTfs.includes(ev.tf)) return [];
    if (this.p.coins && !this.p.coins.includes(ev.coin)) return [];
    const now = ev.t + ev.tf * 60000;
    const api = {
      p: this.p, now, fs: this.fs, coins: () => [...this.fs.coins.keys()],
      regime: (c) => (this.regimeState ? this.regimeState.get(c, now) : { bias: 0, state: 'mixed', session: 'late', warm: false }),
      hist: (c, tf) => this.fs.history(c, tf), ctx: (c) => this.fs.context(c), state: (c) => this.state(c), tradable: (c) => this.tradableFn(c),
      oiChange: (c, min) => this.fs.oiChange(c, now, min), liqSum: (c, min) => this.fs.liqSum(c, now, min),
    };
    let out;
    try { out = this.s.onBar(ev, api); } catch (e) { this.stats.errors++; this.lastError = String(e && e.stack ? e.stack : e); return []; }
    if (!out) return [];
    const ideas = [];
    for (const i of [].concat(out)) {
      if (this.open.has(i.coin) || (this.p.sides && !this.p.sides.includes(i.side))) continue;
      if (!api.tradable(i.coin)) { this.stats.rejected++; continue; }
      const bad = validIdea(i);
      if (bad) { this.stats.rejected++; this.lastError = `${i.coin}: ${bad}`; continue; }
      const idea = Object.assign({ id: `${this.name}-${now.toString(36)}-${++this.seq}`, strategy: this.name, version: this.s.version || 1, ph: this.ph, tf: ev.tf, t: now }, i);
      idea.entry = Object.assign({ kind: 'maker', waitMin: Math.max(1, Math.min(10, ev.tf)), fallback: 'cancel' }, i.entry);
      idea.riskPct = Math.abs(idea.entry.px - idea.stop) / idea.entry.px;
      this.open.set(i.coin, idea.id);
      this.stats.ideas++;
      ideas.push(idea);
    }
    return ideas;
  }
  // the idea ended: never filled, or the trade closed. result = {outcome, r, netBps, exitT}
  onClose(coin, ideaId, result) {
    if (this.open.get(coin) === ideaId) this.open.delete(coin);
    if (this.s.onClose) { try { this.s.onClose(coin, result, { p: this.p, state: (c) => this.state(c) }); } catch (e) { this.stats.errors++; } }
  }
}

// helpers strategies share
const atrOf = (ev) => ev.f.atr;
const cooldown = (api, coin, now) => (api.state(coin).until || 0) > now;
const setCooldown = (api, coin, until) => { api.state(coin).until = until; };

module.exports = { StrategyHost, validIdea, atrOf, cooldown, setCooldown, paramsHash };
