#!/usr/bin/env node
// Merge the build shards' manifest-<i>.json into the manifest.json the backtest reads: node history/manifest.js <dir>
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2] || '.');
const coins = {}, months = new Set();
for (const f of fs.readdirSync(dir).filter((x) => /^manifest-\d+\.json$/.test(x))) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [c, x] of Object.entries(m.coins)) { coins[c] = x; if (x.status === 'ok') for (const mo of x.months) months.add(mo); }
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), months: [...months].sort(), currentMonthDays: [], coins }, null, 1));
const ok = Object.values(coins).filter((x) => x.status === 'ok').length;
console.log(`manifest: ${ok}/${Object.keys(coins).length} coins ok, ${months.size} months`);
