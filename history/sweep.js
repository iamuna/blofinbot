#!/usr/bin/env node
/* Every strategy × every timeframe on the 5-year history, with the live code path (features → regime → strategy →
 * execution simulator) and the point-in-time universe. Nothing in the live swarm changes: the extra timeframes and
 * the universe gate are set up here, in memory.
 *
 *   node history/sweep.js --data <dir> --out <dir> [--shard 0/20] [--groups a,b] [--from 2021-10-01] [--list]
 *
 * --shard i/n: trade only the i-th of n coin groups (BTC's data is always read: other coins' features use it).
 * --print-coins: print the coins a shard reads (to download only those) and stop. The data dir then needs only
 * universe.json and manifest.json.
 * Writes <out>/trades-<i>.jsonl.gz (one line per variant: daily sums by exit day [R, R at 1.5× costs, trades, net bps, long R, long trades],
 * and the trades for timeframes ≥ 30 minutes) and <out>/summary-<i>.json.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const FRAMES = [1, 3, 5, 15, 30, 60, 120, 240, 720, 1440];
const MIN_RISK_BPS = 10;

// the variant groups: [group, plugin, frames, params(tf), scaleMinutes]
const GROUPS = [
  ['intraday-trend', 'intraday-trend', FRAMES, (tf) => ({ onlyTfs: [tf] })],
  ['trend-pullback', 'trend-pullback', FRAMES, (tf) => ({ onlyTfs: [tf] }), true],
  ['overshoot-fade', 'overshoot-fade', FRAMES, (tf) => ({ onlyTfs: [tf] }), true],
  ['noise-breakout', 'noise-breakout', [5, 15, 30, 60, 120], (tf) => ({ onlyTfs: [tf] })],
  ['rsi-macd-rev', 'rsi-macd', FRAMES, (tf) => ({ mode: 'reversal', tf, entry: 'maker' })],
  ['rsi-macd-trend', 'rsi-macd', FRAMES, (tf) => ({ mode: 'trend', tf, entry: 'maker' })],
  ['harmonic', 'harmonic', FRAMES, (tf) => ({ tf, waitBars: 24 })],
  ['ma-retest', 'ma-21-200', FRAMES, (tf) => ({ mode: 'retest', tf })],
  ['ma-pullback', 'ma-21-200', FRAMES, (tf) => ({ mode: 'pullback', tf })],
  ['ma-pullback-ride', 'ma-21-200', FRAMES, (tf) => ({ mode: 'pullback', tf, rr: 0, trailAtr: 3, trailAfterR: 1, holdBars: 96 })],
  // event strategies built around one timeframe: their own settings only
  ['native', 'session-drive', [30], () => ({})],
  ['native', 'leader-follow', [1], () => ({})],
  ['native', 'crowd-squeeze', [5, 15], (tf) => ({ onlyTfs: [tf] })],
  ['native', 'dip-reversal', [5], () => ({})],
  ['native', 'squeeze-ride', [5], () => ({})],
];

function args() { const A = {}, v = process.argv.slice(2); for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; return A; }
const ymd = (t) => new Date(t).toISOString().slice(0, 10);

function variants(groupFilter) {
  const S = require('../swarm/src/strategies');
  const out = [];
  for (const [group, base, frames, params, scale] of GROUPS) {
    if (groupFilter && !groupFilter.includes(group)) continue;
    const plugin = S.byName[base]; if (!plugin) throw new Error('no plugin ' + base);
    const native = Math.min(...plugin.tfs);
    for (const tf of frames) {
      const p = Object.assign({}, params(tf));
      if (scale && tf !== native) for (const [k, v] of Object.entries(plugin.params)) if (/Min$/.test(k) && typeof v === 'number') p[k] = Math.round(v * tf / native);
      out.push({ name: `${group === 'native' ? base : group}@${tf}`, group, base, tf, params: p });
    }
  }
  return out;
}

async function main() {
  const A = args();
  const V = variants(A.groups ? A.groups.split(',') : null);
  if (A.list) { for (const v of V) console.log(v.name, JSON.stringify(v.params)); console.log(V.length, 'variants'); return; }
  const data = path.resolve(A.data), out = path.resolve(A.out || 'sweep-out');
  // timeframes: what the variants use, plus 1 (features), 5 (plugins that read 5-minute history), 15 (regime)
  const feat = require('../swarm/src/analysis/features');
  const need = new Set([1, 5, 15, ...V.map((v) => v.tf)]);
  feat.TFS.splice(0, feat.TFS.length, ...[...need].sort((a, b) => a - b));
  // plugins: react to every frame a variant asks for; trade only coins in the universe that day and in this shard
  const S = require('../swarm/src/strategies');
  const uni = JSON.parse(fs.readFileSync(path.join(data, 'universe.json'), 'utf8'));
  const man = JSON.parse(fs.readFileSync(path.join(data, 'manifest.json'), 'utf8'));
  const all = Object.keys(man.coins).filter((c) => man.coins[c].status === 'ok').sort();
  const [si, sn] = String(A.shard || '0/1').split('/').map(Number);
  // shards balanced by days in the universe
  const loads = Array.from({ length: sn }, () => ({ n: 0, coins: [] }));
  for (const c of all.slice().sort((a, b) => days(b) - days(a))) { const l = loads.reduce((a, b) => (b.n < a.n ? b : a)); l.n += days(c); l.coins.push(c); }
  function days(c) { return (uni.coins[c] || []).reduce((x, [a, b]) => x + (Date.parse(b) - Date.parse(a)) / 86400000 + 1, 0); }
  const trade = new Set(loads[si].coins);
  if (A['print-coins']) { console.log([...new Set(['BTC', ...trade])].join(' ')); return; }
  const member = new Map(); // coin → Set of days in the universe
  for (const c of trade) { const s = new Set(); for (const [a, b] of uni.coins[c] || []) for (let t = Date.parse(a); t <= Date.parse(b); t += 86400000) s.add(ymd(t)); member.set(c, s); }
  for (const base of new Set(V.map((v) => v.base))) {
    const p = S.byName[base], orig = p.onBar;
    p.tfs = [...new Set([...p.tfs, ...V.filter((v) => v.base === base).map((v) => v.tf)])];
    p.onBar = function (ev, api) { const m = member.get(ev.coin); if (!m || !m.has(ymd(api.now))) return null; return orig.call(this, ev, api); };
  }
  const coins = [...new Set(['BTC', ...trade])].filter((c) => all.includes(c));
  fs.mkdirSync(out, { recursive: true });
  console.error(`shard ${si}/${sn}: ${trade.size} coins (${[...trade].join(' ')}), ${V.length} variants, timeframes ${feat.TFS.join(',')}`);
  const { backtest } = require('../swarm/src/backtest/run');
  const t0 = Date.now();
  const r = await backtest({ data, coins, variants: V.map((v) => ({ name: v.name, base: v.base, params: v.params })), warmupDays: 0, from: A.from ? Date.parse(A.from) : null,
    progress: (m, n) => console.error(`month ${m} done (${Math.round((Date.now() - t0) / 60000)} min)`) });
  // per variant: daily sums by exit day (R, R at 1.5× costs, trades, net bps) for the selector, and the trades
  // themselves for timeframes of 30 minutes and up (the short ones have millions)
  const lines = [], summary = { shard: `${si}/${sn}`, coins: [...trade], minutes: Math.round((Date.now() - t0) / 60000), data: r.data, variants: {} };
  const cols = ['coin', 'side', 'entryT', 'exitT', 'exitKind', 'reason', 'riskBps', 'grossBps', 'feeBps', 'slipBps', 'fundBps', 'netBps', 'r'];
  for (const v of V) {
    const s = r.strategies[v.name], daily = {};
    const mine = s.trades.filter((t) => trade.has(t.coin));
    let tiny = 0;
    for (const t of mine) {
      // R against at least MIN_RISK_BPS: a limit order filled at (or past) its stop has ~zero risk distance, and
      // net/risk would explode (seen in the first run: noise-breakout, leader-follow)
      const risk = Math.max(t.riskBps, MIN_RISK_BPS); if (t.riskBps < MIN_RISK_BPS) tiny++;
      const d = ymd(t.exitT), x = (daily[d] = daily[d] || [0, 0, 0, 0, 0, 0]);
      x[0] += t.netBps / risk; x[1] += (t.netBps - 0.5 * (t.feeBps + t.slipBps)) / risk; x[2]++; x[3] += t.netBps;
      if (t.side > 0) { x[4] += t.netBps / risk; x[5]++; } // the long side alone (is it just riding a rising market?)
    }
    for (const x of Object.values(daily)) for (const k of [0, 1, 3, 4]) x[k] = +x[k].toFixed(4);
    const trades = v.tf >= 30 ? mine.map((t) => cols.map((c) => (typeof t[c] === 'number' ? +t[c].toFixed(4) : t[c]))) : null;
    lines.push(JSON.stringify({ name: v.name, group: v.group, base: v.base, tf: v.tf, params: v.params, daily, cols: trades ? cols : null, trades }));
    summary.variants[v.name] = { n: mine.length, tinyRisk: tiny, ideas: s.ideas, unfilled: s.unfilled };
  }
  fs.writeFileSync(path.join(out, `trades-${si}.jsonl.gz`), zlib.gzipSync(lines.join('\n') + '\n'));
  fs.writeFileSync(path.join(out, `summary-${si}.json`), JSON.stringify(summary, null, 1));
  console.error(`done in ${summary.minutes} min`);
}

main().catch((e) => { console.error(e); process.exit(1); });
