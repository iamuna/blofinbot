#!/usr/bin/env node
/* Tester: backtests every candidate strategy and every configured strategy on the swarm dataset, logs each try,
 * and applies the backtest gate.
 *
 *   node swarm/src/factory/test_candidates.js --data <swarm-data> --out <factory dir> [--candidates swarm/factory/candidates]
 *
 * <out>/trials.jsonl     one line per (variant, parameters) ever tested — the multiple-testing count
 * <out>/results/<name>.json, <out>/LATEST.md (table + gate verdicts), <out>/latest.json
 * A candidate file: {"name": "...", "base": "<plugin>", "params": {...}, "idea": "...", "source": "...", "author": "..."}
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { backtest } = require('../backtest/run');
const { backtestGate } = require('./gate');
const strategies = require('../strategies');

function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }
const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 12);

async function main() {
  const A = args(), out = path.resolve(A.out || 'swarm-factory'), candDir = path.resolve(A.candidates || path.join(__dirname, '..', '..', 'factory', 'candidates'));
  fs.mkdirSync(path.join(out, 'results'), { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'swarm.json'), 'utf8'));
  const variants = [];
  for (const [name, v] of Object.entries(cfg.strategies || {})) {
    if (v.enabled === false) continue;
    const base = v.base || name; if (!strategies.byName[base]) continue;
    variants.push({ name, base, params: v.params || {}, origin: 'config' });
  }
  if (fs.existsSync(candDir)) for (const f of fs.readdirSync(candDir).filter((x) => x.endsWith('.json'))) {
    const c = JSON.parse(fs.readFileSync(path.join(candDir, f), 'utf8'));
    if (!strategies.byName[c.base]) { console.error(`${f}: unknown plugin ${c.base}`); continue; }
    if (variants.some((v) => v.name === c.name)) { console.error(`${f}: name ${c.name} already used`); continue; }
    variants.push(Object.assign({ origin: `candidate ${f}` }, c));
  }
  const trialsFile = path.join(out, 'trials.jsonl');
  const seen = new Set(fs.existsSync(trialsFile) ? fs.readFileSync(trialsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
  const r = await backtest({ data: path.resolve(A.data), variants, warmupDays: 21, split: A.split ? Date.parse(A.split) : null, progress: (m) => console.error(`month ${m} done`) });
  const now = new Date().toISOString(), lines = [];
  for (const v of variants) { const key = `${v.base}:${hash(v.params)}`; if (!seen.has(key)) { seen.add(key); const s = r.strategies[v.name].all; lines.push(JSON.stringify({ key, name: v.name, base: v.base, params: v.params, at: now, n: s.n || 0, avgR: s.avgR, tStat: s.tStat })); } }
  if (lines.length) fs.appendFileSync(trialsFile, lines.join('\n') + '\n');
  const tries = seen.size;
  const table = ['| Strategy | Origin | Trades | Avg R | t | Avg R at 1.5× costs | Thirds (sum R) | Backtest gate |', '|---|---|---|---|---|---|---|---|'], latest = {};
  for (const v of variants) {
    const s = r.strategies[v.name], g = backtestGate(s, tries);
    const row = { name: v.name, base: v.base, params: v.params, origin: v.origin, idea: v.idea || null, source: v.source || null, all: s.all, cost15: s.cost15, thirds: s.thirds, months: s.months, gate: g, testedAt: now, data: r.data };
    latest[v.name] = row;
    fs.writeFileSync(path.join(out, 'results', `${v.name}.json`), JSON.stringify(row, null, 1));
    table.push(`| ${v.name} | ${v.origin} | ${s.all.n || 0} | ${s.all.avgR ?? '—'} | ${s.all.tStat ?? '—'} | ${s.cost15.avgR ?? '—'} | ${(s.thirds || []).map((x) => (x.n ? x.sumR : 0)).join(' / ')} | ${g.pass ? '**pass**' : g.why.join('; ')} |`);
  }
  fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify({ testedAt: now, tries, data: r.data, results: latest }, null, 1));
  const md = [`# Strategy factory — latest test`, '', `Tested ${now.slice(0, 16)}Z on ${r.data.coins} coins, ${r.data.from.slice(0, 10)} → ${r.data.to.slice(0, 10)}. Variants tried so far: ${tries} → t-stat bar ${(2 + 0.5 * Math.log10(tries)).toFixed(2)}.`, '', ...table].join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'LATEST.md'), md);
  console.log(md);
}
main().catch((e) => { console.error(e); process.exit(1); });
