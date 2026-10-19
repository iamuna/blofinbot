#!/usr/bin/env node
/* Summarise a short live run from its recording and fail when the BloFin data path is broken.
 *   node swarm/src/tools/smoke_report.js <dataDir> [--min-minutes 3]
 * Prints messages per type, per-coin bars/books/trades, the universe and its source, guard status, warnings.
 * Exit 1 when fewer than half the coins produced 1-minute bars and books (the parsing or the feed is broken).
 */
'use strict';
const { readRecording } = require('../market/recorder');

async function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: smoke_report.js <dataDir>'); process.exit(2); }
  const byType = {}, coins = {}, logs = [];
  let uni = null, guard = null, first = Infinity, last = 0;
  const C = (c) => coins[c] || (coins[c] = { bars: 0, books: 0, trades: 0, tickers: 0, spread: [], refBars: 0, flow: 0, liqs: 0 });
  for await (const m of readRecording(dir)) {
    byType[m.type] = (byType[m.type] || 0) + 1; first = Math.min(first, m.ts); last = Math.max(last, m.ts);
    const d = m.data;
    if (m.type === 'md.bar') C(d.coin).bars++;
    else if (m.type === 'md.book') { C(d.coin).books++; C(d.coin).spread.push(d.spreadBps); }
    else if (m.type === 'md.trade') C(d.coin).trades += d.trades.length;
    else if (m.type === 'md.ticker') C(d.coin).tickers++;
    else if (m.type === 'ref.bar') C(d.coin).refBars++;
    else if (m.type === 'ref.flow') for (const k of Object.keys(d.coins)) C(k).flow++;
    else if (m.type === 'ref.liq') C(d.coin).liqs++;
    else if (m.type === 'uni.list') uni = d;
    else if (m.type === 'guard.status') guard = d;
    else if (m.type === 'sys.log' || m.type === 'sys.dead') logs.push(`${m.type} ${d.agent}: ${d.msg || d.error}`);
  }
  const mins = (last - first) / 60000;
  console.log(`# Swarm smoke run\n\nRecorded ${mins.toFixed(1)} minutes (${new Date(first).toISOString()} → ${new Date(last).toISOString()}).\n`);
  console.log('| Type | Messages |\n|---|---|'); for (const [k, v] of Object.entries(byType).sort()) console.log(`| ${k} | ${v} |`);
  if (uni) console.log(`\nUniverse: ${uni.coins.length} coins, source: ${uni.source}${uni.stale ? ' (stale)' : ''}\n${uni.coins.map((c) => `${c.coin}${c.vol7d ? ` $${Math.round(c.vol7d / 1e6)}M` : ''}${c.spreadBps != null ? ` ${c.spreadBps}bp` : ''}`).join(', ')}`);
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  console.log('\n| Coin | BloFin bars | books | trades | tickers | median spread bps | Binance bars | flow secs | liqs | guard |\n|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, v] of Object.entries(coins).sort()) {
    const g = guard && guard.coins[k];
    console.log(`| ${k} | ${v.bars} | ${v.books} | ${v.trades} | ${v.tickers} | ${med(v.spread) == null ? '—' : med(v.spread).toFixed(2)} | ${v.refBars} | ${v.flow} | ${v.liqs} | ${g ? (g.tradable ? 'tradable' : g.reasons.join(',')) + (g.refOk ? '' : ' (no Binance)') : '—'} |`);
  }
  if (logs.length) { console.log('\nWarnings and errors:'); for (const l of [...new Set(logs)].slice(0, 40)) console.log('- ' + l); }
  const universe = uni ? uni.coins.map((c) => c.coin) : Object.keys(coins);
  const good = universe.filter((c) => coins[c] && coins[c].bars >= 1 && coins[c].books >= 10).length;
  const need = Math.ceil(universe.length / 2);
  console.log(`\nBloFin data check: ${good}/${universe.length} coins produced bars and books (need ${need}).`);
  if (!universe.length || good < need) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
