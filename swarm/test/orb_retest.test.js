'use strict';
// orb-retest (2026-10-23): a synthetic New York morning — a double top at 101 before the open, a 100.1–100.6
// opening range, a 5m close at 101.5, a pullback to 101 and a rally — run through features, host and ExecSim.
const test = require('node:test');
const assert = require('node:assert');
const { FeatureState } = require('../src/analysis/features');
const { StrategyHost } = require('../src/strategies/kit');
const { ExecSim } = require('../src/backtest/exec_sim');
const strategies = require('../src/strategies');

const MIN = 60000;
const lerp = (r, r0, r1, a, b) => a + ((b - a) * (r - r0)) / (r1 - r0);
// price at minute r from 9:30 New York
function morning(r, breakout) {
  if (r < -210) return 100 + 0.3 * Math.sin((2 * Math.PI * r) / 120);
  if (r < -180) return lerp(r, -210, -180, 100.3, 101);
  if (r < -150) return lerp(r, -180, -150, 101, 100.3);
  if (r < -120) return lerp(r, -150, -120, 100.3, 101);
  if (r < -90) return lerp(r, -120, -90, 101, 100.3);
  if (r < 0) return 100.3;
  if (r < 15) return [100.6, 100.1, 100.35][r % 3];
  if (!breakout || r < 20) return 100.4;
  if (r < 25) return lerp(r, 19, 24, 100.4, 101.5);
  if (r < 50) return lerp(r, 24, 49, 101.5, 100.95);
  if (r < 120) return lerp(r, 49, 119, 100.95, 104);
  return 104;
}
// day0 = 00:00 UTC of the day; open = 9:30 New York in UTC minutes (13:30 in summer, 14:30 in winter)
function run({ day0, open, breakout = true, params }) {
  const fs_ = new FeatureState({ tfs: [1, 5] }), host = new StrategyHost(strategies.byName['orb-retest'], { fs: fs_, params });
  const sim = new ExecSim({ onClose: (i, res) => host.onClose(i.coin, i.id, res) });
  const ideas = [];
  let px = 100;
  for (let k = 0; k < open + 200; k++) {
    const t = day0 + k * MIN, o = px;
    px = morning(k - open, breakout);
    const bar = { t, o, h: Math.max(o, px) * 1.0002, l: Math.min(o, px) * 0.9998, c: px, v: 10, q: 1e5, bq: 5e4, n: 10 };
    sim.onBar('XYZ', bar);
    for (const ev of fs_.onBar1m('XYZ', bar)) for (const i of host.onEvent(ev)) { ideas.push(i); sim.submit(i); }
  }
  return { ideas, trades: sim.trades };
}

test('orb-retest: buys the retest of the flip zone after a close above the opening range', () => {
  const day0 = Date.UTC(2026, 4, 4), { ideas, trades } = run({ day0, open: 810 });
  assert.strictEqual(ideas.length, 1);
  const i = ideas[0];
  assert.strictEqual(i.side, 1);
  assert.strictEqual(i.t, day0 + (810 + 25) * MIN, 'decided at the close of the 9:50 bar');
  assert.match(i.why, /flip zone/);
  assert.ok(Math.abs(i.entry.px - 101) < 0.05, `limit at the double top, got ${i.entry.px}`);
  assert.ok(i.stop < 100.1 && i.stop > 99.9, `stop below the range low, got ${i.stop}`);
  assert.ok(Math.abs(i.target - (i.entry.px + 2 * (i.entry.px - i.stop))) < 1e-9, '2R target');
  assert.strictEqual(i.entry.kind, 'maker'); assert.strictEqual(i.entry.fallback, 'cancel');
  assert.strictEqual(i.entry.waitMin, 125, 'the order waits until 12:00');
  assert.strictEqual(i.timeStopMin, 360, 'held until about 15:55');
  assert.strictEqual(trades.length, 1);
  assert.strictEqual(trades[0].reason, 'target'); assert.strictEqual(trades[0].entryKind, 'maker');
  assert.ok(trades[0].r > 1.5, `about +2R after costs, got ${trades[0].r}`);
});

test('orb-retest: follows New York time through daylight saving', () => {
  const day0 = Date.UTC(2026, 0, 12), { ideas } = run({ day0, open: 870 });
  assert.strictEqual(ideas.length, 1);
  assert.strictEqual(ideas[0].t, day0 + (870 + 25) * MIN, '9:50 New York is 14:50 UTC in January');
  for (const i of run({ day0, open: 810 }).ideas) assert.ok(i.t >= day0 + (870 + 20) * MIN, 'the same morning an hour early: its 13:30 UTC "open" is not the range');
});

test('orb-retest: no break, no idea; range-edge setting rests the limit at the range high', () => {
  assert.strictEqual(run({ day0: Date.UTC(2026, 4, 4), open: 810, breakout: false }).ideas.length, 0);
  const { ideas } = run({ day0: Date.UTC(2026, 4, 4), open: 810, params: { level: 'edge' } });
  assert.strictEqual(ideas.length, 1);
  assert.match(ideas[0].why, /range edge/);
  assert.ok(Math.abs(ideas[0].entry.px - 100.6 * 1.0002) < 1e-6, `limit at the range high, got ${ideas[0].entry.px}`);
});
