#!/usr/bin/env node
/* Backtest of the trend sleeve on the retired trend bot's data (branches research-data and validation-data).
 *
 *   git worktree add ../research-data origin/research-data      # 1h bars + funding, top-20 coins, 2020 → 2026
 *   git worktree add ../validation-data origin/validation-data  # 30 other coins, delisted ones included
 *   node swarm/tools/trend_sleeve_backtest.js ../research-data --validation ../validation-data [--out report.md] [--quick]
 *
 * 1. The research engine (src/sleeve/trend_engine.js) with the archived v3 configuration: the numbers of
 *    docs/TREND_BOT_RESEARCH_2026-10-18.md, on today's copy of the data.
 * 2. The same weights replayed by the sleeve executor without limits (src/sleeve/sleeve.js, unconstrained):
 *    must equal (1) — the check that the executor books money exactly as the research did.
 * 3. The sleeve under the swarm's hard limits (config/risk.json, unchanged), as configured in config/swarm.json
 *    → sleeves.trend, and a few settings around it (stop distance, risk share, capital share).
 * Market eras as in the research. Every run starts 2020-01-01; signals warm up on the data before it.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const E = require('../src/sleeve/trend_engine');
const S = require('../src/sleeve/sleeve');

const ERAS = [['2020-01-01', '2021-01-01', '2020'], ['2021-01-01', '2022-01-01', '2021 bull'], ['2022-01-01', '2023-01-01', '2022 bear'], ['2023-01-01', '2024-03-15', '2023 recovery'], ['2024-03-15', '2025-10-11', '2024–25'], ['2025-10-11', '2026-12-31', '2025–26 decline']];
const ts = (d) => Date.parse(d + 'T00:00:00Z') / 1000;
// the retired bot's top-20 on 2026-10-18 (lab/universe.json at the archive tag); research-data was rebuilt since
const ORIGINAL_20 = ['BTC', 'ETH', 'ZEC', 'SOL', 'XRP', 'NEAR', 'Q', 'XMR', 'DOGE', 'HBAR', '1000BONK', 'HYPE', 'SUI', 'LTC', 'PEPE', 'INJ', 'LINK', 'PUMP', 'BCH', 'QNT'];

function csv(file) {
  const txt = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'), lines = txt.split('\n'), cols = {};
  lines[0].split(',').forEach((h, k) => (cols[h.trim()] = k));
  const rows = []; for (let i = 1; i < lines.length; i++) if (lines[i]) rows.push(lines[i].split(',').map(Number));
  return { cols, rows };
}
function loadCoin(dir, coin) {
  const { cols, rows } = csv(path.join(dir, coin, '1h.csv.gz')), n = rows.length;
  const c = { coin, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), funding: [] };
  for (let i = 0; i < n; i++) { const r = rows[i]; c.t[i] = Math.floor(r[cols.t] / 1000); c.o[i] = r[cols.o]; c.h[i] = r[cols.h]; c.l[i] = r[cols.l]; c.c[i] = r[cols.c]; }
  const f = path.join(dir, coin, 'funding.csv.gz');
  if (fs.existsSync(f)) { const x = csv(f); c.funding = x.rows.map((r) => [Math.floor(r[x.cols.t] / 1000), r[x.cols.rate]]); }
  return c;
}
function universe(dir) {
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return man.coins.filter((c) => c.status === 'ok' && c['1h'] && c['1h'].rows > 24 * 200).map((c) => c.coin);
}

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
function eras(daily) {
  return ERAS.map(([a, b]) => { const d = daily.filter(([k]) => k * E.D >= ts(a) && k * E.D < ts(b)); const s = E.stats(d); return { sharpe: s.sharpe, ret: d.reduce((x, [, r]) => x * (1 + r), 1) - 1 }; });
}
function row(label, r, extra = '') {
  const e = eras(r.daily);
  return { label, sharpe: r.sharpe, md: `| ${label} | ${r.sharpe.toFixed(2)} | ${pct(r.cagr)} | ${pct(r.vol)} | ${pct(r.maxDD)} | ${pct(-r.worstDay)} | ${e.filter((x) => x.sharpe > 0).length}/6 | ${e.map((x) => `${x.sharpe.toFixed(2)} (${x.ret >= 0 ? '+' : ''}${(x.ret * 100).toFixed(1)}%)`).join(' | ')} |${extra ? ` ${extra} |` : ''}` };
}
const HEAD = (extra) => [`| Variant | Sharpe | CAGR | Volatility | Max drawdown | Worst day | Eras positive | ${ERAS.map((e) => e[2]).join(' | ')} |${extra ? ` ${extra} |` : ''}`, `|---|---|---|---|---|---|---|${ERAS.map(() => '---|').join('')}${extra ? '---|' : ''}`];

function sleeveNotes(r) {
  const ev = r.events, mh = ev.modeHours, h = Math.max(1, ev.hours);
  const modes = Object.entries(mh).filter(([k]) => k !== 'normal').map(([k, v]) => `${k} ${(100 * v / h).toFixed(1)}%`).join(', ') || 'none';
  const trims = Object.entries(ev.trims).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace('trimmed by ', '')} ${v}`).join(', ') || 'none';
  return `stops hit ${ev.stops} (${(ev.stops / (r.days / 365)).toFixed(0)}/yr, cost ${r.stopCostPct.toFixed(1)}% of start), stops tightened ${ev.stopMoves || 0} times; rebalances ${r.legsPerDay.toFixed(1)}/day; gross avg ${r.avgGross.toFixed(2)}× max ${ev.maxGross.toFixed(2)}×; stop risk avg ${pct(r.avgRiskPct, 2)} max ${pct(ev.maxRiskPct, 2)}; budget scaled ${(100 * ev.scaledHours / h).toFixed(0)}% of hours; ladders: ${modes}; trims: ${trims}; halts: ${ev.halts.join(', ') || 'none'}`;
}

function main() {
  const A = { _: [] }, v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; else A._.push(v[i]);
  const dir = A._[0];
  if (!dir) { console.error('usage: trend_sleeve_backtest.js <research-data dir> [--validation dir] [--out file.md] [--quick]'); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'swarm.json'), 'utf8'));
  const limits = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'risk.json'), 'utf8'));
  const rules = Object.assign({}, ((cfg.sleeves || {}).trend || {}).rules || {});
  const START = ts('2020-01-01'), out = [], log = (...a) => { for (const s of a) { console.log(s); out.push(s); } };
  const t0 = Date.now();

  // data sets: today's research-data top-20; the original 20 as far as they still exist; the validation coins
  const coins = universe(dir), data = new Map(coins.map((c) => [c, loadCoin(dir, c)]));
  const sets = [[`research-data top-20 (${coins.length} coins, rebuilt 2026-10-19)`, coins.map((c) => data.get(c))]];
  const vdir = A.validation && fs.existsSync(path.join(A.validation, 'manifest.json')) ? A.validation : null;
  const vcoins = vdir ? universe(vdir) : [];
  const orig = ORIGINAL_20.map((c) => data.get(c) || (vcoins.includes(c) ? loadCoin(vdir, c) : null)).filter(Boolean);
  if (orig.length !== coins.length || orig.some((c) => !coins.includes(c.coin))) sets.push([`the archived top-20 (${orig.length} of 20 still in the data: ${ORIGINAL_20.filter((c) => !orig.some((x) => x.coin === c)).join(', ') || 'all'} missing)`, orig]);
  if (vdir) sets.push([`validation: ${vcoins.length} other coins, delisted included`, vcoins.map((c) => loadCoin(vdir, c))]);
  const btc = data.get('BTC');

  log(`# Trend sleeve backtest (${new Date().toISOString().slice(0, 10)})`, '');
  log(`Data: \`${path.basename(path.resolve(dir))}\`${vdir ? ` and \`${path.basename(path.resolve(vdir))}\`` : ''}, 1h bars and funding from ${new Date(START * 1000).toISOString().slice(0, 10)}. Sleeve rules (config/swarm.json → sleeves.trend): ${JSON.stringify(Object.assign({}, S.RULES, rules))}. Hard limits: config/risk.json as signed.`);
  log('');
  const results = {};
  for (const [label, set] of sets) {
    const grid = E.align(set);
    // the validation coins have no BTC: their betas use BTC from research-data
    const refOnGrid = grid.coins.find((g) => g.coin === 'BTC') || (btc ? alignRef(grid, btc) : null);
    const sim = E.simulate(grid, { start: START, keepWant: true });
    log(`## ${label}`, '', ...HEAD());
    const rows = [row('research engine, v3 (archived rules, no swarm limits)', sim)];
    // the executor books money as the research did: same weights, no limits, whole history → the same result
    const whole = E.simulate(grid, { keepWant: true }), free = S.run(grid, whole, Object.assign({}, rules, { unconstrained: true, capitalShare: 1 }));
    const same = Math.abs(free.sharpe - whole.sharpe) < 1e-6 && Math.abs(free.final / whole.final - 1) < 1e-6; // floating point only
    const variants = A.quick ? [['sleeve as configured', {}]] : [
      ['sleeve as configured', {}],
      ['stops trailed every hour', { trailStops: true }],
      ['stops 4σ', { stopK: 4 }], ['stops 6σ', { stopK: 6 }], ['stops 12σ', { stopK: 12 }],
      ['risk share 50% of maxOpenRisk', { riskShare: 0.5 }],
      ['capital share 25%', { capitalShare: 0.25 }], ['capital share 100%', { capitalShare: 1 }],
      ['as configured, 2× costs', { fee: 2 * (rules.fee || S.RULES.fee), stopCostBps: 2 * (rules.stopCostBps || S.RULES.stopCostBps) }],
    ];
    const notes = [];
    for (const [vl, o] of variants) {
      const r = S.run(grid, sim, Object.assign({}, rules, o, { limits, from: START, ref: refOnGrid }));
      rows.push(row(`swarm sleeve: ${vl}`, r));
      notes.push(`- **${vl}**: ${sleeveNotes(r)}`);
      if (vl === 'sleeve as configured') results[label] = { research: sim.sharpe, free: free.sharpe, sleeve: r.sharpe, maxDD: r.maxDD, worstDay: r.worstDay };
    }
    for (const r of rows) log(r.md);
    log('', ...notes, '');
    log(same ? `Executor check (whole history, no limits, capital share 1): Sharpe ${free.sharpe.toFixed(6)} = research ${whole.sharpe.toFixed(6)}, final equity ${free.final.toFixed(6)} = ${whole.final.toFixed(6)}.` : `**Executor check FAILED**: Sharpe ${free.sharpe} vs ${whole.sharpe}, final ${free.final} vs ${whole.final}`, '');
  }
  log(`_${((Date.now() - t0) / 1000).toFixed(0)} s._`);
  if (A.out) fs.writeFileSync(A.out, out.join('\n') + '\n');
  if (A.json) fs.writeFileSync(A.json, JSON.stringify(results, null, 1));
}

// BTC's closes on another grid's hours (for betas of a coin set without BTC)
function alignRef(grid, btc) {
  const g = { coin: 'BTC', o: new Float64Array(grid.n).fill(NaN), h: new Float64Array(grid.n).fill(NaN), l: new Float64Array(grid.n).fill(NaN), c: new Float64Array(grid.n).fill(NaN), fund: new Float64Array(grid.n) };
  const t0 = grid.t[0];
  for (let i = 0; i < btc.t.length; i++) { const k = Math.round((btc.t[i] - t0) / E.H); if (k >= 0 && k < grid.n) { g.o[k] = btc.o[i]; g.h[k] = btc.h[i]; g.l[k] = btc.l[i]; g.c[k] = btc.c[i]; } }
  return g;
}

if (require.main === module) main();
module.exports = { loadCoin, universe, ORIGINAL_20 };
