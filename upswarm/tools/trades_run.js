#!/usr/bin/env node
/* Backtest a set of strategy variants on the swarm dataset (branch swarm-data) with the live code path, and keep
 * every trade (the factory keeps only summaries). The research tools in upswarm/tools/ read these trade files.
 *
 *   node upswarm/tools/trades_run.js --data <swarm-data dir> --set config|exec|exits|<file.json> --out <dir>
 *
 * --set config  every strategy enabled in swarm/config/swarm.json (what the factory tests)
 * --set exec    the slow trend set, each with four entry policies (see POLICIES below)
 * --set exits   the slow trend set, each with four exit policies
 * A JSON file: [{name, base, params, entry?, exit?}] with entry/exit one of the policy names below.
 *
 * Variants with an entry or exit policy run as a wrapper around the plugin: the plugin decides as usual, the wrapper
 * only rewrites the idea's entry order or exits. Nothing in swarm/ is changed. Output: <out>/trades.json
 * ({name: [{coin, tf, side, t, entryT, exitT, r, netBps, grossBps, feeBps, slipBps, fundBps, riskBps, reason,
 * entryKind}]}), <out>/ideas.json ({name: {ideas, unfilled}}), <out>/summary.md.
 */
'use strict';
const fs = require('fs'), path = require('path');
const SW = path.join(__dirname, '..', '..', 'swarm');
const strategies = require(path.join(SW, 'src/strategies'));
const { backtest } = require(path.join(SW, 'src/backtest/run'));
const { summarize } = require(path.join(SW, 'src/backtest/stats'));

// the slow strategies with positive evidence in the 5-year sweep / deep review / era test, as configured
const SLOW = ['ma-retest-4h', 'ma-retest-12h', 'ma-pullback-12h', 'rsi-macd-trend-12h', 'it-4h', 'donchian-12h-60', 'donchian-1d-20'];

// entry policies (the idea's price and side are untouched)
const ENTRY = {
  cur: (i) => i,
  chase3cancel: (i) => Object.assign({}, i, { entry: { kind: 'maker', px: i.entry.px, waitMin: 3, fallback: 'cancel', chase: true } }),
  chase30taker: (i) => Object.assign({}, i, { entry: { kind: 'maker', px: i.entry.px, waitMin: 30, fallback: 'taker', chase: true } }),
  taker: (i) => Object.assign({}, i, { entry: { kind: 'taker', px: i.entry.px } }),
};
// exit policies (stop distance unchanged, so R stays comparable)
const EXIT = {
  cur: (i) => i,
  noTarget: (i) => Object.assign({}, i, { target: null }),
  // chandelier: no target, trail 3 ATR behind the best close once the trade is +1 R
  chandelier3: (i, ev) => Object.assign({}, i, { target: null, trail: { dist: 3 * ev.f.atr, afterR: 1 } }),
  // no target, trail at the initial risk distance from the start (a "1 R chandelier")
  trail1R: (i) => Object.assign({}, i, { target: null, trail: { dist: Math.abs(i.entry.px - i.stop), afterR: 0 } }),
};

function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }

// a wrapper plugin registered under its own name, so backtest() can use it as a variant's base
function wrapped(baseName, entry, exit) {
  const base = strategies.byName[baseName];
  const name = `${baseName}@${entry || 'cur'}@${exit || 'cur'}`;
  if (strategies.byName[name]) return name;
  const e = ENTRY[entry || 'cur'], x = EXIT[exit || 'cur'];
  if (!e || !x) throw new Error(`unknown policy ${entry}/${exit}`);
  strategies.byName[name] = Object.assign({}, base, {
    name,
    onBar(ev, api) { const out = base.onBar(ev, api); if (!out) return out; return [].concat(out).map((i) => x(e(i), ev)); },
  });
  return name;
}

function configSet(cfg) {
  const out = [];
  for (const [name, v] of Object.entries(cfg.strategies || {})) {
    if (v.enabled === false) continue;
    const base = v.base || name; if (!strategies.byName[base]) continue;
    out.push({ name, base, params: v.params || {} });
  }
  return out;
}
function policySet(cfg, kind) {
  const out = [], names = kind === 'exec' ? Object.keys(ENTRY) : Object.keys(EXIT);
  for (const s of SLOW) {
    const v = cfg.strategies[s]; if (!v) continue;
    for (const pol of names) out.push({ name: `${s} · ${kind === 'exec' ? 'entry' : 'exit'} ${pol}`, base: v.base || s, params: v.params || {}, entry: kind === 'exec' ? pol : null, exit: kind === 'exits' ? pol : null });
  }
  return out;
}

async function main() {
  const A = args(), cfg = JSON.parse(fs.readFileSync(path.join(SW, 'config', 'swarm.json'), 'utf8'));
  let set = A.set === 'config' ? configSet(cfg) : A.set === 'exec' ? policySet(cfg, 'exec') : A.set === 'exits' ? policySet(cfg, 'exits') : JSON.parse(fs.readFileSync(A.set, 'utf8'));
  if (A.only) { const keep = String(A.only).split(','); set = set.filter((v) => keep.some((k) => v.name.startsWith(k))); }
  const variants = set.map((v) => (v.entry || v.exit ? Object.assign({}, v, { base: wrapped(v.base, v.entry, v.exit) }) : v));
  const t0 = Date.now();
  const r = await backtest({ data: path.resolve(A.data), variants, warmupDays: 21, progress: (m, n) => console.error(`${new Date().toISOString().slice(11, 19)} month ${m} done, ${n} minutes, ${((Date.now() - t0) / 60000).toFixed(1)} min`) });
  const out = path.resolve(A.out); fs.mkdirSync(out, { recursive: true });
  const trades = {}, ideas = {}, L = ['| Variant | Ideas | Unfilled | Trades | Avg R | t | Sum R | Avg cost bps |', '|---|---|---|---|---|---|---|---|'];
  for (const v of variants) {
    const s = r.strategies[v.name];
    trades[v.name] = s.trades.map((t) => ({ coin: t.coin, tf: t.tf, side: t.side, t: t.t, entryT: t.entryT, exitT: t.exitT, r: t.r, netBps: t.netBps, grossBps: t.grossBps, feeBps: t.feeBps, slipBps: t.slipBps, fundBps: t.fundBps, riskBps: t.riskBps, reason: t.reason, entryKind: t.entryKind }));
    ideas[v.name] = { ideas: s.ideas.ideas, unfilled: s.unfilled };
    const a = s.all;
    L.push(`| ${v.name} | ${s.ideas.ideas} | ${s.unfilled} | ${a.n || 0} | ${a.avgR ?? '—'} | ${a.tStat ?? '—'} | ${a.sumR ?? '—'} | ${a.avgCostBps ?? '—'} |`);
  }
  fs.writeFileSync(path.join(out, 'trades.json'), JSON.stringify({ data: r.data, evalFrom: r.evalFrom, trades }));
  fs.writeFileSync(path.join(out, 'ideas.json'), JSON.stringify(ideas, null, 1));
  fs.writeFileSync(path.join(out, 'summary.md'), `# Trades run (${A.set})\n\nData ${r.data.from.slice(0, 10)} → ${r.data.to.slice(0, 10)}, ${r.data.coins} coins, trades counted from ${r.evalFrom.slice(0, 10)}. Live code path, BloFin costs (maker 2, taker 6, slippage 1.5 bps), funding charged.\n\n${L.join('\n')}\n`);
  console.log(L.join('\n'));
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { ENTRY, EXIT, SLOW, summarize };
