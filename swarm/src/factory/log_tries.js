#!/usr/bin/env node
/* Log strategy variants that were tried outside the factory run, so the multiple-testing bar counts them too.
 * Every variant anyone backtests — a researcher's quick experiment, a parameter sweep — is a try: the more tries,
 * the more likely the best one is luck, and the higher the t-stat bar in factory/gate.js.
 *
 *   node swarm/src/factory/log_tries.js --factory <swarm-factory dir> --results <backtest results.json> [--note "…"]
 *   node swarm/src/factory/log_tries.js --factory <dir> --names it-45-strict:intraday-trend,tp-15-deep:trend-pullback --note "…"
 * Appends to <factory>/trials.jsonl only keys it has not seen (a key = plugin + parameter hash, or plugin + name
 * when the parameters are unknown).
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 12);
function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }

function logTries(factoryDir, tries, note, now = new Date().toISOString()) {
  const file = path.join(factoryDir, 'trials.jsonl');
  const seen = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
  const lines = [];
  for (const t of tries) {
    const key = t.params ? `${t.base}:${hash(t.params)}` : `${t.base}:name:${t.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(JSON.stringify({ key, name: t.name, base: t.base, params: t.params || null, at: now, n: t.n ?? null, avgR: t.avgR ?? null, tStat: t.tStat ?? null, note: note || null }));
  }
  if (lines.length) { fs.mkdirSync(factoryDir, { recursive: true }); fs.appendFileSync(file, lines.join('\n') + '\n'); }
  return { added: lines.length, total: seen.size };
}

function main() {
  const A = args(), tries = [];
  if (A.results) {
    const r = JSON.parse(fs.readFileSync(A.results, 'utf8'));
    for (const [name, s] of Object.entries(r.strategies || {})) tries.push({ name, base: s.base || name, params: s.params || null, n: s.all && s.all.n, avgR: s.all && s.all.avgR, tStat: s.all && s.all.tStat });
  }
  if (A.names) for (const x of String(A.names).split(',')) { const [name, base] = x.split(':'); tries.push({ name, base: base || name }); }
  const r = logTries(path.resolve(A.factory), tries, A.note);
  console.log(`logged ${r.added} new tries; ${r.total} in total`);
}
if (require.main === module) main();
module.exports = { logTries };
