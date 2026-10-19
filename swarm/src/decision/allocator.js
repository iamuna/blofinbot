/* Allocator: how much each strategy may risk per trade, from its own results, and the size of each intent.
 *
 *   budget = min(cap, ¼ · n/(n+100) · μ/σ²)      μ, σ: mean and spread of its last 300 net trade results in R
 * A strategy with fewer than `minTrades` trades in the counted modes risks `startPct` (0.25%); once it has them,
 * its budget follows the formula, and a strategy whose average is not positive gets 0 (it goes back to shadow).
 * cap: 0.5% in the first live month, 1% after (risk.json); paper and demo use the same rules.
 * size: qty (base units) = equity × budget ÷ |entry − stop|, then the risk agent applies the hard limits.
 */
'use strict';

class Allocator {
  constructor(o = {}) {
    this.startPct = o.startPct == null ? 0.0025 : o.startPct; this.capPct = o.capPct == null ? 0.005 : o.capPct;
    this.minTrades = o.minTrades || 100; this.window = o.window || 300; this.kellyFrac = o.kellyFrac || 0.25; this.shrink = o.shrink || 100;
    this.results = new Map(); // strategy → [r, …] (newest last)
    this.scale = 1; // set by the risk agent's drawdown ladder
  }
  record(strategy, r) {
    let a = this.results.get(strategy); if (!a) this.results.set(strategy, (a = []));
    a.push(r); if (a.length > this.window) a.splice(0, a.length - this.window);
  }
  load(map) { for (const [k, v] of Object.entries(map || {})) this.results.set(k, v.slice(-this.window)); }
  dump() { return Object.fromEntries(this.results); }
  stats(strategy) {
    const a = this.results.get(strategy) || [], n = a.length;
    if (!n) return { n: 0, mean: 0, sd: 0 };
    const mean = a.reduce((x, y) => x + y, 0) / n, sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, n - 1));
    return { n, mean, sd };
  }
  budget(strategy) {
    const s = this.stats(strategy);
    let b;
    if (s.n < this.minTrades) b = this.startPct;
    else if (s.mean <= 0 || !(s.sd > 0)) b = 0;
    // μ/σ² (results in R) is the Kelly fraction of equity to risk per trade; e.g. μ 0.05, σ 1.1, n 200 → 0.69%
    else b = Math.min(this.capPct, this.kellyFrac * (s.n / (s.n + this.shrink)) * (s.mean / (s.sd * s.sd)));
    return b * this.scale;
  }
  size(intent, equity) {
    const dist = Math.abs(intent.entry.px - intent.stop);
    if (!(dist > 0) || !(equity > 0)) return null;
    const riskUsd = equity * intent.riskPct;
    return { qty: riskUsd / dist, riskUsd, notional: (riskUsd / dist) * intent.entry.px };
  }
}

module.exports = { Allocator };
