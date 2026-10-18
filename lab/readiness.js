#!/usr/bin/env node
/* Readiness check for the next step of paper → demo → small live.
 *
 *   node lab/readiness.js <state-dir> [--json]
 *
 * Judges the MECHANICS, not the profit: three weeks are far too short to tell skill from luck (the research
 * expects long flat or losing stretches). The question is whether the bot runs the way the backtest assumed:
 * it stays up, it does not error, it trades about as often and as cheaply as modelled, and its risk is
 * where the sizing puts it. Thresholds are judgement calls written down in advance (docs/DEMO_TRADING.md).
 */
'use strict';
const fs = require('fs'), path = require('path');

// backtest reference (research_out/v3: chosen system on the top-20, and the 30 unseen coins)
const REF = { sharpe: [0.86, 1.40], vol: 14.2, maxDD: [13.9, 15.9], feesPctPerYear: 14.6 / 6.8, costBps: 5.9, tradesPerDay: 4.8 };
const NEXT = { paper: 'demo', demo: 'small live' };
const CRIT = {
  paper: { days: 21, uptime: 0.95, fills: 40, costBps: 10, maxDD: 15, volLo: 4, volHi: 30 },
  demo: { days: 42, uptime: 0.97, fills: 120, costBps: 9, maxDD: 15, volLo: 4, volHi: 30 },
};

function analyse(S, nowT) {
  const mode = S.mode || 'paper', C = CRIT[mode] || CRIT.paper;
  const now = nowT || S.updatedAt || Math.floor(Date.now() / 1000);
  const start = S.brokerStarted || (S.runs && S.runs.length ? S.runs[0].start : S.createdAt) || now;
  const days = (now - start) / 86400;
  // uptime from the 15-minute equity samples over the last 14 days
  const eqs = (S.equity || []).filter((e) => e[0] >= start);
  const from = Math.max(start, now - 14 * 86400);
  const recent = eqs.filter((e) => e[0] >= from);
  const expected = Math.max(1, Math.floor((now - from) / 900));
  const uptime = Math.min(1, recent.length / expected);
  // errors in the last 7 days, grouped by message (numbers stripped)
  const errs = (S.errors || []).filter((e) => e.t >= now - 7 * 86400);
  const groups = {};
  for (const e of errs) { const k = e.msg.replace(/[0-9.]+/g, '#').slice(0, 90); groups[k] = (groups[k] || 0) + 1; }
  const repeated = Object.entries(groups).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  // fills and execution cost (fee + slippage vs the price when the order was decided)
  const fills = (S.fills || []).filter((f) => f.t >= start);
  let notional = 0, fees = 0, slipUsd = 0, slipN = 0, market = 0;
  for (const f of fills) {
    const n = Math.abs(f.qty * f.price); notional += n; fees += f.feeUsd || 0;
    if (f.why === 'market') market++;
    if (f.arrival > 0) { slipUsd += Math.sign(f.qty) * (f.price - f.arrival) * Math.abs(f.qty); slipN++; }
  }
  const slipNotional = fills.filter((f) => f.arrival > 0).reduce((a, f) => a + Math.abs(f.qty * f.price), 0);
  const feeBps = notional ? (fees / notional) * 1e4 : null;
  const slipBps = slipNotional ? (slipUsd / slipNotional) * 1e4 : null;
  const costBps = feeBps == null ? null : feeBps + (slipBps || 0);
  // equity path: daily closes → realised vol; max drawdown; annualised fees
  const daily = {};
  for (const [t, e] of eqs) daily[Math.floor(t / 86400)] = e;
  const closes = Object.keys(daily).sort((a, b) => a - b).map((k) => daily[k]);
  const rets = closes.slice(1).map((e, i) => e / closes[i] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const vol = rets.length >= 10 ? Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(365) * 100 : null;
  let peak = -Infinity, maxDD = 0;
  for (const [, e] of eqs) { peak = Math.max(peak, e); maxDD = Math.max(maxDD, (1 - e / peak) * 100); }
  const eq0 = S.equity0 || (eqs[0] && eqs[0][1]) || 1, eqNow = (S.stats && S.stats.equity) || (eqs.length ? eqs[eqs.length - 1][1] : eq0);
  const avgEq = eqs.length ? eqs.reduce((a, e) => a + e[1], 0) / eqs.length : eq0;
  // rates only once a few days exist (the first day is mostly the initial build-up of positions)
  const feesPctYear = days >= 3 ? (fees / avgEq) * 100 * (365 / days) : null;
  const ordersPerDay = days >= 3 ? fills.length / days : null;
  const checks = [
    { name: `Running ≥ ${C.days} days`, ok: days >= C.days, value: `${days.toFixed(1)} days` },
    { name: `Up ≥ ${C.uptime * 100}% of the last 14 days`, ok: uptime >= C.uptime, value: `${(uptime * 100).toFixed(1)}%` },
    { name: 'No repeated error in the last 7 days', ok: repeated.length === 0, value: repeated.length ? repeated.map(([k, n]) => `${n}× ${k}`).join('; ') : `${errs.length} errors, none repeated` },
    { name: `≥ ${C.fills} fills`, ok: fills.length >= C.fills, value: `${fills.length} (${market} market)` },
    { name: `Execution cost ≤ ${C.costBps} bps (research: ${REF.costBps})`, ok: costBps != null && costBps <= C.costBps, value: costBps == null ? '—' : `${costBps.toFixed(1)} bps (fees ${feeBps.toFixed(1)} + slippage ${slipBps == null ? '—' : slipBps.toFixed(1)})` },
    { name: `Drawdown < ${C.maxDD}% and governor not flat`, ok: maxDD < C.maxDD && S.governor !== 'flat', value: `${maxDD.toFixed(1)}%, governor ${S.governor}` },
    { name: `Realised vol ${C.volLo}–${C.volHi}% a year (backtest ${REF.vol}%)`, ok: vol != null && vol >= C.volLo && vol <= C.volHi, value: vol == null ? 'needs ≥ 10 days' : `${vol.toFixed(1)}%` },
  ];
  const ready = checks.every((c) => c.ok);
  return {
    mode, next: NEXT[mode] || null, ready, checks,
    info: { since: new Date(start * 1000).toISOString().slice(0, 16) + 'Z', equity0: eq0, equity: eqNow, returnPct: (eqNow / eq0 - 1) * 100, fills: fills.length, ordersPerDay, feesPctYear, refFeesPctYear: REF.feesPctPerYear, refTradesPerDay: REF.tradesPerDay },
  };
}

function markdown(r) {
  const L = [`# Readiness: ${r.mode} → ${r.next || '—'}`, '', `**${r.ready ? 'Ready' : 'Not yet'}** — ${r.checks.filter((c) => c.ok).length}/${r.checks.length} checks pass. Profit is not a check: weeks are too short to judge it.`, '', '| Check | Result | Value |', '|---|---|---|'];
  for (const c of r.checks) L.push(`| ${c.name} | ${c.ok ? 'pass' : 'not yet'} | ${c.value} |`);
  const i = r.info;
  L.push('', `Since ${i.since}: equity ${i.equity.toFixed(2)} (${i.returnPct >= 0 ? '+' : ''}${i.returnPct.toFixed(2)}%), ${i.fills} fills (${i.ordersPerDay == null ? '—' : i.ordersPerDay.toFixed(1)}/day; backtest ${i.refTradesPerDay}/day), fees ${i.feesPctYear == null ? '— (after 3 days)' : i.feesPctYear.toFixed(2) + '%'} of equity a year (backtest ${i.refFeesPctYear.toFixed(1)}%).`);
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: readiness.js <state-dir> [--json]'); process.exit(2); }
  const S = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const r = analyse(S);
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 1) : markdown(r));
}
module.exports = { analyse, markdown, CRIT, REF };
