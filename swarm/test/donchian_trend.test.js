'use strict';
// donchian-trend: one component of the retired trend bot's ensemble, as a swarm trade.
const test = require('node:test');
const assert = require('node:assert');
const plugin = require('../src/strategies/donchian_trend');
const { Ring } = require('../src/analysis/ta');
const { validIdea } = require('../src/strategies/kit');

const DAY = 86400000;
// closes 100..109 over 10 days (channel hi 109, lo 100), then the bar under test
function rig(params, includeCurrent, close) {
  const h = new Ring(400), t0 = Date.UTC(2026, 0, 1);
  for (let k = 0; k < 10; k++) h.push({ t: t0 + k * DAY, o: 100 + k, h: 100 + k, l: 100 + k, c: 100 + k });
  const bar = { t: t0 + 10 * DAY, o: 109, h: Math.max(109, close), l: Math.min(109, close), c: close };
  if (includeCurrent) h.push(bar);
  const states = new Map(), p = Object.assign({}, plugin.params, { tf: 1440, look: 10 }, params);
  const api = { p, now: bar.t + DAY, hist: () => h, state: (c) => { if (!states.has(c)) states.set(c, {}); return states.get(c); } };
  return plugin.onBar({ coin: 'BTC', tf: 1440, t: bar.t, bar, f: { atr: 2 } }, api);
}

test('donchian-trend: a close above the channel goes long, stop at the midpoint, trailing by half the width', () => {
  for (const inc of [false, true]) {
    const i = rig({}, inc, 112);
    assert.ok(i, `idea (history ${inc ? 'with' : 'without'} the current bar)`);
    assert.deepStrictEqual([i.side, i.stop, i.trail.dist, i.trail.afterR, i.target], [1, 104.5, 4.5, 0, null]);
    assert.strictEqual(i.timeStopMin, 40 * 1440, 'time stop 4 × look bars');
    assert.strictEqual(validIdea(i), null);
  }
});

test('donchian-trend: inside the channel nothing; below it short, or nothing when long only', () => {
  assert.strictEqual(rig({}, false, 105), null);
  const s = rig({}, false, 98);
  assert.deepStrictEqual([s.side, s.stop], [-1, 104.5]);
  assert.strictEqual(validIdea(s), null);
  assert.strictEqual(rig({ shorts: false }, false, 98), null);
  assert.strictEqual(rig({ tf: 720 }, false, 112), null, 'only its own timeframe');
  assert.strictEqual(rig({ look: 30 }, false, 112), null, 'not before `look` bars of history');
});
