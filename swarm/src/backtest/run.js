#!/usr/bin/env node
/* Backtest strategy plugins on the swarm dataset (swarm-data branch) with the live code path:
 * 1-minute bars → FeatureState → RegimeState → StrategyHost → ExecSim. Each strategy trades on its own (one
 * position per coin), so its own edge is measured; combining them is the allocator's job.
 *
 *   node swarm/src/backtest/run.js --data <swarm-data dir> [--strategies a,b] [--coins BTC,ETH] [--from 2026-05-15]
 *        [--to 2026-10-19] [--warmup-days 21] [--slip 1.5] [--out dir] [--params '{"intraday-trend":{"volZ":1}}']
 * Writes <out>/results.json, <out>/report.md and <out>/trades-<strategy>.csv.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { FeatureState } = require('../analysis/features');
const { RegimeState } = require('../analysis/regime');
const { StrategyHost } = require('../strategies/kit');
const strategies = require('../strategies');
const { ExecSim } = require('./exec_sim');
const { summarize, breakdown } = require('./stats');

const MIN = 60000, DAY = 86400000;
function readCsvGz(file) {
  if (!fs.existsSync(file)) return null;
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n');
  const hdr = lines[0].split(','), rows = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const r = lines[i].split(','); const o = {}; for (let k = 0; k < hdr.length; k++) o[hdr[k]] = +r[k]; rows.push(o); }
  return rows;
}

async function backtest(o) {
  const man = JSON.parse(fs.readFileSync(path.join(o.data, 'manifest.json'), 'utf8'));
  let coins = Object.entries(man.coins).filter(([, v]) => v.status === 'ok').map(([k]) => k);
  if (o.coins) coins = coins.filter((c) => o.coins.includes(c));
  coins.sort((a, b) => (a === 'BTC' ? -1 : b === 'BTC' ? 1 : a.localeCompare(b))); // BTC first in every minute
  const months = [...new Set([...man.months, ...(man.currentMonthDays || []).map((d) => d.slice(0, 7))])].sort();
  // variants: [{name, base, params}] — several parameter sets of the same plugin share one pass over the data
  const plugins = o.variants ? o.variants.map((v) => Object.assign({}, strategies.byName[v.base], { name: v.name, variantParams: v.params || {} }))
    : (o.strategies ? o.strategies.map((n) => strategies.byName[n]).filter(Boolean) : strategies.all);
  const fsx = new FeatureState(), regime = new RegimeState();
  const funding = {}, oi = {};
  for (const c of coins) { funding[c] = (readCsvGz(path.join(o.data, c, 'funding.csv.gz')) || []).map((r) => [r.t, r.rate]); oi[c] = []; }
  const evalFrom = o.from || 0, evalTo = o.to || Infinity;
  const sims = {}, hosts = {};
  for (const s of plugins) {
    const sim = new ExecSim({ funding, slipBps: o.slip, onClose: (idea, res) => hosts[s.name].onClose(idea.coin, idea.id, res) });
    sims[s.name] = sim;
    hosts[s.name] = new StrategyHost(s, { fs: fsx, regime, params: Object.assign({}, s.variantParams, (o.params || {})[s.name]) });
  }
  const fptr = {}, optr = {}; for (const c of coins) { fptr[c] = 0; optr[c] = 0; }
  let minutes = 0, firstT = null, lastT = 0;
  for (const m of months) {
    const data = {};
    for (const c of coins) {
      const bars = readCsvGz(path.join(o.data, c, `1m-${m}.csv.gz`));
      if (bars) data[c] = { bars, i: 0 };
      oi[c] = oi[c].concat(readCsvGz(path.join(o.data, c, `oi-${m}.csv.gz`)) || []);
    }
    const ts = new Set(); for (const c in data) for (const b of data[c].bars) ts.add(b.t);
    const times = [...ts].sort((a, b) => a - b);
    for (const t of times) {
      if (t > evalTo) break;
      if (firstT == null) firstT = t;
      lastT = t; minutes++;
      for (const c of coins) {
        const d = data[c]; if (!d) continue;
        while (d.i < d.bars.length && d.bars[d.i].t < t) d.i++;
        const b = d.bars[d.i]; if (!b || b.t !== t) continue;
        // context known by the close of this minute: last settled funding rate, open interest snapshots
        const close = t + MIN, F = funding[c];
        while (fptr[c] < F.length && F[fptr[c]][0] <= close) { fsx.onFunding(c, F[fptr[c]][1], null); fptr[c]++; }
        const O = oi[c];
        while (optr[c] < O.length && O[optr[c]].t <= close) { const r = O[optr[c]]; fsx.onOI(c, r.t, r.oi, r.oiQ); optr[c]++; }
        for (const s of plugins) sims[s.name].onBar(c, b);
        const evs = fsx.onBar1m(c, b);
        for (const ev of evs) regime.onEvent(ev);
        for (const ev of evs) for (const s of plugins) for (const idea of hosts[s.name].onEvent(ev)) sims[s.name].submit(idea);
      }
    }
    if (o.progress) o.progress(m, minutes);
  }
  const from = evalFrom || firstT + (o.warmupDays == null ? 21 : o.warmupDays) * DAY;
  const out = { generated: new Date().toISOString(), data: { from: new Date(firstT).toISOString(), to: new Date(lastT).toISOString(), coins: coins.length, minutes }, evalFrom: new Date(from).toISOString(), costs: { makerBps: 2, takerBps: 6, slipBps: o.slip == null ? 1.5 : o.slip }, strategies: {} };
  for (const s of plugins) {
    const trades = sims[s.name].trades.filter((t) => t.entryT >= from);
    const ideas = hosts[s.name].stats;
    const split = o.split || null;
    out.strategies[s.name] = {
      base: s.variantParams ? (o.variants.find((v) => v.name === s.name) || {}).base : s.name, params: hosts[s.name].p, ph: hosts[s.name].ph, ideas, unfilled: sims[s.name].unfilled,
      all: summarize(trades), cost15: summarize(trades, { costMult: 1.5 }), cost2: summarize(trades, { costMult: 2 }),
      train: split ? summarize(trades.filter((t) => t.entryT < split)) : null, test: split ? summarize(trades.filter((t) => t.entryT >= split)) : null,
      test15: split ? summarize(trades.filter((t) => t.entryT >= split), { costMult: 1.5 }) : null,
      ...breakdown(trades), trades,
    };
  }
  return out;
}

function report(r) {
  const L = [`# Swarm backtest`, '', `Data ${r.data.from.slice(0, 10)} → ${r.data.to.slice(0, 10)}, ${r.data.coins} coins; trades counted from ${r.evalFrom.slice(0, 10)}. Costs: maker ${r.costs.makerBps} bps, taker ${r.costs.takerBps} bps, slippage ${r.costs.slipBps} bps per taker side, funding charged.`, ''];
  L.push('| Strategy | Trades | Per day | Win rate | Avg net bps | Avg R | t-stat | PF | Max DD (R) | Sharpe | Avg R at 1.5× costs | Thirds (sum R) | Test: n / avg R / t |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, v] of Object.entries(r.strategies)) {
    const a = v.all;
    if (!a.n) { L.push(`| ${k} | 0 | | | | | | | | | | | |`); continue; }
    const te = v.test && v.test.n ? `${v.test.n} / ${v.test.avgR} / ${v.test.tStat}` : '—';
    L.push(`| ${k} | ${a.n} | ${a.perDay} | ${(a.winRate * 100).toFixed(0)}% | ${a.avgNetBps} | ${a.avgR} | ${a.tStat} | ${a.pf} | ${a.maxDDR} | ${a.sharpe} | ${v.cost15.avgR} | ${v.thirds.map((x) => (x.n ? x.sumR : 0)).join(' / ')} | ${te} |`);
  }
  return L.join('\n') + '\n';
}

async function main() {
  const A = {}; const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) A[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const r = await backtest({
    data: path.resolve(A.data), strategies: A.strategies ? A.strategies.split(',') : null, coins: A.coins ? A.coins.split(',') : null,
    from: A.from ? Date.parse(A.from) : null, to: A.to ? Date.parse(A.to) : null, warmupDays: A['warmup-days'] == null ? 21 : +A['warmup-days'],
    slip: A.slip == null ? undefined : +A.slip, params: A.params ? JSON.parse(A.params) : {}, progress: (m, n) => console.error(`month ${m} done, ${n} minutes`),
    variants: A.variants ? JSON.parse(fs.readFileSync(A.variants, 'utf8')) : null, split: A.split ? Date.parse(A.split) : null,
  });
  const out = path.resolve(A.out || 'swarm-backtest');
  fs.mkdirSync(out, { recursive: true });
  const slim = JSON.parse(JSON.stringify(r)); for (const v of Object.values(slim.strategies)) delete v.trades;
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(slim, null, 1));
  for (const [k, v] of Object.entries(r.strategies)) {
    const cols = ['id', 'coin', 'tf', 'side', 'entryT', 'exitT', 'entry', 'exit', 'entryKind', 'exitKind', 'reason', 'riskBps', 'grossBps', 'feeBps', 'slipBps', 'fundBps', 'netBps', 'r'];
    fs.writeFileSync(path.join(out, `trades-${k}.csv`), cols.join(',') + '\n' + v.trades.map((t) => cols.map((c) => t[c]).join(',')).join('\n') + '\n');
  }
  const md = report(r); fs.writeFileSync(path.join(out, 'report.md'), md); console.log(md);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { backtest, report, readCsvGz };
