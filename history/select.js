#!/usr/bin/env node
/* Walk-forward selection over the sweep: "trade only the highest return-per-risk combinations", judged honestly.
 *
 *   node history/select.js --in <sweep dir> --out <dir> [--from 2021-10-01] [--to 2026-09-30]
 *
 * Every quarter: rank every (strategy, timeframe) variant by the Sharpe ratio of its daily R over the previous
 * 12 months (eligible: ≥ 30 trades, positive even at 1.5× costs), take the top 5, and trade them for the next
 * quarter — which the ranking never saw. The stitched quarters are the result. Declared before looking at the
 * data: 12-month window, top 5, quarterly. Other settings are shown only as a robustness check.
 * Also shown: each variant's full-period numbers, the best in hindsight (what you would believe if you picked the
 * winner after the fact — the gap to the walk-forward is luck), and every variant traded together.
 * R: profit in units of the amount risked (at least 10 bps); daily R sums all trades closing that day. % figures:
 * the R series scaled so its worst drawdown is 20% of the account, no compounding.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const DAY = 86400000, DD_PCT = 20;
function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }
const ymd = (t) => new Date(t).toISOString().slice(0, 10);

function load(dir) {
  const V = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => /^trades-\d+\.jsonl\.gz$/.test(x))) {
    for (const line of zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8').split('\n')) {
      if (!line) continue;
      const x = JSON.parse(line);
      let v = V.get(x.name);
      if (!v) V.set(x.name, (v = { name: x.name, group: x.group, base: x.base, tf: x.tf, params: x.params, daily: {} }));
      for (const [d, a] of Object.entries(x.daily)) { const y = (v.daily[d] = v.daily[d] || [0, 0, 0, 0, 0, 0]); for (let k = 0; k < 6; k++) y[k] += a[k] || 0; }
    }
  }
  return [...V.values()];
}

// statistics of daily series over day indexes [a, b)
function stats(v, a, b) {
  let n = 0, sum = 0, sum15 = 0, s2 = 0, eq = 0, peak = 0, dd = 0;
  for (let i = a; i < b; i++) { const r = v.R[i]; n += v.N[i]; sum += r; sum15 += v.R15[i]; s2 += r * r; eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const days = b - a, mean = sum / days, sd = Math.sqrt(Math.max(0, s2 / days - mean * mean));
  return { n, sumR: +sum.toFixed(2), sumR15: +sum15.toFixed(2), avgR: n ? +(sum / n).toFixed(4) : null, sharpe: sd > 0 ? +(mean / sd * Math.sqrt(365)).toFixed(2) : 0, t: sd > 0 ? +(mean / sd * Math.sqrt(days)).toFixed(2) : 0, maxDD: +dd.toFixed(2), days };
}
function seriesStats(R, a, b) { return stats({ R, R15: R, N: R.map(() => 0) }, a, b); }

function walkForward(V, days, o) {
  const qStarts = []; // calendar quarters with a full training window behind them
  for (let i = 0; i < days.length; i++) { const d = days[i]; if (/-(01|04|07|10)-01$/.test(d) && i >= o.train) qStarts.push(i); }
  const R = new Array(days.length).fill(0), picksLog = [];
  for (let q = 0; q < qStarts.length; q++) {
    const s = qStarts[q], e = q + 1 < qStarts.length ? qStarts[q + 1] : days.length;
    const ranked = V.map((v) => ({ v, st: stats(v, s - o.train, s) })).filter((x) => x.st.n >= o.minTrades && x.st.sumR15 > 0 && x.st.sharpe > 0).sort((a, b) => b.st.sharpe - a.st.sharpe).slice(0, o.k);
    for (const { v } of ranked) for (let i = s; i < e; i++) R[i] += v.R[i];
    const oos = ranked.map(({ v }) => stats(v, s, e));
    picksLog.push({ quarter: days[s], picks: ranked.map(({ v, st }, j) => ({ name: v.name, trainSharpe: st.sharpe, trainN: st.n, oosR: oos[j].sumR, oosN: oos[j].n })), oosR: +oos.reduce((x, y) => x + y.sumR, 0).toFixed(2) });
  }
  const from = qStarts[0];
  return { from: days[from], R, st: seriesStats(R, from, days.length), picksLog, fromIdx: from };
}

function main() {
  const A = args(), out = path.resolve(A.out || 'select-out');
  fs.mkdirSync(out, { recursive: true });
  const V = load(path.resolve(A.in));
  const from = A.from || '2021-10-01', to = A.to || '2026-09-30', days = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY) days.push(ymd(t));
  for (const v of V) {
    v.R = days.map((d) => (v.daily[d] ? v.daily[d][0] : 0)); v.R15 = days.map((d) => (v.daily[d] ? v.daily[d][1] : 0)); v.N = days.map((d) => (v.daily[d] ? v.daily[d][2] : 0)); v.RL = days.map((d) => (v.daily[d] ? v.daily[d][4] : 0)); v.NL = days.map((d) => (v.daily[d] ? v.daily[d][5] : 0));
    v.full = stats(v, 0, days.length);
    v.years = {}; for (const y of [...new Set(days.map((d) => d.slice(0, 4)))]) { const a = days.findIndex((d) => d.startsWith(y)), b = days.length - [...days].reverse().findIndex((d) => d.startsWith(y)); v.years[y] = stats(v, a, b).sumR; }
  }
  const primary = walkForward(V, days, { train: 365, k: 5, minTrades: 30 });
  if (!primary.picksLog.length) { console.error('not enough history for a 12-month window'); process.exit(1); }
  const robust = [];
  for (const train of [182, 365, 730]) for (const k of [3, 5, 10]) { const w = walkForward(V, days, { train, k, minTrades: 30 }); robust.push({ train, k, from: w.from, ...w.st }); }
  // the same period for the comparisons
  const a = primary.fromIdx, b = days.length;
  const hind = V.map((v) => ({ v, st: stats(v, a, b) })).filter((x) => x.st.n >= 100).sort((x, y) => y.st.sharpe - x.st.sharpe);
  const hind5 = new Array(days.length).fill(0); for (const { v } of hind.slice(0, 5)) for (let i = 0; i < days.length; i++) hind5[i] += v.R[i];
  const allR = new Array(days.length).fill(0); for (const v of V) for (let i = 0; i < days.length; i++) allR[i] += v.R[i] / V.length * 5;
  // walk-forward by year, timeframe use
  const wfYears = {}; for (const y of [...new Set(days.slice(a).map((d) => d.slice(0, 4)))]) { const i0 = Math.max(a, days.findIndex((d) => d.startsWith(y))), i1 = days.length - [...days].reverse().findIndex((d) => d.startsWith(y)); wfYears[y] = seriesStats(primary.R, i0, i1); }
  const tfUse = {}; for (const q of primary.picksLog) for (const p of q.picks) { const tf = V.find((v) => v.name === p.name).tf; tfUse[tf] = (tfUse[tf] || 0) + 1; }
  // group × timeframe grid of full-period Sharpe and avg R
  const groups = [...new Set(V.map((v) => v.group === 'native' ? v.name.split('@')[0] : v.group))], frames = [...new Set(V.map((v) => v.tf))].sort((x, y) => x - y);
  const cell = (g, tf) => V.find((v) => (v.group === 'native' ? v.name.split('@')[0] : v.group) === g && v.tf === tf);
  const fmtTf = (tf) => (tf >= 1440 ? `${tf / 1440}d` : tf >= 60 ? `${tf / 60}h` : `${tf}m`);
  const scale = primary.st.maxDD > 0 ? DD_PCT / primary.st.maxDD : 0; // % per R, sized so the walk-forward's worst drawdown is 20%
  const pct = (r) => `${r >= 0 ? '+' : ''}${(r * scale).toFixed(1)}%`;
  const years = (days.length - primary.fromIdx) / 365;

  const L = [`# 5-year sweep: every strategy × every timeframe, walk-forward selection`, '',
    `Data ${days[0]} → ${days[days.length - 1]}, point-in-time universe (Binance USD-M, 7-day volume ≥ $20M, ≤ 80 coins), live code path and costs (maker 2 bps, taker 6 bps + 1.5 bps slippage, funding). ${V.length} variants. R = profit in units of the amount risked (at least 10 bps). % = sized so the walk-forward's worst drawdown is ${DD_PCT}% of the account, no compounding.`, '',
    `## The honest result: walk-forward (12-month window, top 5, re-picked every quarter)`, '',
    `Out-of-sample ${primary.from} → ${days[days.length - 1]}: **${primary.st.sumR} R, Sharpe ${primary.st.sharpe}, t ${primary.st.t}**, max drawdown ${primary.st.maxDD} R. Sized for a ${DD_PCT}% worst drawdown: **${pct(primary.st.sumR)} in ${years.toFixed(1)} years** (≈ ${(primary.st.sumR * scale / years).toFixed(1)}% a year).`, '',
    '| Year | R | % | Sharpe | Max DD (R) |', '|---|---|---|---|---|',
    ...Object.entries(wfYears).map(([y, s]) => `| ${y} | ${s.sumR} | ${pct(s.sumR)} | ${s.sharpe} | ${s.maxDD} |`), '',
    `Compare over the same period: the best 5 in hindsight ${seriesStats(hind5, a, b).sumR} R (Sharpe ${seriesStats(hind5, a, b).sharpe}) — the gap is luck; all ${V.length} variants together (scaled to 5 slots) ${seriesStats(allR, a, b).sumR} R (Sharpe ${seriesStats(allR, a, b).sharpe}).`, '',
    `Timeframes picked (quarter-slots): ${Object.entries(tfUse).sort((x, y) => +x[0] - +y[0]).map(([tf, n]) => `${fmtTf(+tf)} ${n}`).join(', ')}`, '',
    '### Robustness (other windows and pick counts — not chosen after the fact)', '', '| Window | Top | From | R | Sharpe | Max DD | t |', '|---|---|---|---|---|---|---|',
    ...robust.map((r) => `| ${Math.round(r.train / 30.4)} months | ${r.k} | ${r.from} | ${r.sumR} | ${r.sharpe} | ${r.maxDD} | ${r.t} |`), '',
    '### Picks per quarter (out-of-sample R in brackets)', '', ...primary.picksLog.map((q) => `- ${q.quarter}: ${q.picks.map((p) => `${p.name} (${p.oosR})`).join(', ') || 'nothing eligible'} → ${q.oosR} R`), '',
    `## Every strategy on every timeframe (full period, Sharpe of daily R / average R per trade)`, '',
    `| Strategy | ${frames.map(fmtTf).join(' | ')} |`, `|---|${frames.map(() => '---').join('|')}|`,
    ...groups.map((g) => `| ${g} | ${frames.map((tf) => { const v = cell(g, tf); return v ? (v.full.n ? `${v.full.sharpe} / ${v.full.avgR} (${v.full.n})` : '0 trades') : ''; }).join(' | ')} |`), '',
    '## Best 15 in hindsight (same out-of-sample period; for reference, not a result)', '', '| Variant | Trades | Avg R | Sum R | Sum R at 1.5× costs | Long / short R | Sharpe | Max DD | By year |', '|---|---|---|---|---|---|---|---|---|',
    ...hind.slice(0, 15).map(({ v, st }) => `| ${v.name} | ${st.n} | ${st.avgR} | ${st.sumR} | ${st.sumR15} | ${(() => { let l = 0; for (let i = a; i < b; i++) l += v.RL[i]; return `${l.toFixed(0)} / ${(st.sumR - l).toFixed(0)}`; })()} | ${st.sharpe} | ${st.maxDD} | ${Object.entries(v.years).map(([y, r]) => `${y}: ${r.toFixed(0)}`).join(', ')} |`), ''];
  fs.writeFileSync(path.join(out, 'REPORT.md'), L.join('\n'));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ generated: new Date().toISOString(), days: [days[0], days[days.length - 1]], primary: { from: primary.from, ...primary.st, years: wfYears, picks: primary.picksLog, timeframes: tfUse }, robust,
    variants: V.map((v) => ({ name: v.name, group: v.group, base: v.base, tf: v.tf, params: v.params, full: v.full, years: v.years })) }, null, 1));
  console.log(L.slice(0, 16).join('\n'));
}

main();
