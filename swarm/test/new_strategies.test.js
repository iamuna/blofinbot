'use strict';
// dip-reversal and squeeze-ride (2026-10-20): they fire on the moves they are meant for, and not otherwise.
const test = require('node:test');
const assert = require('node:assert');
const { FeatureState } = require('../src/analysis/features');
const { StrategyHost } = require('../src/strategies/kit');
const strategies = require('../src/strategies');

const MIN = 60000, T0 = Date.UTC(2026, 4, 1);
function run(name, shape, oi) {
  const fs_ = new FeatureState({ tfs: [1, 5] }), host = new StrategyHost(strategies.byName[name], { fs: fs_ });
  let px = 100, seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const ideas = [];
  for (let k = 0; k < 1800; k++) {
    const t = T0 + k * MIN, step = shape(k);
    const o = px; px = px * Math.exp(step + rnd() * 0.0016);
    if (oi && k % 5 === 0) fs_.onOI('XYZ', t, oi(k), oi(k) * px);
    for (const ev of fs_.onBar1m('XYZ', { t, o, h: Math.max(o, px) * 1.0003, l: Math.min(o, px) * 0.9997, c: px, v: 10, q: 1e5, bq: 5e4, n: 10 })) ideas.push(...host.onEvent(ev));
  }
  return ideas;
}
const crash = (k) => (k >= 1700 && k < 1715 ? -0.002 : 0); // −3% in 15 minutes after a calm day
const pump = (k) => (k >= 1700 && k < 1715 ? 0.002 : 0);

test('dip-reversal: buys after an outsized 15-minute drop, with the stop one drop-length lower', () => {
  const ideas = run('dip-reversal', crash);
  assert.strictEqual(ideas.length, 1);
  const i = ideas[0];
  assert.strictEqual(i.side, 1); assert.strictEqual(i.timeStopMin, 60); assert.ok(i.t >= T0 + 1705 * MIN && i.t <= T0 + 1715 * MIN);
  assert.ok((i.entry.px - i.stop) / i.entry.px > 0.005, 'stop about one drop-length below (the drop so far, ≥ 1.5 ATR)');
  assert.strictEqual(run('dip-reversal', () => 0).length, 0, 'no idea on a calm day');
  assert.strictEqual(run('dip-reversal', pump).length, 0, 'no idea on a jump');
});

test('squeeze-ride: buys a jump only while open interest falls', () => {
  const falling = (k) => (k >= 1700 ? 1e6 * (1 - 0.002 * (k - 1700)) : 1e6);
  const rising = (k) => (k >= 1700 ? 1e6 * (1 + 0.002 * (k - 1700)) : 1e6);
  const ideas = run('squeeze-ride', pump, falling);
  assert.strictEqual(ideas.length, 1); assert.strictEqual(ideas[0].side, 1); assert.match(ideas[0].why, /open interest -/);
  assert.strictEqual(run('squeeze-ride', pump, rising).length, 0, 'jump with new longs coming in: not a squeeze');
  assert.strictEqual(run('squeeze-ride', pump).length, 0, 'no open-interest data: no idea');
  assert.strictEqual(run('squeeze-ride', crash, falling).length, 0);
});
