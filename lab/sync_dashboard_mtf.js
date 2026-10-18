#!/usr/bin/env node
// Builds the multi-coin dashboard's database documents from a checkout of the mtf-state branch.
//   node lab/sync_dashboard_mtf.js <mtf-state dir> <out dir>
// Writes <out>/state.json, journal.json, candles.json (each < 250 KB).
'use strict';
const fs = require('fs'), path = require('path');
const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: sync_dashboard_mtf.js <mtf-state dir> <out dir>'); process.exit(2); }
const S = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
const U = JSON.parse(fs.readFileSync(path.join(__dirname, 'universe.json'), 'utf8'));
const now = Math.floor(Date.now() / 1000);
const sig = (x, d = 6) => (x == null || !isFinite(x) ? null : +(+x).toPrecision(d));
const research = (() => { try { const r = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research_out', 'v3', 'study_v3.json'), 'utf8')); const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research_out', 'v3', 'validation.json'), 'utf8')); return { main: r.rows[0], validation: v.rows[0], btceth: r.rows.find((x) => x.label === 'BTC+ETH only') }; } catch (e) { return null; } })();
const pick = (r) => r && { sharpe: r.sharpe, cagr: r.cagr, vol: r.vol, maxDD: r.maxDD, posEras: r.posEras, eras: r.eras };
const state = {
  syncedAt: now, updatedAt: S.updatedAt, createdAt: S.createdAt, equity0: S.equity0, stats: S.stats, governor: S.governor, paused: !!S.paused, riskScale: S.riskScale, portScale: S.portScale,
  thinking: S.thinking ? { t: S.thinking.t, closed: S.thinking.closed, equity: S.thinking.equity, coins: S.thinking.coins.map((c) => Object.assign({}, c, { price: sig(c.price) })) } : null,
  orders: Object.entries(S.orders || {}).map(([coin, o]) => ({ coin, qty: sig(o.qty, 5), limit: sig(o.limit), since: o.t0, reason: o.reason })),
  positions: Object.entries(S.pos || {}).filter(([, p]) => p.qty).map(([coin, p]) => ({ coin, qty: sig(p.qty, 6), avg: sig(p.avg) })),
  universe: U.coins.map((c) => c.coin), runs: (S.runs || []).slice(-5), errors: (S.errors || []).slice(-10),
  research: research ? { main: pick(research.main), validation: pick(research.validation), btceth: pick(research.btceth) } : null,
};
let eq = S.equity || [];
if (eq.length > 900) { const k = Math.ceil(eq.length / 900); eq = eq.filter((_, i) => i % k === 0 || i === eq.length - 1); }
const journal = { syncedAt: now, events: (S.events || []).slice(-200).map((e) => ({ t: e.t, type: e.type, text: e.text, coin: e.coin })), fills: (S.fills || []).slice(-300).map((f) => ({ t: f.t, coin: f.coin, qty: sig(f.qty, 5), price: sig(f.price), feeUsd: f.feeUsd, why: f.why })), equity: eq };
const candles = { syncedAt: now, coins: {} };
for (const c of U.coins) {
  const p = path.join(dir, 'hours', c.coin + '.csv');
  if (!fs.existsSync(p)) continue;
  const rows = fs.readFileSync(p, 'utf8').split('\n').filter((l) => /^\d/.test(l)).slice(-168).map((l) => l.split(',').map(Number));
  candles.coins[c.coin] = { t0: rows.length ? rows[0][0] : null, o: rows.map((r) => sig(r[1], 5)), h: rows.map((r) => sig(r[2], 5)), l: rows.map((r) => sig(r[3], 5)), c: rows.map((r) => sig(r[4], 5)) };
}
fs.mkdirSync(out, { recursive: true });
for (const [k, v] of Object.entries({ state, journal, candles })) {
  const s = JSON.stringify(v);
  if (s.length > 250000) throw new Error(k + ' too large: ' + s.length);
  fs.writeFileSync(path.join(out, k + '.json'), s);
  console.log(k, s.length, 'bytes');
}
