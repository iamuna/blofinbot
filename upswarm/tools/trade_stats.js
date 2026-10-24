#!/usr/bin/env node
/* How robust is a backtest result? Per variant in a trades.json from trades_run.js: total R, R from the 5 best
 * trades, R without them, median trade, positive months, longs vs shorts, how trades ended.
 *
 *   node upswarm/tools/trade_stats.js --trades <trades.json> [--only prefix,prefix] [--out file.md]
 */
'use strict';
const fs = require('fs');
function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }
const f = (x, d = 1) => (x >= 0 ? '+' : '') + x.toFixed(d);

function stats(tr) {
  const rs = tr.map((t) => t.r).sort((a, b) => b - a), sum = rs.reduce((a, b) => a + b, 0), top5 = rs.slice(0, 5).reduce((a, b) => a + b, 0);
  const months = {}; for (const t of tr) { const m = new Date(t.exitT).toISOString().slice(0, 7); months[m] = (months[m] || 0) + t.r; }
  const mv = Object.values(months), ex = {}; for (const t of tr) ex[t.reason] = (ex[t.reason] || 0) + 1;
  return { n: tr.length, sum, avg: tr.length ? sum / tr.length : 0, top5, rest: sum - top5, median: rs.length ? rs[Math.floor(rs.length / 2)] : 0, monthsPos: mv.filter((x) => x > 0).length, months: mv.length,
    L: tr.filter((t) => t.side > 0).reduce((a, t) => a + t.r, 0), S: tr.filter((t) => t.side < 0).reduce((a, t) => a + t.r, 0), exits: ex };
}
function main() {
  const A = args(), T = JSON.parse(fs.readFileSync(A.trades, 'utf8')).trades, keep = A.only ? String(A.only).split(',') : null;
  const L = ['| Variant | Trades | Avg R | Sum R | 5 best trades | Without them | Median trade | Positive months | Longs / shorts (R) | Exits |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const [k, tr] of Object.entries(T)) {
    if (keep && !keep.some((p) => k.startsWith(p))) continue;
    const s = stats(tr);
    L.push(`| ${k} | ${s.n} | ${f(s.avg, 3)} | ${f(s.sum)} | ${f(s.top5)} | ${f(s.rest)} | ${f(s.median, 2)} | ${s.monthsPos}/${s.months} | ${f(s.L)} / ${f(s.S)} | ${Object.entries(s.exits).map(([e, n]) => `${e} ${n}`).join(', ')} |`);
  }
  const md = L.join('\n') + '\n';
  if (A.out) fs.writeFileSync(A.out, md);
  console.log(md);
}
if (require.main === module) main();
module.exports = { stats };
