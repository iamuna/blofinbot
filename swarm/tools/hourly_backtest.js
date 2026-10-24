#!/usr/bin/env node
/* Hourly backtest harness: the deep review's method (docs/DEEP_REVIEW_2026-10-23.md), kept in the repo this time.
 *
 * Hourly bars (research-data / validation-data branches: <coin>/1h.csv.gz, <coin>/funding.csv.gz) go through the
 * live code path: FeatureState (1h, 2h, 4h, 12h, 1d bars built from the hours in UTC), the regime's hourly bias,
 * StrategyHost and ExecSim (fed one-hour bars). BloFin costs, funding charged. Sub-hour features do not exist here,
 * so the regime's 15-minute state stays 'mixed'.
 *
 *   node swarm/tools/hourly_backtest.js --data <dir> --variants <file.json> [--coins A,B] [--from 2020-01-01]
 *        [--to 2026-11-01] [--split 2024-01-01] [--out dir] [--breakeven 1]
 * variants: [{name, base, params}], base = a plugin name in src/strategies. Writes <out>/results.json (summary per
 * variant: all, before the split, after it, at 1.5× costs; t on daily sums) and <out>/trades-<name>.csv.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { FeatureState } = require('../src/analysis/features');
const { RegimeState } = require('../src/analysis/regime');
const { StrategyHost } = require('../src/strategies/kit');
const strategies = require('../src/strategies');
const { ExecSim } = require('../src/backtest/exec_sim');
const { summarize, netAt } = require('../src/backtest/stats');

const H = 3600000, MIN = 60000, DAY = 86400000, TFS = [60, 120, 240, 720, 1440];

function readCsvGz(file) {
  if (!fs.existsSync(file)) return [];
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').replace(/\r/g, '').split('\n');
  const hdr = lines[0].split(','), rows = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const r = lines[i].split(','); const o = {}; for (let k = 0; k < hdr.length; k++) o[hdr[k]] = +r[k]; rows.push(o); }
  return rows;
}
function coinsIn(dir) { return fs.readdirSync(dir).filter((c) => fs.existsSync(path.join(dir, c, '1h.csv.gz'))).sort((a, b) => (a === 'BTC' ? -1 : b === 'BTC' ? 1 : a.localeCompare(b))); }

// t-stat and Sharpe on daily sums of R (trades opened the same day move together)
function daily(trades, m = 1) {
  if (!trades.length) return { tDaily: null, sharpe: null };
  const days = new Map(); for (const t of trades) { const d = Math.floor(t.exitT / DAY); days.set(d, (days.get(d) || 0) + netAt(t, m) / t.riskBps); }
  const ks = [...days.keys()], first = Math.min(...ks), last = Math.max(...ks), xs = [];
  for (let d = first; d <= last; d++) xs.push(days.get(d) || 0);
  const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  return { tDaily: sd > 0 ? +((mean / sd) * Math.sqrt(n)).toFixed(2) : null, sharpe: sd > 0 ? +((mean / sd) * Math.sqrt(365)).toFixed(2) : null };
}
function sum(trades, m) { const s = summarize(trades, { costMult: m || 1 }); return s.n ? Object.assign(s, daily(trades, m || 1)) : s; }

function run(o) {
  const variants = o.variants.map((v) => {
    const plugin = strategies.byName[v.base || v.name];
    if (!plugin) throw new Error(`unknown plugin ${v.base || v.name}`);
    return { name: v.name, plugin, params: v.params || {}, breakevenR: v.breakevenR };
  });
  const coins = o.coins || coinsIn(o.data);
  const fsx = new FeatureState({ tfs: TFS, keep: o.keep || 1000 }), regime = new RegimeState();
  const funding = {}, sims = {}, hosts = {};
  for (const v of variants) {
    sims[v.name] = new ExecSim({ funding, breakevenR: v.breakevenR == null ? o.breakevenR : v.breakevenR, onClose: (idea, res) => hosts[v.name].onClose(idea.coin, idea.id, res) });
    hosts[v.name] = new StrategyHost(v.plugin, { name: v.name, fs: fsx, regime, params: v.params });
  }
  for (const coin of coins) {
    const bars = readCsvGz(path.join(o.data, coin, '1h.csv.gz')).filter((b) => b.t >= (o.from || 0) && b.t < (o.to || Infinity));
    funding[coin] = readCsvGz(path.join(o.data, coin, 'funding.csv.gz')).map((r) => [r.t, r.rate]);
    const s = fsx.coin(coin), cur = new Map();
    for (const b0 of bars) {
      const b = { t: b0.t, o: b0.o, h: b0.h, l: b0.l, c: b0.c, v: b0.v || 0, q: b0.qv || 0, bq: b0.tbv != null && b0.v > 0 ? (b0.tbv / b0.v) * (b0.qv || 0) : null, n: b0.n || 0 };
      for (const v of variants) sims[v.name].onBar(coin, b);
      regime.onHour(coin, b.t, b.c);
      fsx.context(coin).last = b.c;
      const evs = [];
      for (const tf of TFS) {
        const st = s.tf.get(tf), span = tf * MIN, bucket = Math.floor(b.t / span) * span;
        let c = cur.get(tf);
        if (c && c.t !== bucket) { evs.push(fsx.close(coin, st, c, true)); c = null; } // a missing hour: partial bar
        if (!c) { c = { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: 0, q: 0, bq: b.bq == null ? null : 0, n: 0 }; cur.set(tf, c); }
        c.h = Math.max(c.h, b.h); c.l = Math.min(c.l, b.l); c.c = b.c; c.v += b.v; c.q += b.q; c.n += b.n;
        if (c.bq != null) c.bq = b.bq == null ? null : c.bq + b.bq;
        if (b.t + H === bucket + span) { evs.push(fsx.close(coin, st, c, false)); cur.set(tf, null); }
      }
      for (const ev of evs) for (const v of variants) for (const idea of hosts[v.name].onEvent(ev)) sims[v.name].submit(idea);
    }
    if (o.progress) o.progress(coin, bars.length);
  }
  const warm = (o.from || 0) + (o.warmupDays == null ? 60 : o.warmupDays) * DAY;
  const out = { generated: new Date().toISOString(), data: o.data, coins: coins.length, split: o.split ? new Date(o.split).toISOString() : null, variants: {} };
  for (const v of variants) {
    const trades = sims[v.name].trades.filter((t) => t.entryT >= warm);
    const before = o.split ? trades.filter((t) => t.entryT < o.split) : null, after = o.split ? trades.filter((t) => t.entryT >= o.split) : null;
    const longs = trades.filter((t) => t.side > 0), shorts = trades.filter((t) => t.side < 0);
    out.variants[v.name] = { base: v.plugin.name, params: hosts[v.name].p, ideas: hosts[v.name].stats, unfilled: sims[v.name].unfilled,
      all: sum(trades), cost15: sum(trades, 1.5), before: before && sum(before), after: after && sum(after), long: sum(longs), short: sum(shorts), trades };
  }
  return out;
}

function main() {
  const A = {}; const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) A[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const r = run({ data: path.resolve(A.data), variants: JSON.parse(fs.readFileSync(A.variants, 'utf8')), coins: A.coins ? A.coins.split(',') : null,
    from: A.from ? Date.parse(A.from) : 0, to: A.to ? Date.parse(A.to) : 0, split: A.split ? Date.parse(A.split) : null,
    breakevenR: A.breakeven == null ? null : +A.breakeven, warmupDays: A['warmup-days'] == null ? 60 : +A['warmup-days'],
    progress: A.quiet ? null : (c, n) => console.error(`${c}: ${n} hours`) });
  const out = path.resolve(A.out || 'hourly-backtest');
  fs.mkdirSync(out, { recursive: true });
  const cols = ['coin', 'tf', 'side', 'entryT', 'exitT', 'entry', 'exit', 'reason', 'riskBps', 'grossBps', 'feeBps', 'slipBps', 'fundBps', 'netBps', 'r'];
  for (const [k, v] of Object.entries(r.variants)) {
    if (A.trades) fs.writeFileSync(path.join(out, `trades-${k}.csv`), cols.join(',') + '\n' + v.trades.map((t) => cols.map((c) => t[c]).join(',')).join('\n') + '\n');
    delete v.trades;
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(r, null, 1));
  for (const [k, v] of Object.entries(r.variants)) {
    const f = (s) => (s && s.n ? `${s.n} tr, ${s.avgR >= 0 ? '+' : ''}${s.avgR} R (t ${s.tDaily})` : '0 tr');
    console.log(`${k.padEnd(28)} all ${f(v.all)} | before ${f(v.before)} | after ${f(v.after)} | 1.5x ${v.cost15.n ? v.cost15.avgR : '-'} | L ${f(v.long)} | S ${f(v.short)}`);
  }
}

if (require.main === module) main();
module.exports = { run, readCsvGz };
