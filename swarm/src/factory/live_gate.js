#!/usr/bin/env node
/* Live gate: which strategies have earned real money, judged on their BloFin DEMO record (real orders, real fills).
 *
 *   node swarm/src/factory/live_gate.js --state <swarm-state dir> [--factory <swarm-factory dir>] [--out LIVE-GATE.md]
 *
 * Per strategy, from the closed demo trades it took part in (trades.jsonl, account "demo"):
 *   ≥ 200 trades · average R > 0 after all costs with t ≥ 2 · worst drawdown (in R) within 2× its backtest's ·
 *   fees and funding per trade within 1.5× the backtest's cost per trade.
 * The gate only reports. Going live is Ibrahim's decision, made on the PC: a live key, `liveEnabled` in the risk
 * limits signed with `sudo swarm-sign-risk`, and the strategy set to trade with /mode on Telegram. The first live
 * month risks at most 0.5% per trade (risk.json liveFirstMonthCapPct).
 */
'use strict';
const fs = require('fs'), path = require('path');
const { stats, maxDD } = require('./gate');

const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []);
function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }

const RULES = { minTrades: 200, minT: 2, ddX: 2, costX: 1.5 };

function judge(name, trades, bt) {
  const mine = trades.filter((t) => t.account === 'demo' && (t.strategies || []).some((s) => s.name === name)).sort((a, b) => a.exitT - b.exitT);
  const rs = mine.map((t) => t.r), s = stats(rs), dd = maxDD(rs), why = [];
  if (s.n < RULES.minTrades) why.push(`${s.n} demo trades (need ${RULES.minTrades})`);
  if (!(s.mean > 0) || !(s.t >= RULES.minT)) why.push(`average ${s.n ? s.mean.toFixed(3) : '—'} R, t ${s.n ? s.t.toFixed(2) : '—'} (need > 0 and t ≥ ${RULES.minT})`);
  const btDD = bt && bt.all && bt.all.maxDDR;
  if (btDD > 0 && dd > RULES.ddX * btDD) why.push(`drawdown ${dd.toFixed(1)} R > ${RULES.ddX}× backtest ${btDD} R`);
  const notional = (t) => Math.abs(t.qty * t.entry);
  const costBps = mine.length ? mine.reduce((a, t) => a + ((t.feeUsd || 0) + Math.max(0, t.fundUsd || 0)) / Math.max(1e-9, notional(t)) * 1e4, 0) / mine.length : null;
  const btCost = bt && bt.all && bt.all.avgCostBps;
  if (costBps != null && btCost > 0 && costBps > RULES.costX * btCost) why.push(`fees + funding ${costBps.toFixed(1)} bps a trade > ${RULES.costX}× the backtest's ${btCost} bps`);
  return { name, trades: s.n, avgR: s.n ? +s.mean.toFixed(4) : null, t: s.n ? +s.t.toFixed(2) : null, ddR: +dd.toFixed(2), btDDR: btDD ?? null, costBps: costBps == null ? null : +costBps.toFixed(2), btCostBps: btCost ?? null, ready: why.length === 0, why };
}

function liveGate({ state, factory }) {
  const trades = jsonl(path.join(state, 'trades.jsonl'));
  const latest = factory && fs.existsSync(path.join(factory, 'latest.json')) ? JSON.parse(fs.readFileSync(path.join(factory, 'latest.json'), 'utf8')).results : {};
  const names = new Set(Object.keys(latest));
  for (const t of trades) for (const s of t.strategies || []) names.add(s.name);
  return [...names].sort().map((n) => judge(n, trades, latest[n]));
}

function markdown(rows, now = new Date()) {
  const L = [`# Live gate — ${now.toISOString().slice(0, 16)}Z`, '', `Ready for real money: **${rows.filter((r) => r.ready).map((r) => r.name).join(', ') || 'none'}**. Rules: ≥ ${RULES.minTrades} demo trades, average R > 0 with t ≥ ${RULES.minT}, drawdown ≤ ${RULES.ddX}× backtest, fees + funding ≤ ${RULES.costX}× backtest. Going live is Ibrahim's call (live key, signed limits, /mode).`, ''];
  L.push('| Strategy | Demo trades | Avg R | t | Drawdown R (backtest) | Fees+funding bps (backtest) | Verdict |', '|---|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.name} | ${r.trades} | ${r.avgR ?? '—'} | ${r.t ?? '—'} | ${r.ddR} (${r.btDDR ?? '—'}) | ${r.costBps ?? '—'} (${r.btCostBps ?? '—'}) | ${r.ready ? '**ready**' : r.why.join('; ')} |`);
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const A = args(), rows = liveGate({ state: path.resolve(A.state), factory: A.factory && path.resolve(A.factory) }), md = markdown(rows);
  if (A.out) fs.writeFileSync(A.out, md);
  process.stdout.write(md);
}
module.exports = { liveGate, judge, markdown, RULES };
