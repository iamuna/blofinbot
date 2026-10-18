/* v3 study: chosen configuration, every component removed in turn, parameter sensitivity, cost stress,
 * market eras, the BTC+ETH-only survivorship check and (when given) an out-of-universe coin set.
 *   node lab/mtf/study_v3.js <research-data dir> <out dir> [validation dir]
 */
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./mtf.js');
const ERAS = [['2020-01-01', '2021-01-01', '2020'], ['2021-01-01', '2022-01-01', '2021 bull'], ['2022-01-01', '2023-01-01', '2022 bear'], ['2023-01-01', '2024-03-15', '2023 recovery'], ['2024-03-15', '2025-10-11', '2024–25'], ['2025-10-11', '2026-12-31', '2025–26 decline']];
const ts = (d) => Date.parse(d + 'T00:00:00Z') / 1000;
const STRAT = ['1d', '3d', '1w', '1M', '3M'];
const V3 = { shortTfs: STRAT, normLive: true, fundingCrowd: 0, fee: 0.00059, slip: 0 };
function loadUniverse(dir) {
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const coins = man.coins.filter((c) => c.status === 'ok' && c['1h'] && c['1h'].rows > 24 * 200).map((c) => c.coin);
  return { coins, data: coins.map((c) => M.loadCoin(dir, c)) };
}
function main() {
  const [dir, out, vdir] = process.argv.slice(2);
  const U = loadUniverse(dir), grid = M.align(U.data);
  const core = M.align(U.data.filter((c) => c.coin === 'BTC' || c.coin === 'ETH'));
  const START = ts('2020-01-01');
  const only = process.env.ONLY_VALIDATION === '1';
  const variants = only ? [] : [
    ['v3 chosen system', {}],
    ['− cross-coin momentum', { xsec: 0 }],
    ['− portfolio vol targeting', { portVolTarget: 0 }],
    ['− setup layer (1h→12h)', { tfs: STRAT }],
    ['− strategic layer (1d→3M)', { tfs: ['1h', '2h', '4h', '6h', '12h'], shortTfs: [] }],
    ['− shorts entirely (long only)', { allowShort: false }],
    ['+ shorts on all timeframes', { shortTfs: null }],
    ['− live-coin sizing', { normLive: false }],
    ['+ funding crowding filter', { fundingCrowd: 0.5 }],
    ['+ Monday Asia-open boost (setup ×1.5)', { sessionBoost: 0.5 }],
    ['+ fee-aware setup gating', { adaptiveSetup: 0.12 }],
    ['lookbacks × 0.7', { lbScale: 0.7 }],
    ['lookbacks × 1.4', { lbScale: 1.4 }],
    ['vol target 15%', { volTarget: 0.15, portVolTarget: 0.15 }],
    ['vol target 35%', { volTarget: 0.35, portVolTarget: 0.35 }],
    ['layer weights 0.8 / 0.2', { layerWeight: { strategic: 0.8, setup: 0.2 } }],
    ['layer weights 0.4 / 0.6', { layerWeight: { strategic: 0.4, setup: 0.6 } }],
    ['2× fees and slippage', { fee: 0.00118, slip: 0 }],
    ['3× fees and slippage', { fee: 0.00177, slip: 0 }],
    ['market-order execution (8 bps)', { fee: 0.0006, slip: 0.0002 }],
  ];
  const rows = [];
  const run = (label, g, extra) => {
    const opts = Object.assign({}, V3, extra);
    const all = M.simulate(g, Object.assign({ start: START }, opts));
    const eras = ERAS.map(([a, b, name]) => { const r = M.simulate(g, Object.assign({}, opts, { start: ts(a), end: ts(b) })); return { era: name, sharpe: +r.sharpe.toFixed(2), ret: +((r.final - 1) * 100).toFixed(1), maxDD: +(r.maxDD * 100).toFixed(1) }; });
    const row = { label, sharpe: +all.sharpe.toFixed(2), cagr: +(all.cagr * 100).toFixed(1), vol: +(all.vol * 100).toFixed(1), maxDD: +(all.maxDD * 100).toFixed(1), tradesPerDay: +all.tradesPerDay.toFixed(1), feesPct: +all.feesPct.toFixed(1), fundingPct: +all.fundingPct.toFixed(1), byYear: all.byYear, eras, posEras: eras.filter((e) => e.sharpe > 0).length };
    rows.push(row);
    console.log(label.padEnd(42), `Sharpe ${row.sharpe} CAGR ${row.cagr}% vol ${row.vol}% maxDD ${row.maxDD}% tr/d ${row.tradesPerDay} eras+ ${row.posEras}/6 |`, eras.map((e) => e.sharpe).join(' '));
    return all;
  };
  for (const [label, o] of variants) run(label, grid, o);
  if (!only) run('BTC+ETH only', core, {});
  if (vdir && fs.existsSync(path.join(vdir, 'manifest.json'))) {
    const V = loadUniverse(vdir), vg = M.align(V.data);
    run(`Validation universe (${V.coins.length} other coins, incl. delisted)`, vg, {});
    run('Validation universe, long only', vg, { allowShort: false });
    run('Validation universe, − setup layer', vg, { tfs: STRAT });
  }
  fs.mkdirSync(out, { recursive: true });
  const name = only ? 'validation' : 'study_v3';
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ generated: new Date().toISOString(), coins: U.coins, config: V3, rows }, null, 1));
  const md = ['| Variant | Sharpe | CAGR | Vol | Max DD | Rebalances/day | Eras positive | ' + ERAS.map((e) => e[2]).join(' | ') + ' |', '|---|---|---|---|---|---|---|' + ERAS.map(() => '---|').join('')];
  for (const r of rows) md.push(`| ${r.label} | ${r.sharpe} | ${r.cagr}% | ${r.vol}% | ${r.maxDD}% | ${r.tradesPerDay} | ${r.posEras}/6 | ` + r.eras.map((e) => `${e.sharpe} (${e.ret}%)`).join(' | ') + ' |');
  fs.writeFileSync(path.join(out, name + '.md'), md.join('\n') + '\n');
}
if (require.main === module) main();
