#!/usr/bin/env node
/* Tuner: champion / challenger search inside a plugin's `bounds` (kit.js documents `bounds` "for the tuner"; until
 * now nothing used them). Ported from the 1-minute bot (iamuna/1-min-blofin-bot, btc_bot/engine.py learning_cycle,
 * btc_bot/learning.py mutate / walk_forward_rows / score_metrics), which ran exactly this loop on BTC 1m, found
 * nothing that survived its own test data, and promoted nothing — the behaviour to keep.
 *
 *   node swarm/src/factory/tuner.js --data <swarm-data dir> --base ma-21-200 --parent '{"mode":"retest","tf":720,"onlyTfs":[720]}'
 *        [--challengers 12] [--seed 1] [--step 0.2] [--min-trades 40] [--factory <swarm-factory dir>] [--candidates <dir>] [--out dir]
 *
 * 1. Challengers: the parent's parameters, each bounded number moved by up to ±step × (its range), integers rounded;
 *    a [false, true] bound flips with probability 0.2. Seeded, so a run can be repeated.
 * 2. One backtest pass (backtest/run.js) for the parent and every challenger, scored at 1.5× costs throughout.
 * 3. Chronological split of the evaluated period: train 60% | validation 20% | test 20% (by entry time).
 *    Train: walk-forward over 4 windows — mean of (2·avgR + ¼·min(PF, 5)) − 0.05·worst window drawdown (R)
 *    − 0.75 per losing window. Challengers are ranked by train + validation score; only the best sees the test part.
 * 4. Promote (= write a factory candidate) only if the best has avgR > 0 and PF > 1 on validation AND test, enough
 *    trades in each, and beats the parent's validation and test scores by ≥ 0.10.
 * 5. Every challenger is a try: with --factory they all go into trials.jsonl, so the factory's t-stat bar rises with
 *    them. A written candidate still has to pass the factory's backtest gate and shadow — the tuner decides nothing
 *    about trading.
 * Tune only a family with direction before costs (research/event_study.js); on a family without, the best of many
 * settings is luck (docs/DEEP_REVIEW_2026-10-23.md, recommendation 3).
 */
'use strict';
const fs = require('fs'), path = require('path');
const { summarize } = require('../backtest/stats');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function mutate(plugin, parent, seed = 1, count = 12, o = {}) {
  const step = o.step == null ? 0.2 : o.step, r = rng(seed), out = [], bounds = plugin.bounds || {};
  const base = Object.assign({}, plugin.params, parent);
  for (let k = 0; k < count; k++) {
    const x = Object.assign({}, parent);
    for (const [key, b] of Object.entries(bounds)) {
      if (typeof b[0] === 'boolean') { if (r() < 0.2) x[key] = !base[key]; continue; }
      const [lo, hi] = b, cur = base[key] == null ? (lo + hi) / 2 : base[key];
      let v = Math.max(lo, Math.min(hi, cur + (r() * 2 - 1) * step * (hi - lo)));
      if (Number.isInteger(cur) && Number.isInteger(lo) && Number.isInteger(hi)) v = Math.round(v); else v = +v.toPrecision(4);
      x[key] = v;
    }
    out.push(x);
  }
  return out;
}

// the 1-minute bot's score: expectancy counts twice, profit factor a little, drawdown costs; too few trades → −1e9
function score(m, minTrades) { if (!m || !(m.n >= minTrades)) return -1e9; return m.avgR * 2 + Math.min(5, m.pf == null ? 5 : m.pf) * 0.25 - m.maxDDR * 0.05; }
function walkForward(trades, t0, t1, windows, minTrades) {
  const w = (t1 - t0) / windows, ms = [];
  for (let k = 0; k < windows; k++) ms.push(summarize(trades.filter((t) => t.entryT >= t0 + k * w && t.entryT < t0 + (k + 1) * w), { costMult: 1.5 }));
  if (ms.reduce((a, m) => a + (m.n || 0), 0) < minTrades) return { score: -1e9, windows: ms };
  const v = ms.filter((m) => m.n > 0), worst = Math.max(...v.map((m) => m.maxDDR), 0), neg = v.filter((m) => m.avgR <= 0).length;
  const avg = (f) => v.reduce((a, m) => a + f(m), 0) / Math.max(1, v.length);
  return { score: avg((m) => m.avgR) * 2 + avg((m) => Math.min(5, m.pf == null ? 5 : m.pf)) * 0.25 - worst * 0.05 - neg * 0.75, windows: ms };
}

// tradesByName: {name: [trades]} for 'parent' and each challenger; [t0, t1): the evaluated period
function decide(tradesByName, t0, t1, o = {}) {
  const minTrades = o.minTrades || 40, sliceMin = Math.max(5, Math.round(minTrades / 4));
  const a = t0 + 0.6 * (t1 - t0), b = t0 + 0.8 * (t1 - t0);
  const part = (tr, lo, hi) => summarize(tr.filter((t) => t.entryT >= lo && t.entryT < hi), { costMult: 1.5 });
  const P = tradesByName.parent || [], pVal = part(P, a, b), pTest = part(P, b, t1);
  const ranked = Object.entries(tradesByName).filter(([n]) => n !== 'parent').map(([name, tr]) => {
    const wf = walkForward(tr.filter((t) => t.entryT < a), t0, a, 4, minTrades), val = part(tr, a, b);
    return { name, train: wf.score, val, valScore: score(val, sliceMin), total: wf.score + score(val, sliceMin) };
  }).sort((x, y) => y.total - x.total);
  const best = ranked[0];
  if (!best) return { promote: false, why: ['no challengers'], ranked };
  const test = part(tradesByName[best.name], b, t1), why = [];
  const pv = score(pVal, sliceMin), pt = score(pTest, sliceMin), bt = score(test, sliceMin);
  const fmt = (x) => (x == null ? '—' : x), fs2 = (x) => (x <= -1e9 ? 'too few trades' : x.toFixed(2));
  if (!((best.val.n || 0) >= sliceMin) || !((test.n || 0) >= sliceMin)) why.push(`${best.val.n || 0} trades in validation, ${test.n || 0} in test (need ${sliceMin} each)`);
  else {
    if (!(best.val.avgR > 0) || !(test.avgR > 0)) why.push(`avg R at 1.5× costs: validation ${fmt(best.val.avgR)}, test ${fmt(test.avgR)} (both must be > 0)`);
    const pfOk = (m) => (m.pf == null ? m.n > 0 && m.avgR > 0 : m.pf > 1); // summarize gives no PF when nothing lost
    if (!pfOk(best.val) || !pfOk(test)) why.push(`profit factor: validation ${fmt(best.val.pf)}, test ${fmt(test.pf)} (both must be > 1)`);
    if (!(best.valScore >= pv + 0.1) || !(bt >= pt + 0.1)) why.push(`not 0.10 better than the parent (validation ${fs2(best.valScore)} vs ${fs2(pv)}, test ${fs2(bt)} vs ${fs2(pt)})`);
  }
  return { promote: why.length === 0, why, best: Object.assign({}, best, { test, testScore: bt }), parent: { val: pVal, test: pTest, valScore: pv, testScore: pt }, ranked };
}

async function main() {
  const A = {}, argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) A[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const strategies = require('../strategies'), { backtest } = require('../backtest/run'), { logTries } = require('./log_tries');
  const plugin = strategies.byName[A.base]; if (!plugin) throw new Error(`unknown plugin ${A.base}`);
  if (!plugin.bounds || !Object.keys(plugin.bounds).length) throw new Error(`${A.base} declares no bounds to tune within`);
  const parent = A.parent ? JSON.parse(A.parent) : {}, seed = +(A.seed || 1), n = +(A.challengers || 12), minTrades = +(A['min-trades'] || 40);
  const kids = mutate(plugin, parent, seed, n, { step: A.step == null ? 0.2 : +A.step });
  const variants = [{ name: 'parent', base: A.base, params: parent }].concat(kids.map((p, k) => ({ name: `${A.base}-s${seed}-c${k + 1}`, base: A.base, params: p })));
  const r = await backtest({ data: path.resolve(A.data), variants, warmupDays: 21, progress: (m) => console.error(`month ${m} done`) });
  const t0 = Date.parse(r.evalFrom), t1 = Date.parse(r.data.to) + 60000, byName = {};
  for (const v of variants) byName[v.name] = r.strategies[v.name].trades;
  const d = decide(byName, t0, t1, { minTrades });
  if (A.factory) {
    const lg = logTries(path.resolve(A.factory), variants.map((v) => ({ name: v.name, base: A.base, params: v.params, n: r.strategies[v.name].all.n, avgR: r.strategies[v.name].all.avgR, tStat: r.strategies[v.name].all.tStat })), `tuner ${A.base} seed ${seed}`);
    console.error(`logged ${lg.added} new tries (${lg.total} in total)`);
  } else console.error('no --factory: these tries are NOT counted toward the multiple-testing bar — log them with log_tries.js');
  const out = path.resolve(A.out || 'swarm-tuner'); fs.mkdirSync(out, { recursive: true });
  const slim = Object.assign({}, d, { ranked: d.ranked.map((x) => ({ name: x.name, params: variants.find((v) => v.name === x.name).params, train: +x.train.toFixed(3), valScore: +x.valScore.toFixed(3), val: x.val })) });
  fs.writeFileSync(path.join(out, 'tuner.json'), JSON.stringify(slim, null, 1));
  if (d.promote) {
    const best = variants.find((v) => v.name === d.best.name), cand = { name: best.name, base: A.base, params: best.params, idea: `tuner challenger of ${JSON.stringify(parent)}: beat the parent on validation and untouched test at 1.5× costs`, source: 'swarm/src/factory/tuner.js', author: 'tuner' };
    const dir = path.resolve(A.candidates || out); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${best.name}.json`), JSON.stringify(cand, null, 2) + '\n');
    console.log(`candidate written: ${path.join(dir, best.name + '.json')} — the factory's backtest gate decides next`);
  } else console.log(`no challenger promoted: ${d.why.join('; ')}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { mutate, score, walkForward, decide, rng };
