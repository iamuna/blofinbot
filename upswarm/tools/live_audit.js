#!/usr/bin/env node
/* Live audit: what the PC's paper account and shadow record really say, with the corrections a short live sample
 * needs. Read-only; works on a checkout of branch swarm-state (and swarm-factory for the backtest column).
 *
 *   node upswarm/tools/live_audit.js --state <swarm-state dir> [--factory <swarm-factory dir>] [--out file.md]
 *
 * 1. Paper account: closed trades by strategy and by side, and the result without the single biggest trade.
 * 2. Shadow record per strategy: average R, the per-trade t-stat (what /status and the gate use), the t-stat with
 *    trades entered in the same hour counted as one (they move together), long vs short, and a direction-adjusted
 *    average: each trade's R minus the average R of every shadow trade on the same side entered the same day. That
 *    takes out "the market fell, so shorts won", which is what a few days of shadow mostly measure.
 * 3. What the ±0.7 average-R rule would do with this record, next to the strategy's backtest.
 */
'use strict';
const fs = require('fs'), path = require('path');

function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
function tOf(xs) { const n = xs.length; if (n < 2) return NaN; const m = mean(xs), sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)); return sd > 0 ? (m / sd) * Math.sqrt(n) : NaN; }
function clustered(trades, keyFn) { const g = new Map(); for (const t of trades) { const k = keyFn(t); g.set(k, (g.get(k) || 0) + t.r); } return { t: tOf([...g.values()]), k: g.size }; }
const f = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—');
const names = (t) => (t.strategies || []).map((s) => (typeof s === 'string' ? s : s.name));

function audit({ state, factory }) {
  const L = [];
  const st = fs.existsSync(path.join(state, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(state, 'state.json'), 'utf8')) : {};
  const trades = jsonl(path.join(state, 'trades.jsonl')), shadow = jsonl(path.join(state, 'shadow.jsonl'));
  const bt = factory && fs.existsSync(path.join(factory, 'latest.json')) ? JSON.parse(fs.readFileSync(path.join(factory, 'latest.json'), 'utf8')).results : {};
  const a = st.account || {};
  L.push(`# Live audit — state of ${st.updatedAt || '?'}`, '');
  L.push(`Account ${String(a.mode || 'paper').toUpperCase()}: equity $${a.equity} (start $${a.equity0}), drawdown ${a.dd != null ? (a.dd * 100).toFixed(1) : '—'}%, open positions ${a.positions}, unrealised $${a.upl}.`, '');

  // 1. paper trades
  if (trades.length) {
    const usd = (x) => x.reduce((s, t) => s + t.netUsd, 0), R = (x) => x.reduce((s, t) => s + t.r, 0);
    const big = trades.slice().sort((x, y) => Math.abs(y.netUsd) - Math.abs(x.netUsd))[0], rest = trades.filter((t) => t !== big);
    const L1 = trades.filter((t) => t.side > 0), S1 = trades.filter((t) => t.side < 0), Lr = rest.filter((t) => t.side > 0), Sr = rest.filter((t) => t.side < 0);
    L.push('## Closed paper trades', '');
    L.push(`${trades.length} trades (${new Date(Math.min(...trades.map((t) => t.entryT))).toISOString().slice(0, 16)} → ${new Date(Math.max(...trades.map((t) => t.exitT))).toISOString().slice(0, 16)} UTC): **$${usd(trades).toFixed(0)}, ${f(R(trades), 1)} R**. Biggest single trade: ${big.coin} ${big.side > 0 ? 'long' : 'short'} by ${names(big).join('+')}, ${f(big.r, 1)} R ($${big.netUsd.toFixed(0)}, ${big.entry} → ${big.exit}, ${((big.exitT - big.entryT) / 3600000).toFixed(1)} h). **Without it: $${usd(rest).toFixed(0)}, ${f(R(rest), 1)} R.**`, '');
    L.push(`By side: longs ${L1.length} trades ${f(R(L1), 1)} R (without the biggest trade: ${f(R(Lr), 1)} R), shorts ${S1.length} trades ${f(R(S1), 1)} R (without it: ${f(R(Sr), 1)} R).`, '');
    const by = {}; for (const t of trades) { const k = names(t).join('+'); (by[k] = by[k] || []).push(t); }
    L.push('| Strategy (or fused group) | Trades | Sum R | Avg R | $ | Exits |', '|---|---|---|---|---|---|');
    for (const [k, x] of Object.entries(by).sort((p, q) => R(q[1]) - R(p[1]))) { const ex = {}; for (const t of x) ex[t.reason] = (ex[t.reason] || 0) + 1; L.push(`| ${k} | ${x.length} | ${f(R(x), 1)} | ${f(R(x) / x.length)} | ${usd(x).toFixed(0)} | ${Object.entries(ex).map(([e, n]) => `${e} ${n}`).join(', ')} |`); }
    L.push('');
  }

  // 2. shadow record
  if (shadow.length) {
    const dayKey = (t) => `${Math.floor(t.entryT / 86400000)}:${t.side}`, sideDay = new Map();
    for (const t of shadow) { const k = dayKey(t); const s = sideDay.get(k) || { sum: 0, n: 0 }; s.sum += t.r; s.n++; sideDay.set(k, s); }
    const adj = (t) => { const s = sideDay.get(dayKey(t)); return t.r - s.sum / s.n; };
    const Ls = shadow.filter((t) => t.side > 0), Ss = shadow.filter((t) => t.side < 0);
    L.push('## Shadow record', '', `${shadow.length} shadow trades, ${new Date(Math.min(...shadow.map((t) => t.entryT))).toISOString().slice(0, 10)} → ${new Date(Math.max(...shadow.map((t) => t.exitT))).toISOString().slice(0, 10)}. All longs ${f(mean(Ls.map((t) => t.r)), 3)} R a trade (${Ls.length}), all shorts ${f(mean(Ss.map((t) => t.r)), 3)} R (${Ss.length}): the market's direction is most of what a few days measure.`, '');
    L.push('"t by hour": trades entered in the same hour counted as one. "Direction-adjusted": R minus the average of all shadow trades on the same side the same day. "±0.7 rule": average R > +0.7 → trade, < −0.7 → off.', '');
    L.push('| Strategy | Trades | Avg R | t per trade | t by hour (hours) | Long avg R | Short avg R | Direction-adjusted avg R | ±0.7 rule | Backtest avg R (t, trades) |', '|---|---|---|---|---|---|---|---|---|---|');
    const by = {}; for (const t of shadow) (by[t.strategy] = by[t.strategy] || []).push(t);
    const rows = Object.entries(by).map(([k, x]) => ({ k, x, m: mean(x.map((t) => t.r)) })).sort((p, q) => q.m - p.m);
    for (const { k, x, m } of rows) {
      const c = clustered(x, (t) => Math.floor(t.entryT / 3600000)), b = bt[k] && bt[k].all;
      const rule = m > 0.7 ? '**trade**' : m < -0.7 ? 'off' : 'shadow';
      L.push(`| ${k} | ${x.length} | ${f(m)} | ${f(tOf(x.map((t) => t.r)), 1)} | ${f(c.t, 1)} (${c.k}) | ${f(mean(x.filter((t) => t.side > 0).map((t) => t.r)))} | ${f(mean(x.filter((t) => t.side < 0).map((t) => t.r)))} | ${f(mean(x.map(adj)))} | ${rule} | ${b && b.n ? `${f(b.avgR, 3)} (${f(b.tStat, 1)}, ${b.n})` : '—'} |`);
    }
    L.push('');
  }
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const A = args(), md = audit({ state: path.resolve(A.state), factory: A.factory && path.resolve(A.factory) });
  if (A.out) fs.writeFileSync(A.out, md);
  console.log(md);
}
module.exports = { audit, clustered, tOf };
