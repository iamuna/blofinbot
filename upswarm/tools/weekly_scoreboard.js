#!/usr/bin/env node
/* Weekly scoreboard: how often does a return stream make money per week, month and quarter, and how bad is the worst
 * week? Answers "can the swarm make +R every week?" with numbers instead of hope.
 *
 *   node upswarm/tools/weekly_scoreboard.js --sleeve <path to swarm/ of branch swarm-fix/sleeve-trade>
 *        --research <research-data dir> [--validation <validation-data dir>] [--out file.md]
 *   node upswarm/tools/weekly_scoreboard.js --trades <trades.json from trades_run.js> --names a,b,c [--risk 0.0025]
 *   node upswarm/tools/weekly_scoreboard.js --live <swarm-state dir>      (the PC's paper account, for the daily review)
 *
 * Mode 1 runs the trend sleeve (as configured, under config/risk.json) from 2020-01-01 on the hourly history and
 * scores its daily returns. Mode 2 builds a daily R series from closed trades (each trade booked on its exit day, each
 * risking --risk of equity) and scores that. Mode 3 (--live) books each closed paper trade's net USD on its exit day as a
 * share of the starting equity, scores it, and lists the weeks so far with the week-to-date result.
 * Also prints what theory says: with an annual Sharpe S, a week is positive with probability Φ(S/√52) (normal returns).
 */
'use strict';
const fs = require('fs'), path = require('path');

const DAY = 86400;
function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }

// Φ (normal CDF), Abramowitz–Stegun 26.2.17
function phi(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }

// daily: [[utcDayIndex, return], …] → buckets by ISO-like week (Monday start), month, quarter
function score(daily) {
  const sorted = daily.slice().sort((a, b) => a[0] - b[0]);
  const week = (d) => Math.floor((d + 3) / 7); // day 0 = Thu 1970-01-01 → Monday-based weeks
  const month = (d) => new Date(d * DAY * 1000).toISOString().slice(0, 7);
  const quarter = (d) => { const x = new Date(d * DAY * 1000); return `${x.getUTCFullYear()}Q${Math.floor(x.getUTCMonth() / 3) + 1}`; };
  const agg = (key) => { const m = new Map(); for (const [d, r] of sorted) { const k = key(d); m.set(k, (m.get(k) || 1) * (1 + r)); } return [...m.values()].map((g) => g - 1); };
  const desc = (xs) => {
    const n = xs.length, pos = xs.filter((x) => x > 0).length, s = xs.slice().sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    let run = 0, worstRun = 0; for (const x of xs) { run = x <= 0 ? run + 1 : 0; worstRun = Math.max(worstRun, run); }
    return { n, posPct: pos / n, mean, worst: s[0], p5: s[Math.floor(0.05 * (n - 1))], median: s[Math.floor(0.5 * (n - 1))], best: s[n - 1], worstRun };
  };
  const dr = sorted.map((x) => x[1]), m = dr.reduce((a, b) => a + b, 0) / dr.length, sd = Math.sqrt(dr.reduce((a, b) => a + (b - m) ** 2, 0) / dr.length);
  const sharpe = sd > 0 ? (m / sd) * Math.sqrt(365) : 0;
  return { days: sorted.length, sharpe, weeks: desc(agg(week)), months: desc(agg(month)), quarters: desc(agg(quarter)) };
}
const pct = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
function table(label, s) {
  const L = [`### ${label}`, '', `${s.days} days, Sharpe ${s.sharpe.toFixed(2)}. Theory (normal returns) for this Sharpe: a positive week ${(100 * phi(s.sharpe / Math.sqrt(52))).toFixed(0)}% of the time, month ${(100 * phi(s.sharpe / Math.sqrt(12))).toFixed(0)}%, quarter ${(100 * phi(s.sharpe / 2)).toFixed(0)}%.`, '',
    '| Period | Count | Positive | Average | Median | Worst | 5th percentile | Best | Longest run without a gain |', '|---|---|---|---|---|---|---|---|---|'];
  for (const [k, v] of [['Week', s.weeks], ['Month', s.months], ['Quarter', s.quarters]]) L.push(`| ${k} | ${v.n} | ${(100 * v.posPct).toFixed(0)}% | ${pct(v.mean, 2)} | ${pct(v.median, 2)} | ${pct(v.worst, 2)} | ${pct(v.p5, 2)} | ${pct(v.best, 2)} | ${v.worstRun} ${k.toLowerCase()}s |`);
  return L.join('\n') + '\n';
}
function theory() {
  const L = ['### What it takes to win most weeks (normal returns, no fat tails)', '', '| Annual Sharpe | Weekly Sharpe | Positive weeks | Positive months | Positive quarters |', '|---|---|---|---|---|'];
  for (const S of [0.5, 1, 1.5, 2, 3, 5, 8, 12]) L.push(`| ${S} | ${(S / Math.sqrt(52)).toFixed(2)} | ${(100 * phi(S / Math.sqrt(52))).toFixed(0)}% | ${(100 * phi(S / Math.sqrt(12))).toFixed(0)}% | ${(100 * phi(S / 2)).toFixed(0)}% |`);
  return L.join('\n') + '\n';
}

function fromTrades(file, names, risk) {
  const T = JSON.parse(fs.readFileSync(file, 'utf8')).trades, days = new Map();
  let first = Infinity, last = -Infinity;
  for (const n of names) for (const t of T[n] || []) { const d = Math.floor(t.exitT / 1000 / DAY); days.set(d, (days.get(d) || 0) + t.r * risk); first = Math.min(first, d); last = Math.max(last, d); }
  const out = []; for (let d = first; d <= last; d++) out.push([d, days.get(d) || 0]);
  return out;
}

function fromLive(dir) {
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), eq0 = (st.account && st.account.equity0) || 10000;
  const T = fs.readFileSync(path.join(dir, 'trades.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((t) => t && Number.isFinite(t.netUsd) && Number.isFinite(t.exitT));
  if (!T.length) return { daily: [], weeks: [] };
  const days = new Map(), wk = new Map(), week = (d) => Math.floor((d + 3) / 7);
  let first = Infinity, last = -Infinity;
  for (const t of T) {
    const d = Math.floor(t.exitT / 1000 / DAY); days.set(d, (days.get(d) || 0) + t.netUsd / eq0); first = Math.min(first, d); last = Math.max(last, d);
    const w = wk.get(week(d)) || { n: 0, usd: 0, r: 0 }; w.n++; w.usd += t.netUsd; w.r += t.r || 0; wk.set(week(d), w);
  }
  const daily = []; for (let d = first; d <= last; d++) daily.push([d, days.get(d) || 0]);
  const weeks = [...wk.entries()].sort((a, b) => a[0] - b[0]).map(([w, v]) => Object.assign({ from: new Date((w * 7 - 3) * DAY * 1000).toISOString().slice(0, 10) }, v));
  return { daily, weeks, eq0 };
}

function main() {
  const A = args(), parts = [theory()];
  if (A.sleeve) {
    const sw = path.resolve(A.sleeve), E = require(path.join(sw, 'src/sleeve/trend_engine')), S = require(path.join(sw, 'src/sleeve/sleeve'));
    const BT = require(path.join(sw, 'tools/trend_sleeve_backtest'));
    const cfg = JSON.parse(fs.readFileSync(path.join(sw, 'config/swarm.json'), 'utf8')), limits = JSON.parse(fs.readFileSync(path.join(sw, 'config/risk.json'), 'utf8'));
    const rules = Object.assign({}, ((cfg.sleeves || {}).trend || {}).rules || {}), START = Date.parse('2020-01-01T00:00:00Z') / 1000;
    const sets = [['research-data (today\'s top 20)', A.research]]; if (A.validation) sets.push(['validation-data (30 other coins, dead ones included)', A.validation]);
    const btcRef = BT.loadCoin(A.research, 'BTC');
    for (const [label, dir] of sets) {
      const coins = BT.universe(dir).map((c) => BT.loadCoin(dir, c)), grid = E.align(coins);
      const sim = E.simulate(grid, { start: START, keepWant: true });
      let ref = grid.coins.find((g) => g.coin === 'BTC');
      if (!ref) { ref = { coin: 'BTC', o: new Float64Array(grid.n).fill(NaN), h: new Float64Array(grid.n).fill(NaN), l: new Float64Array(grid.n).fill(NaN), c: new Float64Array(grid.n).fill(NaN), fund: new Float64Array(grid.n) }; for (let i = 0; i < btcRef.t.length; i++) { const k = Math.round((btcRef.t[i] - grid.t[0]) / E.H); if (k >= 0 && k < grid.n) { ref.o[k] = btcRef.o[i]; ref.h[k] = btcRef.h[i]; ref.l[k] = btcRef.l[i]; ref.c[k] = btcRef.c[i]; } } }
      const r = S.run(grid, sim, Object.assign({}, rules, { limits, from: START, ref }));
      parts.push(table(`Trend sleeve under risk.json — ${label}`, score(r.daily)));
      parts.push(table(`Research engine without the swarm's limits — ${label}`, score(sim.daily)));
      if (A.dump) fs.writeFileSync(`${A.dump}-${label.split(' ')[0]}.json`, JSON.stringify(r.daily));
    }
  }
  if (A.trades) {
    const names = String(A.names).split(','), risk = +(A.risk || 0.0025);
    parts.push(table(`Trades: ${names.join(', ')} at ${(risk * 100).toFixed(2)}% risk each`, score(fromTrades(A.trades, names, risk))));
  }
  if (A.live) {
    const L = fromLive(path.resolve(A.live));
    if (!L.daily.length) parts.push('### Paper account\n\nNo closed paper trades yet.\n');
    else {
      parts.push(table('Paper account (each trade on its exit day, share of the starting equity)', score(L.daily)));
      parts.push(['### Paper account by week (Monday start)', '', '| Week from | Trades | Net | R |', '|---|---|---|---|', ...L.weeks.map((w) => `| ${w.from} | ${w.n} | ${w.usd >= 0 ? '+' : '−'}$${Math.abs(w.usd).toFixed(2)} (${pct(w.usd / L.eq0, 2)}) | ${w.r >= 0 ? '+' : ''}${w.r.toFixed(1)} |`)].join('\n') + '\n');
      parts.push('Judge by the quarter, not the week: even the best-evidenced system here wins fewer than half its weeks (GUIDE §10). A week outside the backtest\'s range is an alarm for the audit; its sign is not.\n');
    }
  }
  const md = parts.join('\n');
  if (A.out) fs.writeFileSync(A.out, md);
  console.log(md);
}
if (require.main === module) main();
module.exports = { score, phi, fromTrades, fromLive };
