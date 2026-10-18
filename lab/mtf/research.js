/* Portfolio research runner for the top-20 universe.
 *   node lab/mtf/research.js <research-data dir> <out dir>
 * Runs the multi-timeframe engine over all coins with data and reports, per market era and overall:
 *   - the full system and ablations (each layer / feature removed), long+short vs long-only,
 *   - cost stress (2× fees and slippage), hysteresis bands,
 *   - BTC+ETH only (survivorship check: these two were large throughout).
 * Writes <out>/portfolio.json and <out>/portfolio.md.
 */
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./mtf.js');

const ERAS = [
  ['2020-01-01', '2021-01-01', '2020 recovery'],
  ['2021-01-01', '2022-01-01', '2021 bull'],
  ['2022-01-01', '2023-01-01', '2022 bear'],
  ['2023-01-01', '2024-03-15', '2023 recovery'],
  ['2024-03-15', '2025-10-11', '2024–25 range/bull'],
  ['2025-10-11', '2026-12-31', '2025–26 decline'],
];
const ts = (d) => Date.parse(d + 'T00:00:00Z') / 1000;

function main() {
  const [dir, out] = process.argv.slice(2);
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const coins = (man.coins || []).filter((c) => c.status === 'ok').map((c) => c.coin);
  const data = coins.map((c) => M.loadCoin(dir, c));
  const grid = M.align(data);
  const core = M.align(data.filter((c) => c.coin === 'BTC' || c.coin === 'ETH'));
  const START = ts('2020-01-01');
  const variants = [
    ['Full system (long+short)', {}],
    ['Long only', { allowShort: false }],
    ['Shorts only on 1d+', { shortTfs: ['1d', '3d', '1w', '1M', '3M'] }],
    ['No cross-coin momentum', { xsec: 0 }],
    ['No funding filter', { fundingCrowd: 0 }],
    ['Strategic layer only (1d→3M)', { tfs: ['1d', '3d', '1w', '1M', '3M'] }],
    ['Setup layer only (1h→12h)', { tfs: ['1h', '2h', '4h', '6h', '12h'] }],
    ['Daily ensemble only (paper rules)', { tfs: ['1d'], allowShort: false }],
    ['No portfolio vol targeting', { portVolTarget: 0 }],
    ['Wider hysteresis (40%)', { band: 0.4 }],
    ['Narrow hysteresis (10%)', { band: 0.1 }],
    ['2× fees and slippage', { fee: 0.0012, slip: 0.0004 }],
  ];
  const rows = [];
  const run = (label, g, opts) => {
    const all = M.simulate(g, Object.assign({ start: START }, opts));
    const eras = ERAS.map(([a, b, name]) => { const r = M.simulate(g, Object.assign({}, opts, { start: ts(a), end: ts(b) })); return { era: name, sharpe: +r.sharpe.toFixed(2), ret: +((r.final - 1) * 100).toFixed(1), maxDD: +(r.maxDD * 100).toFixed(1) }; });
    const row = { label, sharpe: +all.sharpe.toFixed(2), cagr: +(all.cagr * 100).toFixed(1), vol: +(all.vol * 100).toFixed(1), maxDD: +(all.maxDD * 100).toFixed(1), tradesPerDay: +all.tradesPerDay.toFixed(1), feesPct: +all.feesPct.toFixed(1), fundingPct: +all.fundingPct.toFixed(1), byYear: all.byYear, eras };
    rows.push(row);
    console.log(label.padEnd(36), `Sharpe ${row.sharpe} CAGR ${row.cagr}% maxDD ${row.maxDD}% trades/day ${row.tradesPerDay}`, eras.map((e) => `${e.era}:${e.sharpe}`).join(' '));
    return all;
  };
  for (const [label, opts] of variants) run(label, grid, opts);
  run('BTC+ETH only, full system', core, {});
  run('BTC+ETH only, long only', core, { allowShort: false });
  // buy & hold equal-weight reference (rebalanced daily, no costs) for context
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'portfolio.json'), JSON.stringify({ coins, generated: new Date().toISOString(), rows }, null, 1));
  const md = ['| Variant | Sharpe | CAGR | Vol | Max DD | Trades/day | ' + ERAS.map((e) => e[2]).join(' | ') + ' |', '|---|---|---|---|---|---|' + ERAS.map(() => '---|').join('')];
  for (const r of rows) md.push(`| ${r.label} | ${r.sharpe} | ${r.cagr}% | ${r.vol}% | ${r.maxDD}% | ${r.tradesPerDay} | ` + r.eras.map((e) => `${e.sharpe} (${e.ret}%)`).join(' | ') + ' |');
  fs.writeFileSync(path.join(out, 'portfolio.md'), md.join('\n') + '\n');
}
if (require.main === module) main();
