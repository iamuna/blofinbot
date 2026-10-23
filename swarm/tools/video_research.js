#!/usr/bin/env node
/* Reproduces docs/VIDEO_STRATEGIES_2026-10-23.md: the strategies from Mitch Ray TA's videos and the confluence
 * switches on the 21/200 retest, on the deep review's three samples.
 *
 *   git worktree add ../rd research-data && git worktree add ../vd validation-data   (or git archive the branches)
 *   node swarm/tools/video_research.js --research ../rd --validation ../vd [--out video-research]
 *
 * IS = research-data 2020-2023, OOS-time = research-data 2024-2026, OOS-coins = validation-data 2020-2026
 * (30 other coins, dead ones included). Trades from 2020-03-01 (warm-up). ~5 minutes; prints every table of the
 * doc and writes <out>/tables.md.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { run } = require('./hourly_backtest');

const SPLIT = Date.parse('2024-01-01'), WARM = Date.parse('2020-03-01'), DAY = 86400000;
const TFS = [[240, '4h'], [720, '12h'], [1440, '1d']], GOLD = [0.382, null];

function variants() {
  const v = [];
  // round 1: the four video strategies, defaults, 4h / 12h / 1d
  for (const base of ['mixing-bowl', 'fib-golden', 'abcd', 'wedge-break']) for (const [tf, tag] of TFS) {
    const params = { tf, onlyTfs: [tf] };
    if (base === 'mixing-bowl' && tf === 1440) Object.assign(params, { htf: 0, minScore: 3 }); // no timeframe above 1d
    v.push({ name: `${base}-${tag}`, base, params });
  }
  // round 2: the 21/200 retest, each confluence switch on its own
  for (const [tf, tag] of TFS) {
    const b = { mode: 'retest', tf, onlyTfs: [tf] };
    v.push({ name: `ma-retest-${tag}`, base: 'ma-21-200', params: b });
    v.push({ name: `mrp-${tag}-off`, base: 'ma-retest-plus', params: b });
    v.push({ name: `mrp-${tag}-noDiv`, base: 'ma-retest-plus', params: Object.assign({ noDiv: true }, b) });
    if (tf < 1440) v.push({ name: `mrp-${tag}-htf`, base: 'ma-retest-plus', params: Object.assign({ htf: 1440 }, b) });
    v.push({ name: `mrp-${tag}-zone`, base: 'ma-retest-plus', params: Object.assign({ zone: [0.382, 0.786] }, b) });
    v.push({ name: `mrp-${tag}-fibTgt`, base: 'ma-retest-plus', params: Object.assign({ tgtMode: 'fib' }, b) });
  }
  // round 3: the golden-zone minimum (from the depth table), pull-back mode, one combination, ABCD on wider swings
  for (const [tf, tag] of TFS) {
    v.push({ name: `mrp-${tag}-golden`, base: 'ma-retest-plus', params: { mode: 'retest', tf, onlyTfs: [tf], zone: GOLD } });
    v.push({ name: `mpb-${tag}-golden`, base: 'ma-retest-plus', params: { mode: 'pullback', tf, onlyTfs: [tf], zone: GOLD } });
  }
  v.push({ name: 'ma-pullback-4h', base: 'ma-21-200', params: { mode: 'pullback', tf: 240, onlyTfs: [240] } });
  v.push({ name: 'ma-pullback-12h', base: 'ma-21-200', params: { mode: 'pullback', tf: 720, onlyTfs: [720] } });
  v.push({ name: 'mrp-12h-golden-fibTgt', base: 'ma-retest-plus', params: { mode: 'retest', tf: 720, onlyTfs: [720], zone: GOLD, tgtMode: 'fib' } });
  for (const [tf, tag] of [[60, '1h'], [240, '4h'], [720, '12h']]) v.push({ name: `abcd-${tag}-swing2.5`, base: 'abcd', params: { tf, onlyTfs: [tf], minRevAtr: 2.5 } });
  // diagnostics: every mixing-bowl setup (no score floor) for the ingredient table; every retest with its depth
  v.push({ name: 'mb-4h-all', base: 'mixing-bowl', params: { tf: 240, onlyTfs: [240], minScore: 1, needDiv: false, minRR: 0 } });
  v.push({ name: 'mb-12h-all', base: 'mixing-bowl', params: { tf: 720, onlyTfs: [720], minScore: 1, needDiv: false, minRR: 0 } });
  for (const [tf, tag] of TFS) v.push({ name: `depth-${tag}`, base: 'ma-retest-plus', params: { mode: 'retest', tf, onlyTfs: [tf], zone: [-1e9, null] } });
  v.push({ name: 'rsi-macd-trend-12h', base: 'rsi-macd', params: { mode: 'trend', tf: 720, entry: 'maker', onlyTfs: [720] } });
  return v;
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
function daily(ts) { // sum R, t, Sharpe and max DD on daily sums
  if (!ts.length) return { n: 0 };
  const m = new Map(); for (const t of ts) { const d = Math.floor(t.exitT / DAY); m.set(d, (m.get(d) || 0) + t.r); }
  const k = [...m.keys()], a = Math.min(...k), b = Math.max(...k), xs = []; for (let d = a; d <= b; d++) xs.push(m.get(d) || 0);
  const mu = avg(xs), sd = Math.sqrt(xs.reduce((p, x) => p + (x - mu) ** 2, 0) / Math.max(1, xs.length - 1));
  let eq = 0, pk = 0, dd = 0; for (const x of xs) { eq += x; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  return { n: ts.length, avgR: avg(ts.map((t) => t.r)), sumR: eq, t: sd > 0 ? (mu / sd) * Math.sqrt(xs.length) : 0, sharpe: sd > 0 ? (mu / sd) * Math.sqrt(365) : 0, dd };
}
const cell = (s) => (s.n ? `${s.n} · ${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(3)} (t ${s.t.toFixed(1)})` : '0');

function main() {
  const A = {}; const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) A[argv[i].slice(2)] = argv[i + 1];
  const V = variants(), out = path.resolve(A.out || 'video-research'); fs.mkdirSync(out, { recursive: true });
  console.error('research-data …'); const R = run({ data: path.resolve(A.research), variants: V });
  console.error('validation-data …'); const Q = run({ data: path.resolve(A.validation), variants: V });
  const S = {};
  for (const v of V) {
    const r = R.variants[v.name].trades.filter((t) => t.entryT >= WARM), q = Q.variants[v.name].trades.filter((t) => t.entryT >= WARM);
    S[v.name] = { IS: r.filter((t) => t.entryT < SPLIT), OT: r.filter((t) => t.entryT >= SPLIT), OC: q };
  }
  const L = [];
  L.push('## Every variant (n · avg R (t on daily sums))', '', '| Variant | IS 2020-23 | OOS-time 2024-26 | OOS-coins 2020-26 |', '|---|---|---|---|');
  for (const v of V) if (!/^depth-/.test(v.name)) L.push(`| ${v.name} | ${cell(daily(S[v.name].IS))} | ${cell(daily(S[v.name].OT))} | ${cell(daily(S[v.name].OC))} |`);
  // depth buckets of the retest
  const edges = [-Infinity, 0.236, 0.382, 0.5, 0.618, 0.786, 1, Infinity];
  for (const [, tag] of TFS) {
    L.push('', `## Retest by pull-back depth, ${tag} (n · avg R)`, '', '| Depth | IS | OOS-time | OOS-coins |', '|---|---|---|---|');
    for (let i = 0; i < edges.length - 1; i++) {
      const pick = (ts) => ts.filter((t) => { const d = +/pull-back (-?\d+)%/.exec(t.why)[1] / 100; return d >= edges[i] && d < edges[i + 1]; }).map((t) => t.r);
      const c = (a) => (a.length ? `${a.length} · ${avg(a).toFixed(3)}` : '0');
      const s = S[`depth-${tag}`];
      L.push(`| ${edges[i]}–${edges[i + 1]} | ${c(pick(s.IS))} | ${c(pick(s.OT))} | ${c(pick(s.OC))} |`);
    }
  }
  // ingredient lift
  const ING = [['RSI divergence', /RSI div/], ['MACD divergence', /MACD div/], ['look-left support', /S\/R/], ['pattern', /double bottom|wedge/], ['Fibonacci golden zone', /fib \d+%/], ['1d divergence', /1440m div/], ['bowl (1d trend)', /[:,] bowl[,)]/]];
  for (const tag of ['4h', '12h']) {
    L.push('', `## Mixing-bowl ingredients, ${tag}: avg R with − without`, '', '| Ingredient | IS | OOS-time | OOS-coins |', '|---|---|---|---|');
    const s = S[`mb-${tag}-all`];
    for (const [name, re] of ING) {
      const lift = (ts) => { const w = ts.filter((t) => re.test(t.why)).map((t) => t.r), wo = ts.filter((t) => !re.test(t.why)).map((t) => t.r); return `${w.length} · ${(avg(w) - avg(wo) >= 0 ? '+' : '')}${(avg(w) - avg(wo)).toFixed(3)}`; };
      L.push(`| ${name} | ${lift(s.IS)} | ${lift(s.OT)} | ${lift(s.OC)} |`);
    }
    L.push('', '| Score | IS | OOS-time | OOS-coins |', '|---|---|---|---|');
    for (let k = 1; k <= 6; k++) { const c = (ts) => { const a = ts.filter((t) => +(/\((\d+):/.exec(t.why) || [])[1] === k).map((t) => t.r); return a.length ? `${a.length} · ${avg(a).toFixed(3)}` : '0'; }; L.push(`| ${k} | ${c(s.IS)} | ${c(s.OT)} | ${c(s.OC)} |`); }
  }
  // years and the book
  L.push('', '## By year (all 50 coins: n · avg R)', '');
  const yrs = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  L.push(`| Variant | ${yrs.join(' | ')} | all | sum R | max DD R |`, `|---|${yrs.map(() => '---').join('|')}|---|---|---|`);
  for (const n of ['ma-retest-4h', 'mrp-4h-golden', 'ma-retest-12h', 'mrp-12h-golden', 'mrp-12h-golden-fibTgt', 'ma-retest-1d', 'mrp-1d-golden', 'fib-golden-4h']) {
    const all = [...S[n].IS, ...S[n].OT, ...S[n].OC], d = daily(all);
    L.push(`| ${n} | ${yrs.map((y) => { const a = all.filter((t) => new Date(t.entryT).getUTCFullYear() === y).map((t) => t.r); return a.length ? `${a.length} · ${avg(a).toFixed(3)}` : '0'; }).join(' | ')} | ${d.avgR.toFixed(3)} (t ${d.t.toFixed(2)}) | ${d.sumR.toFixed(0)} | ${d.dd.toFixed(0)} |`);
  }
  const books = { 'robust five (today)': ['ma-retest-12h', 'ma-retest-1d', 'rsi-macd-trend-12h', 'ma-retest-4h', 'ma-pullback-12h'],
    'robust five, 4h retest → golden': ['ma-retest-12h', 'ma-retest-1d', 'rsi-macd-trend-12h', 'mrp-4h-golden', 'ma-pullback-12h'] };
  L.push('', '## The robust five as one book of R (sum R, Sharpe, max DD)', '', '| Book | IS | OOS-time | OOS-coins |', '|---|---|---|---|');
  for (const [name, list] of Object.entries(books)) {
    const c = (k) => { const d = daily(list.flatMap((n) => S[n][k])); return `${d.sumR.toFixed(0)} R, ${d.sharpe.toFixed(2)}, ${d.dd.toFixed(0)} R`; };
    L.push(`| ${name} | ${c('IS')} | ${c('OT')} | ${c('OC')} |`);
  }
  const md = L.join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'tables.md'), md); console.log(md);
}

if (require.main === module) main();
module.exports = { variants };
