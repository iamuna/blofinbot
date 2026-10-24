#!/usr/bin/env node
/* Sub-hour backtest harness (2026-10-24 deep review, docs/DEEP_REVIEW_2026-10-24.md): what tools/hourly_backtest.js does for 1h–1d, for 5–45m.
 * Same live code path as swarm/tools/hourly_backtest.js: FeatureState → RegimeState (15m events) → StrategyHost → ExecSim.
 *   --mode 5m : research-data <coin>/5m.csv.gz; 5/15/30/45/60… bars built from the 5m bars (ExecSim fed 5m bars)
 *   --mode 1m : swarm-data <coin>/1m-YYYY-MM.csv.gz + oi + funding through fsx.onBar1m (exactly the live path)
 * Coins run one after another, so plugins that use cross-coin features (leader-follow) are not supported.
 * variants: [{name, base, params}]; base 'orb-chase' = orb-retest's break taken at the close (the no-retest baseline).
 * Writes <out>/results.json (all / IS / OOS / 1.5x costs / long / short, with grossR = avg R before costs) and trades-<name>.csv.
 *   node swarm/tools/subhour_backtest.js --mode 5m --data <dir> --variants v.json --out dir [--coins A,B] [--from d] [--to d] [--split d] [--warmup-days 30]
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const A = {}; { const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) A[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
const R = (p) => require(path.join(__dirname, '..', p));
const { FeatureState } = R('src/analysis/features');
const { RegimeState } = R('src/analysis/regime');
const { StrategyHost } = R('src/strategies/kit');
const strategies = R('src/strategies');
const { ExecSim } = R('src/backtest/exec_sim');
const { summarize } = R('src/backtest/stats');

const MIN = 60000, DAY = 86400000, TFS5 = [5, 15, 30, 45, 60, 120, 240, 720, 1440];
function readCsvGz(file) {
  if (!fs.existsSync(file)) return [];
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').replace(/\r/g, '').split('\n');
  const hdr = lines[0].split(','), rows = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const r = lines[i].split(','); const o = {}; for (let k = 0; k < hdr.length; k++) o[hdr[k]] = +r[k]; rows.push(o); }
  return rows;
}

// orb-chase: orb-retest's break, but a taker entry at the breakout close instead of the retest limit (the baseline the
// video argues against); same stop, same R multiple
function chaseOf(orb) {
  return { name: 'orb-chase', version: 1, tfs: [5], params: orb.params, onClose: orb.onClose,
    onBar(ev, api) {
      const i = orb.onBar(ev, api); if (!i) return null;
      const c = ev.bar.c, risk = i.side * (c - i.stop);
      if (!(risk > 0)) { api.state(ev.coin).pending = false; return null; }
      return Object.assign({}, i, { entry: { kind: 'taker', px: c }, target: c + i.side * api.p.tgtR * risk, why: i.why + ' [chase]' });
    } };
}
const pluginOf = (base) => (base === 'orb-chase' ? chaseOf(strategies.byName['orb-retest']) : strategies.byName[base]);

const variants = JSON.parse(fs.readFileSync(A.variants, 'utf8'));
const from = A.from ? Date.parse(A.from) : 0, to = A.to ? Date.parse(A.to) : Infinity, split = A.split ? Date.parse(A.split) : null;
const warmDays = A['warmup-days'] == null ? 30 : +A['warmup-days'];
const data = path.resolve(A.data);
let coins = A.coins ? A.coins.split(',') : fs.readdirSync(data).filter((c) => fs.statSync(path.join(data, c)).isDirectory()).sort();
if (A.mode === '5m') coins = coins.filter((c) => fs.existsSync(path.join(data, c, '5m.csv.gz')));

const funding = {}, sims = {}, hosts = {}, trades = {};
for (const v of variants) trades[v.name] = [];
for (const coin of coins) {
  // fresh state per coin keeps memory flat; every plugin keys its state by coin anyway
  const fsx = new FeatureState(A.mode === '5m' ? { tfs: TFS5, keep: 1000 } : { keep: 1000 }), regime = new RegimeState();
  for (const v of variants) {
    sims[v.name] = new ExecSim({ funding, onClose: (idea, res) => hosts[v.name].onClose(idea.coin, idea.id, res) });
    hosts[v.name] = new StrategyHost(pluginOf(v.base), { name: v.name, fs: fsx, regime, params: v.params || {} });
  }
  funding[coin] = readCsvGz(path.join(data, coin, 'funding.csv.gz')).map((r) => [r.t, r.rate]);
  let F = funding[coin], fp = 0, n = 0;
  const step = (b, evs) => { for (const ev of evs) regime.onEvent(ev); for (const ev of evs) for (const v of variants) for (const idea of hosts[v.name].onEvent(ev)) sims[v.name].submit(idea); };
  const ctx = (t) => { while (fp < F.length && F[fp][0] <= t + MIN) { fsx.onFunding(coin, F[fp][1], null); fp++; } };
  if (A.mode === '5m') {
    const s = fsx.coin(coin), cur = new Map();
    for (const b0 of readCsvGz(path.join(data, coin, '5m.csv.gz'))) {
      if (b0.t < from || b0.t >= to) continue;
      const b = { t: b0.t, o: b0.o, h: b0.h, l: b0.l, c: b0.c, v: b0.v || 0, q: b0.qv || 0, bq: b0.tbv != null && b0.v > 0 ? (b0.tbv / b0.v) * (b0.qv || 0) : null, n: b0.n || 0 };
      ctx(b.t);
      for (const v of variants) sims[v.name].onBar(coin, b);
      fsx.context(coin).last = b.c;
      const evs = [];
      for (const tf of TFS5) {
        const st = s.tf.get(tf), span = tf * MIN, bucket = Math.floor(b.t / span) * span;
        let c = cur.get(tf);
        if (c && c.t !== bucket) { evs.push(fsx.close(coin, st, c, true)); c = null; }
        if (!c) { c = { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: 0, q: 0, bq: b.bq == null ? null : 0, n: 0 }; cur.set(tf, c); }
        c.h = Math.max(c.h, b.h); c.l = Math.min(c.l, b.l); c.c = b.c; c.v += b.v; c.q += b.q; c.n += b.n;
        if (c.bq != null) c.bq = b.bq == null ? null : c.bq + b.bq;
        if (b.t + 5 * MIN === bucket + span) { evs.push(fsx.close(coin, st, c, false)); cur.set(tf, null); }
      }
      step(b, evs); n++;
    }
  } else {
    const months = fs.readdirSync(path.join(data, coin)).filter((f) => /^1m-\d{4}-\d{2}\.csv\.gz$/.test(f)).sort();
    let O = [], op = 0;
    for (const m of months) {
      O = O.slice(op).concat(readCsvGz(path.join(data, coin, m.replace('1m-', 'oi-')))); op = 0;
      for (const b of readCsvGz(path.join(data, coin, m))) {
        if (b.t < from || b.t >= to) continue;
        ctx(b.t);
        while (op < O.length && O[op].t <= b.t + MIN) { fsx.onOI(coin, O[op].t, O[op].oi, O[op].oiQ); op++; }
        for (const v of variants) sims[v.name].onBar(coin, b);
        step(b, fsx.onBar1m(coin, b)); n++;
      }
    }
  }
  for (const v of variants) trades[v.name].push(...sims[v.name].trades);
  console.error(`${coin}: ${n} bars; ` + variants.map((v) => `${v.name} ${sims[v.name].trades.length}`).join(', '));
}

// first bar of the data + warm-up = when trades start to count
const firstT = from || Math.min(...Object.values(trades).flat().map((t) => t.entryT).concat([Infinity]));
const warm = (from || firstT) + warmDays * DAY;
const grossR = (ts) => (ts.length ? +(ts.reduce((a, t) => a + t.grossBps / t.riskBps, 0) / ts.length).toFixed(4) : null);
const sm = (ts, m) => { const s = summarize(ts, { costMult: m || 1 }); if (s.n) s.grossR = grossR(ts); return s; };
const out = { generated: new Date().toISOString(), mode: A.mode, data, coins, from: new Date(warm).toISOString(), split: split && new Date(split).toISOString(), variants: {} };
const cols = ['coin', 'side', 't', 'entryT', 'exitT', 'entry', 'exit', 'entryKind', 'reason', 'riskBps', 'grossBps', 'feeBps', 'slipBps', 'fundBps', 'netBps', 'r', 'why'];
fs.mkdirSync(path.resolve(A.out), { recursive: true });
for (const v of variants) {
  const ts = trades[v.name].filter((t) => t.entryT >= warm);
  const is = split ? ts.filter((t) => t.entryT < split) : null, oos = split ? ts.filter((t) => t.entryT >= split) : null;
  out.variants[v.name] = { base: v.base, params: v.params || {}, all: sm(ts), cost15: sm(ts, 1.5), is: is && sm(is), oos: oos && sm(oos), long: sm(ts.filter((t) => t.side > 0)), short: sm(ts.filter((t) => t.side < 0)) };
  fs.writeFileSync(path.join(path.resolve(A.out), `trades-${v.name}.csv`), cols.join(',') + '\n' + ts.map((t) => cols.map((c) => (c === 'why' ? JSON.stringify(t.why || '') : t[c])).join(',')).join('\n') + '\n');
}
fs.writeFileSync(path.join(path.resolve(A.out), 'results.json'), JSON.stringify(out, null, 1));
const f = (s) => (s && s.n ? `${s.n} tr ${s.avgR >= 0 ? '+' : ''}${s.avgR}R gross ${s.grossR >= 0 ? '+' : ''}${s.grossR} tDay ${s.tDay}` : '0 tr');
for (const [k, v] of Object.entries(out.variants)) console.log(`${k.padEnd(20)} ALL ${f(v.all)} | IS ${f(v.is)} | OOS ${f(v.oos)} | 1.5x ${v.cost15.n ? v.cost15.avgR : '-'}`);
