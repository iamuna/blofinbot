#!/usr/bin/env node
/* The manifest.json the backtest reads, from the plan and the coin files actually stored in the release:
 *   node history/manifest.js <dir>            (<dir> holds plan.json and assets.txt: one asset name per line)
 * A coin whose file is missing (a failed build) is left out and listed, so the report can say what it lacks.
 */
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2] || '.');
const P = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
const have = new Set(fs.readFileSync(path.join(dir, 'assets.txt'), 'utf8').split('\n').map((x) => x.trim()).filter((x) => x.endsWith('.tar')).map((x) => x.slice(0, -4)));
const coins = {}, months = new Set(), missing = [];
const SAFE = /^[A-Z0-9][A-Z0-9_]*$/; // names a release asset can carry (build.js leaves the others out)
for (const [c, x] of Object.entries(P.coins)) {
  if (!SAFE.test(c)) continue;
  if (!have.has(c)) { missing.push(c); continue; }
  coins[c] = { symbol: x.symbol, scale: x.scale, months: x.months, status: 'ok' };
  for (const m of x.months) months.add(m);
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), months: [...months].sort(), currentMonthDays: [], coins, missing }, null, 1));
console.log(`manifest: ${Object.keys(coins).length}/${Object.keys(P.coins).length} coins stored, ${months.size} months${missing.length ? `; missing: ${missing.join(' ')}` : ''}`);
