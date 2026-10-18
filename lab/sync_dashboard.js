#!/usr/bin/env node
// Builds the dashboard's three database documents from a checkout of the paper-state branch.
//   node lab/sync_dashboard.js <paper-state dir> <out dir>
// Writes <out>/state.json, <out>/journal.json, <out>/candles.json (each well under 256 KiB).
'use strict';
const fs = require('fs'), path = require('path');
const E = require('./engine.js');
const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: sync_dashboard.js <paper-state dir> <out dir>'); process.exit(2); }
const S = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
const now = Math.floor(Date.now() / 1000);
const r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000;
const slim = (m) => (m ? { n: m.n, expR: +(+m.expR).toFixed(3), pf: +Math.min(+m.pf, 99).toFixed(2), winRate: m.winRate != null ? +(+m.winRate).toFixed(3) : undefined, maxDD: m.maxDD != null ? +(+m.maxDD).toFixed(2) : undefined } : null);

let description = '';
try {
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'champion.json'), 'utf8'));
  if (S.champion && E.stratKey(c.strategy) + JSON.stringify(c.strategy.exit) === E.stratKey(S.champion.s) + JSON.stringify(S.champion.s.exit)) description = c.description;
} catch (e) { /* no champion.json */ }
if (!description && S.champion) {
  const s = S.champion.s;
  description = `${s.dir === 'both' ? 'Long and short' : s.dir === 'long' ? 'Long only' : 'Short only'}. Triggers: ${s.triggers.map((r) => E.RULES[r.id].label).join(s.mode === 'all' ? ' and ' : ' or ')}${s.filters.length ? '; filters: ' + s.filters.map((r) => E.RULES[r.id].label).join(', ') : ''}. Stop ${s.exit.stop === 'atr' ? s.exit.mult + '× ATR' : s.exit.stop === 'pct' ? s.exit.pct + '%' : 'at the recent swing'}, target ${s.exit.rr}R${s.exit.be ? ', breakeven at +' + s.exit.be + 'R' : ''}${s.exit.trail ? ', trailing ' + s.exit.trail + '× ATR' : ''}${s.exit.maxBars ? ', time stop ' + s.exit.maxBars + ' bars' : ''}. Managed every minute.`;
}
const ch = S.champion ? { name: S.champion.name, tf: S.champion.tf, status: S.champion.status, since: S.champion.since, source: S.champion.source, description, lastCheck: S.champion.lastCheck || null, s: S.champion.s, evidence: S.champion.evidence ? JSON.parse(JSON.stringify(S.champion.evidence, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v))) : null } : null;
const pos = S.sim && S.sim.pos ? (({ dir, ep, stop, stop0, tp, d, qty, risk, et, rr, be }) => ({ dir, ep: r1(ep), stop: r1(stop), stop0: r1(stop0), tp: r1(tp), d, qty: +qty.toFixed(6), risk: +risk.toFixed(2), et, rr, be: !!be }))(S.sim.pos) : null;
const stats = Object.assign({}, S.stats || {}, { rejectsTotal: Object.values((S.stats && S.stats.rejects) || {}).reduce((a, b) => a + b, 0) });
const state = {
  syncedAt: now, updatedAt: S.updatedAt, venue: S.venue, paused: !!S.paused, stale: !!S.stale, cfg: S.cfg, stats, champion: ch, position: pos, thinking: S.thinking,
  leaderboard: (S.leaderboard || []).slice(0, 8).map((r) => ({ tf: r.tf, name: r.name, gate: { pass: !!(r.gate && r.gate.pass) }, val: slim(r.val), test: slim(r.test) })),
  thinks: (S.thinks || []).slice(-12).map((t) => ({ t: t.t, verdict: t.verdict })),
  errors: (S.errors || []).slice(-10), runs: (S.runs || []).slice(-5),
};
let eq = S.equity || [];
if (eq.length > 800) { const k = Math.ceil(eq.length / 800); eq = eq.filter((_, i) => i % k === 0 || i === eq.length - 1); }
const journal = {
  syncedAt: now,
  events: (S.events || []).slice(-150).map((e) => ({ t: e.t, type: e.type, text: e.text, R: e.R })),
  trades: (S.trades || []).slice(-200).map((t) => ({ et: t.et, xt: t.xt, dir: t.dir, ep: r1(t.ep), xp: r1(t.xp), R: +t.R.toFixed(3), pnl: +t.pnl.toFixed(2), reason: t.reason })),
  equity: eq,
};
// candles
const m1 = [];
const cdir = path.join(dir, 'candles');
if (fs.existsSync(cdir)) for (const f of fs.readdirSync(cdir).filter((x) => /\.csv$/.test(x)).sort().slice(-3)) for (const l of fs.readFileSync(path.join(cdir, f), 'utf8').split('\n')) { const p = l.split(','); if (/^\d/.test(p[0])) m1.push(p.map(Number)); }
const readHTF = (tf) => { const p = path.join(dir, `htf_${tf}.csv`); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => /^\d/.test(l)).map((l) => l.split(',').map(Number)) : []; };
function extend(rows, spanMin) {
  // append buckets built from 1m candles after the last stored higher-timeframe bar (closed or forming)
  const span = spanMin * 60, last = rows.length ? rows[rows.length - 1][0] : 0, outRows = rows.slice();
  let cur = null;
  for (const b of m1) {
    const bk = Math.floor(b[0] / span) * span;
    if (bk <= last) continue;
    if (!cur || cur[0] !== bk) { if (cur) outRows.push(cur); cur = [bk, b[1], b[2], b[3], b[4], b[5]]; } else { cur[2] = Math.max(cur[2], b[2]); cur[3] = Math.min(cur[3], b[3]); cur[4] = b[4]; cur[5] += b[5]; }
  }
  if (cur) outRows.push(cur);
  return outRows;
}
const pack = (rows) => ({ t: rows.map((r) => r[0]), o: rows.map((r) => r1(r[1])), h: rows.map((r) => r1(r[2])), l: rows.map((r) => r1(r[3])), c: rows.map((r) => r1(r[4])), v: rows.map((r) => r3(r[5])) });
const candles = { syncedAt: now, venue: S.venue, m1: pack(m1.slice(-1440)), h1: pack(extend(readHTF(60), 60).slice(-420)), h4: pack(extend(readHTF(240), 240).slice(-260)) };
fs.mkdirSync(out, { recursive: true });
for (const [k, v] of Object.entries({ state, journal, candles })) {
  const s = JSON.stringify(v);
  if (s.length > 250000) throw new Error(k + ' document too large: ' + s.length);
  fs.writeFileSync(path.join(out, k + '.json'), s);
  console.log(k, s.length, 'bytes');
}
