#!/usr/bin/env node
/* Loss-streak rules, tested before anyone adopts them. The 1-minute bot's risk governor (iamuna/1-min-blofin-bot,
 * btc_bot/risk.py) halved risk after 3 losses in a row and stopped trading after 6. The swarm's risk engine has day
 * and drawdown ladders and the allocator sizes each strategy from its own record, but no streak rule. Whether one
 * helps is an empirical question: if a strategy's results are independent from trade to trade, a streak rule only
 * cuts size at random times and loses R in proportion; it pays only if losses cluster (a regime the strategy does not
 * fit). So this replays a strategy's real trade list with and without the rule.
 *
 * Replay (per strategy, trades in exit order): size 1; after `reduceAfter` losses in a row size × `reduceTo`; after
 * `stopAfter` losses in a row size 0 — trades still happen in shadow and count toward the streak, and the first win
 * (shadow or not) resets it. A loss is r ≤ 0.
 *
 *   node swarm/src/research/streak_rules.js <trades-<strategy>.csv from backtest/run.js> [...] [--reduce-after 3]
 *        [--reduce-to 0.5] [--stop-after 6]
 */
'use strict';
const fs = require('fs');

function replay(trades, o = {}) {
  const reduceAfter = o.reduceAfter == null ? 3 : o.reduceAfter, reduceTo = o.reduceTo == null ? 0.5 : o.reduceTo, stopAfter = o.stopAfter == null ? 6 : o.stopAfter;
  const order = [...trades].sort((a, b) => a.exitT - b.exitT || a.entryT - b.entryT);
  let streak = 0, base = 0, ruled = 0, pkB = 0, pkR = 0, ddB = 0, ddR = 0, reduced = 0, stopped = 0, longest = 0;
  for (const t of order) {
    const size = streak >= stopAfter ? 0 : streak >= reduceAfter ? reduceTo : 1;
    if (size === 0) stopped++; else if (size < 1) reduced++;
    base += t.r; ruled += size * t.r;
    pkB = Math.max(pkB, base); ddB = Math.max(ddB, pkB - base); pkR = Math.max(pkR, ruled); ddR = Math.max(ddR, pkR - ruled);
    streak = t.r > 0 ? 0 : streak + 1; longest = Math.max(longest, streak);
  }
  const n = order.length, r2 = (x) => +x.toFixed(2);
  return { n, longestLosingStreak: longest, without: { sumR: r2(base), maxDDR: r2(ddB), retOverDD: ddB > 0 ? r2(base / ddB) : null },
    with: { sumR: r2(ruled), maxDDR: r2(ddR), retOverDD: ddR > 0 ? r2(ruled / ddR) : null }, tradesReduced: reduced, tradesStopped: stopped };
}

// the longest losing run you should expect in n independent trades with win rate p (≈ log(n·p) / log(1/(1−p)))
const expectedLongestStreak = (n, p) => (p > 0 && p < 1 ? Math.log(n * p) / Math.log(1 / (1 - p)) : NaN);

function readTrades(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean), hdr = lines[0].split(',');
  return lines.slice(1).map((l) => { const v = l.split(','), x = {}; hdr.forEach((h, k) => { x[h] = h === 'id' || h === 'coin' || /Kind$|reason/.test(h) ? v[k] : +v[k]; }); return x; });
}

if (require.main === module) {
  const files = [], A = {}, argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) A[argv[i].slice(2)] = +argv[++i]; else files.push(argv[i]); }
  for (const f of files) {
    const tr = readTrades(f), r = replay(tr, { reduceAfter: A['reduce-after'], reduceTo: A['reduce-to'], stopAfter: A['stop-after'] });
    const p = tr.filter((t) => t.r > 0).length / Math.max(1, tr.length);
    console.log(`${f}: ${r.n} trades, win rate ${(p * 100).toFixed(0)}%, longest losing run ${r.longestLosingStreak} (≈ ${expectedLongestStreak(r.n, p).toFixed(1)} expected by chance)`);
    console.log(`  without rule: ${r.without.sumR} R, max DD ${r.without.maxDDR} R, R/DD ${r.without.retOverDD}`);
    console.log(`  with rule:    ${r.with.sumR} R, max DD ${r.with.maxDDR} R, R/DD ${r.with.retOverDD} (${r.tradesReduced} trades at reduced size, ${r.tradesStopped} skipped)`);
  }
}
module.exports = { replay, expectedLongestStreak, readTrades };
