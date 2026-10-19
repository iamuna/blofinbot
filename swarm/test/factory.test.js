'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { tBar, backtestGate, shadowGate, demoteCheck } = require('../src/factory/gate');
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
