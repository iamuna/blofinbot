#!/usr/bin/env node
/* Event study: does a strategy's signal point the right way at all? Runs plugins over the swarm dataset with the live
 * code path (1-minute bars → FeatureState → RegimeState → StrategyHost, as backtest/run.js) but, instead of trading
 * each idea, measures what price did next (research/excursions.js) and tags the conditions it was given in
 * (research/trade_tags.js). No fills, no costs: this is the cheap screen BEFORE a backtest, from the 1-minute bot's
 * outcome-label idea. A family whose edge (MFE ÷ |MAE|) stays near 1 and whose forward R does not beat the cost line
 * has nothing for parameters, stops or exits to work with (docs/DEEP_REVIEW_2026-10-23.md) — skip the backtest.
 *
 *   node swarm/src/research/event_study.js --data <swarm-data dir> [--strategies a,b | --variants file.json]
 *        [--coins BTC,ETH] [--from 2026-06-01] [--to …] [--horizons 1,3,6,12,24,48] [--tag-horizon 12] [--out dir]
 * --variants: [{name, base, params}] as backtest/run.js. Writes <out>/study.json and <out>/study.md.
 * One idea per coin at a time per strategy (as live): the next can come once the last horizon has passed.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { FeatureState } = require('../analysis/features');
const { RegimeState } = require('../analysis/regime');
const { StrategyHost } = require('../strategies/kit');
const strategies = require('../strategies');
const { readCsvGz } = require('../backtest/run');
const { ExcursionTracker, summarize } = require('./excursions');
const { contextTags, outcomeTags, lift } = require('./trade_tags');

const MIN = 60000, DAY = 86400000;

async function eventStudy(o) {
  const man = JSON.parse(fs.readFileSync(path.join(o.data, 'manifest.json'), 'utf8'));
  let coins = Object.entries(man.coins).filter(([, v]) => v.status === 'ok').map(([k]) => k);
  if (o.coins) coins = coins.filter((c) => o.coins.includes(c));
  coins.sort((a, b) => (a === 'BTC' ? -1 : b === 'BTC' ? 1 : a.localeCompare(b)));
  const months = [...new Set([...man.months, ...(man.currentMonthDays || []).map((d) => d.slice(0, 7))])].sort();
  const plugins = o.variants ? o.variants.map((v) => Object.assign({}, strategies.byName[v.base], { name: v.name, variantParams: v.params || {} }))
    : (o.strategies ? o.strategies.map((n) => strategies.byName[n]).filter(Boolean) : strategies.all);
  const fsx = new FeatureState(), regime = new RegimeState(), hosts = {}, trackers = {};
  const evalFrom = o.from || null, evalTo = o.to || Infinity;
  for (const s of plugins) {
    hosts[s.name] = new StrategyHost(s, { fs: fsx, regime, params: Object.assign({}, s.variantParams, (o.params || {})[s.name]) });
    trackers[s.name] = new ExcursionTracker({ horizons: o.horizons, onDone: (idea, rec, endT) => hosts[s.name].onClose(idea.coin, idea.id, { outcome: 'study', r: 0, netBps: 0, exitT: endT }) });
  }
  const funding = {}, fptr = {}, oi = {}, optr = {};
  for (const c of coins) { funding[c] = (readCsvGz(path.join(o.data, c, 'funding.csv.gz')) || []).map((r) => [r.t, r.rate]); fptr[c] = 0; oi[c] = []; optr[c] = 0; }
  let firstT = null, lastT = 0, minutes = 0;
  for (const m of months) {
    const data = {};
    for (const c of coins) {
      const bars = readCsvGz(path.join(o.data, c, `1m-${m}.csv.gz`)); if (bars) data[c] = { bars, i: 0 };
      oi[c] = oi[c].slice(optr[c]).concat(readCsvGz(path.join(o.data, c, `oi-${m}.csv.gz`)) || []); optr[c] = 0;
    }
    const ts = new Set(); for (const c in data) for (const b of data[c].bars) ts.add(b.t);
    for (const t of [...ts].sort((a, b) => a - b)) {
      if (t > evalTo) break;
      if (firstT == null) firstT = t;
      lastT = t; minutes++;
      const counting = t >= (evalFrom || firstT + (o.warmupDays == null ? 21 : o.warmupDays) * DAY);
      for (const c of coins) {
        const d = data[c]; if (!d) continue;
        while (d.i < d.bars.length && d.bars[d.i].t < t) d.i++;
        const b = d.bars[d.i]; if (!b || b.t !== t) continue;
        const close = t + MIN, F = funding[c], O = oi[c];
        while (fptr[c] < F.length && F[fptr[c]][0] <= close) { fsx.onFunding(c, F[fptr[c]][1], null); fptr[c]++; }
        while (optr[c] < O.length && O[optr[c]].t <= close) { const r = O[optr[c]]; fsx.onOI(c, r.t, r.oi, r.oiQ); optr[c]++; }
        for (const s of plugins) trackers[s.name].onBar(c, b);
        const evs = fsx.onBar1m(c, b);
        for (const ev of evs) regime.onEvent(ev);
        for (const ev of evs) for (const s of plugins) for (const idea of hosts[s.name].onEvent(ev)) {
          if (!counting) { hosts[s.name].onClose(idea.coin, idea.id, { outcome: 'warm-up', r: 0, netBps: 0, exitT: idea.t }); continue; }
          trackers[s.name].add(idea, { regime: regime.get(idea.coin, idea.t), f: ev.f });
        }
      }
    }
    if (o.progress) o.progress(m, minutes);
  }
  const tagH = o.tagHorizon || 12, out = { generated: new Date().toISOString(), data: { from: firstT && new Date(firstT).toISOString(), to: lastT && new Date(lastT).toISOString(), coins: coins.length, minutes }, tagHorizon: tagH, strategies: {} };
  for (const s of plugins) {
    const recs = trackers[s.name].done, sum = summarize(recs, o);
    const items = recs.map((r) => { const row = r.rows.find((x) => x.h === tagH) || r.rows[r.rows.length - 1]; return { tags: contextTags(r, r.ctx).concat(outcomeTags(r)), r: row ? row.fwdR : 0 }; });
    out.strategies[s.name] = { params: hosts[s.name].p, ideas: hosts[s.name].stats, summary: sum, tags: recs.length ? lift(items, { minN: o.minN || 20 }) : {}, records: o.keepRecords ? recs.map((r) => Object.assign({}, r, { ctx: undefined })) : undefined };
  }
  return out;
}

function report(r) {
  const L = ['# Event study', '', `Data ${String(r.data.from).slice(0, 10)} → ${String(r.data.to).slice(0, 10)}, ${r.data.coins} coins. Price after each idea, in R (the idea's own stop distance), before fills and costs. edge = average MFE ÷ |average MAE| (≈ 1: no direction). cost = a maker-in, taker-out round trip in R: forward R must clear it.`, ''];
  for (const [k, v] of Object.entries(r.strategies)) {
    const s = v.summary;
    L.push(`## ${k}`, '');
    if (!s.n) { L.push('No ideas.', ''); continue; }
    L.push(`${s.n} ideas · cost ≈ ${s.costR} R · +1 R before −1 R in ${s.plusFirst == null ? '—' : (s.plusFirst * 100).toFixed(0) + '%'} of ${s.decided} decided`, '');
    L.push('| Bars after | n | Forward R | t | MFE R | MAE R | edge |', '|---|---|---|---|---|---|---|');
    for (const h of s.horizons) L.push(`| ${h.h} | ${h.n} | ${h.fwdR} | ${h.t} | ${h.mfeR} | ${h.maeR} | ${h.edge} |`);
    const tags = Object.entries(v.tags).filter(([, x]) => x.lift != null);
    if (tags.length) {
      L.push('', `Conditions at the signal (forward R at ${r.tagHorizon} bars, with vs without the tag):`, '', '| Tag | n | avg R | without | lift | t |', '|---|---|---|---|---|---|');
      for (const [t, x] of tags.sort((a, b) => b[1].lift - a[1].lift)) L.push(`| ${t} | ${x.n} | ${x.avgR} | ${x.avgROut} | ${x.lift} | ${x.t} |`);
    }
    L.push('');
  }
  return L.join('\n');
}

async function main() {
  const A = {}, argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) A[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const r = await eventStudy({
    data: path.resolve(A.data), strategies: A.strategies ? A.strategies.split(',') : null, coins: A.coins ? A.coins.split(',') : null,
    variants: A.variants ? JSON.parse(fs.readFileSync(A.variants, 'utf8')) : null, from: A.from ? Date.parse(A.from) : null, to: A.to ? Date.parse(A.to) : null,
    warmupDays: A['warmup-days'] == null ? 21 : +A['warmup-days'], horizons: A.horizons ? String(A.horizons).split(',').map(Number) : undefined,
    tagHorizon: A['tag-horizon'] ? +A['tag-horizon'] : 12, params: A.params ? JSON.parse(A.params) : {}, progress: (m, n) => console.error(`month ${m} done, ${n} minutes`),
  });
  const out = path.resolve(A.out || 'swarm-study'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'study.json'), JSON.stringify(r, null, 1));
  const md = report(r); fs.writeFileSync(path.join(out, 'study.md'), md); console.log(md);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { eventStudy, report };
