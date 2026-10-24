'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { tBar, backtestGate, shadowGate, oosGate, demoteCheck } = require('../src/factory/gate');
const { decide } = require('../src/factory/promote');
const { review } = require('../src/tools/review');
const { tmpDir } = require('./helpers');

const bt = (o) => Object.assign({ all: { n: 500, avgR: 0.12, tStat: 3.1, maxDDR: 20 }, cost15: { avgR: 0.08 }, thirds: [{ sumR: 10, avgR: 0.06 }, { sumR: 25, avgR: 0.15 }, { sumR: 20, avgR: 0.12 }] }, o);

test('gate: the t-stat bar rises with the number of tries', () => {
  assert.strictEqual(tBar(1), 2); assert.strictEqual(tBar(10), 2.5); assert.strictEqual(tBar(100), 3);
  assert.strictEqual(backtestGate(bt(), 10).pass, true);
  const g = backtestGate(bt(), 1000);
  assert.strictEqual(g.pass, false); assert.match(g.why[0], /t 3.1 < 3.50/);
  assert.match(backtestGate(bt({ cost15: { avgR: -0.01 } }), 1).why.join(), /1.5× costs/);
  assert.match(backtestGate(bt({ thirds: [{ sumR: -1 }, { sumR: -2 }, { sumR: 5, avgR: 0.1 }] }), 1).why.join(), /2 of 3/);
});

test('gate: shadow must look like the backtest; live promotions are Ibrahim\'s', () => {
  const ok = shadowGate({ days: 4, ideas: 200, rs: Array.from({ length: 60 }, (_, k) => (k % 2 ? 1.2 : -1)) }, bt(), 'paper');
  assert.strictEqual(ok.pass, true);
  const bad = shadowGate({ days: 4, ideas: 200, rs: Array.from({ length: 200 }, (_, k) => (k % 3 ? -1 : 1)) }, bt(), 'paper');
  assert.match(bad.why.join(), /worse by more than 2 standard errors/);
  assert.match(shadowGate({ days: 4, ideas: 200, rs: [] }, bt(), 'live').why.join(), /only Ibrahim/);
  assert.strictEqual(demoteCheck(Array.from({ length: 120 }, (_, k) => (k % 3 ? -1 : 1)), bt()).demote, true);
  assert.strictEqual(demoteCheck(Array.from({ length: 50 }, () => -1), bt()).demote, false, 'judged only after 100 trades');
});

test('gate: out-of-sample route — a strategy that missed the multiple-testing bar can earn trade on its live record', () => {
  const weakBt = bt({ all: { n: 700, avgR: 0.14, tStat: 2.52, maxDDR: 20 } });
  assert.strictEqual(backtestGate(weakBt, 29).pass, false, 'best of 29 tries: t 2.52 < 2.73');
  const live = (n, win) => Array.from({ length: n }, (_, k) => (k % 10 < win ? 1.4 : -1));
  assert.strictEqual(oosGate({ rs: live(160, 6) }, weakBt, 'paper').pass, true, '160 trades, 60% at +1.4R / 40% at −1R: t ≈ 4.5');
  assert.match(oosGate({ rs: live(100, 6) }, weakBt, 'paper').why.join(), /needs 150/);
  assert.match(oosGate({ rs: live(200, 4) }, weakBt, 'paper').why.join(), /> 0 R and t ≥ 2/);
  assert.match(oosGate({ rs: live(200, 6) }, bt({ cost15: { avgR: -0.02 } }), 'paper').why.join(), /1.5× costs/);
  assert.match(oosGate({ rs: live(200, 6) }, weakBt, 'live').why.join(), /only Ibrahim/);
  // only the current version's shadow trades count
  const now = Date.UTC(2026, 10, 30);
  // trades spread over the days (the route judges the daily-clustered t: 200 trades closing on one day are one bet)
  const shadow = live(200, 6).map((r, k) => ({ strategy: 'it', ph: k < 100 ? 'old' : 'new', entryT: now - 30 * 86400000 + k * 3600000, exitT: now - 30 * 86400000 + k * 3600000 + 3600000, r }));
  const latest = { tries: 29, results: { it: Object.assign(weakBt, { ph: 'new' }) } };
  assert.strictEqual(decide({ latest, state: {}, shadow, trades: [], ideas: [], now })[0].to, 'shadow', '100 trades of the new version are not enough');
  for (const t of shadow) t.ph = 'new';
  assert.strictEqual(decide({ latest, state: {}, shadow, trades: [], ideas: [], now })[0].to, 'trade');
  for (const t of shadow) t.exitT = now - 86400000;
  assert.strictEqual(decide({ latest, state: {}, shadow, trades: [], ideas: [], now })[0].to, 'shadow', 'the same 200 trades closing on one day are one bet');
});

test('promotion: decisions from factory results and live state', () => {
  const now = Date.UTC(2026, 9, 25);
  const shadow = Array.from({ length: 40 }, (_, k) => ({ strategy: 'good', entryT: now - 5 * 86400000 + k * 1000, exitT: now - 86400000, r: k % 2 ? 1.3 : -1 }));
  const ideas = Array.from({ length: 160 }, (_, k) => ({ strategy: 'good', t: now - 4 * 86400000 + k }));
  const trades = Array.from({ length: 110 }, (_, k) => ({ strategies: [{ name: 'tired' }], r: k % 3 ? -1 : 1 }));
  const ds = decide({ latest: { tries: 10, results: { good: bt(), weak: bt({ all: { n: 100, avgR: 0.01, tStat: 0.2 } }), tired: bt() } }, state: { account: { mode: 'paper' }, strategyModes: { tired: 'trade' } }, shadow, trades, ideas, now });
  const by = Object.fromEntries(ds.map((d) => [d.name, d]));
  assert.strictEqual(by.good.to, 'trade'); assert.strictEqual(by.weak.to, 'shadow'); assert.strictEqual(by.tired.to, 'shadow');
});

test('review: report cards and flags from the published state', () => {
  const d = tmpDir('rev'), now = Date.UTC(2026, 9, 25);
  fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify({ account: { mode: 'paper', equity: 10050, dd: 0.01 }, risk: { mode: 'normal' }, agents: { 'strategy:a': { status: 'ok', at: now - 60000, startedAt: now - 9 * 86400000, metrics: { mode: 'shadow', errors: 0 } }, brain: { status: 'degraded', why: 'warm-up failed', at: now - 120000 }, trader: { status: 'ok', at: now - 3600000 } } }));
  fs.writeFileSync(path.join(d, 'shadow.jsonl'), '');
  const r = review(d, { now });
  assert.match(r.markdown, /\| a \| shadow \|/);
  assert.ok(r.flags.some((f) => /a: no ideas in 7 days/.test(f)));
  assert.ok(r.flags.some((f) => /trader: silent for 60 min/.test(f)));
  assert.ok(r.flags.some((f) => /brain: degraded/.test(f)));
});

test('live gate: only a strong, long demo record is ready for real money', () => {
  const { judge } = require('../src/factory/live_gate');
  const { logTries } = require('../src/factory/log_tries');
  const mk = (n, win, o = {}) => Array.from({ length: n }, (_, k) => Object.assign({ account: 'demo', strategies: [{ name: 'it' }], exitT: k, qty: 1, entry: 100, feeUsd: 0.08, fundUsd: 0.01, r: k % 10 < win ? 1.4 : -1 }, o));
  const btRow = { all: { maxDDR: 15, avgCostBps: 9 } };
  const ok = judge('it', mk(220, 6), btRow);
  assert.strictEqual(ok.ready, true, ok.why.join('; '));
  assert.match(judge('it', mk(150, 6), btRow).why.join(), /150 demo trades/);
  assert.match(judge('it', mk(220, 4), btRow).why.join(), /need > 0 and t ≥ 2/);
  assert.match(judge('it', mk(220, 6, { feeUsd: 0.2 }), btRow).why.join(), /1.5× the backtest/);
  assert.strictEqual(judge('it', mk(220, 6, { account: 'paper' }), btRow).trades, 0, 'paper trades do not count');
  // tries logged outside the factory raise the count once each
  const d = tmpDir('tries');
  assert.deepStrictEqual(logTries(d, [{ name: 'a', base: 'x' }, { name: 'b', base: 'x', params: { k: 1 } }], 'n'), { added: 2, total: 2 });
  assert.deepStrictEqual(logTries(d, [{ name: 'a', base: 'x' }, { name: 'c', base: 'y' }], 'n'), { added: 1, total: 3 });
});

test('agent manager: retires only decisively negative strategies on its own; the rest are proposals', () => {
  const { propose, apply } = require('../src/tools/agent_manager');
  const now = Date.UTC(2026, 10, 1);
  const cfg = { strategies: { bad: { enabled: true, mode: 'shadow' }, meh: { enabled: true, mode: 'shadow' }, rescued: { enabled: true, mode: 'shadow' }, live: { enabled: true, mode: 'shadow' }, ghost: { enabled: true, mode: 'shadow' } } };
  const latest = { bad: { ph: 'b', all: { n: 5000, avgR: -0.3, tStat: -20 } }, meh: { ph: 'm', all: { n: 900, avgR: -0.02, tStat: -0.8 } }, rescued: { ph: 'r', all: { n: 900, avgR: -0.1, tStat: -4 } }, live: { ph: 'l', all: { n: 900, avgR: -0.1, tStat: -4 } } };
  const shadow = Array.from({ length: 120 }, (_, k) => ({ strategy: 'rescued', ph: 'r', r: k % 2 ? 1.2 : -1 }));
  const ps = propose({ cfg, latest, state: { strategyModes: { live: 'trade' } }, shadow, ideas: [], flags: ['strategy:meh: 3 errors', 'trader: silent for 60 min'], now });
  const by = (k, n) => ps.filter((p) => p.kind === k && (p.strategy === n || p.agent === n));
  assert.strictEqual(by('retire', 'bad')[0].auto, true);
  assert.strictEqual(by('retire', 'meh').length, 0, 'mildly negative: kept in shadow');
  assert.strictEqual(by('retire', 'rescued').length, 0, 'its live record disagrees with the backtest');
  assert.strictEqual(by('retire', 'live').length, 0, 'never retire a strategy that is trading');
  assert.strictEqual(by('retire', 'ghost')[0].auto, false, 'no evidence either way: proposal only');
  assert.strictEqual(by('fix', 'meh').length, 1); assert.strictEqual(by('fix', 'trader').length, 1);
  const f = path.join(tmpDir('am'), 'swarm.json'); fs.writeFileSync(f, JSON.stringify(cfg));
  assert.deepStrictEqual(apply(f, ps), ['bad']);
  const after = JSON.parse(fs.readFileSync(f, 'utf8')).strategies;
  assert.strictEqual(after.bad.enabled, false); assert.match(after.bad.retired, /decisively negative/); assert.strictEqual(after.ghost.enabled, true);
});
