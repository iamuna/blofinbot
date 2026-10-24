'use strict';
// Strategies from Mitch Ray TA's videos (2026-10-23): mixing-bowl, fib-golden, abcd, wedge-break, ma-retest-plus.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { Ring, ATR } = require('../src/analysis/ta');
const { validIdea } = require('../src/strategies/kit');
const { checkPlugin, checkShape } = require('../src/factory/plugin_check');

const NEW = ['mixing_bowl', 'fib_golden', 'abcd', 'wedge_break', 'ma_retest_plus'];
const TF = 240, MS = TF * 60000;

// bars along straight lines between waypoints, `per` bars per unit of price; wick = 0.15 above/below the body
function walk(points, per = 1) {
  const bars = []; let t = Date.UTC(2025, 0, 1), prev = points[0];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k], n = Math.max(1, Math.round(Math.abs(b - a) * per));
    for (let i = 1; i <= n; i++) {
      const c = a + ((b - a) * i) / n;
      bars.push({ t, o: prev, h: Math.max(prev, c) + 0.15, l: Math.min(prev, c) - 0.15, c, v: 1, q: c });
      prev = c; t += MS;
    }
  }
  return bars;
}
// a sideways stretch first, so ATR, RSI and the averages are warm: n swings of ±1 around `at`
const chop = (at, n = 20) => Array.from({ length: n }, (_, k) => at + (k % 2 ? 1 : -1));
// feed bars to a plugin as the brain would (history ring includes the bar being closed); returns [{i, idea}]
function feed(plugin, bars, params, o = {}) {
  const h = new Ring(1000), atr = new ATR(14), states = new Map(), p = Object.assign({}, plugin.params, { tf: TF }, params), out = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]; h.push(bar);
    const a = atr.push(bar.h, bar.l, bar.c);
    const api = { p, now: bar.t + MS, hist: (c, tf) => (tf === TF ? h : o.htf ? o.htf(tf) : null), state: (c) => { if (!states.has(c)) states.set(c, {}); return states.get(c); } };
    const idea = plugin.onBar({ coin: 'X', tf: TF, t: bar.t, bar, f: { atr: a, bars: i + 1 } }, api);
    if (idea) { out.push({ i, idea }); if (o.close) plugin.onClose('X', { exitT: bar.t + MS, idea: { tf: TF } }, { p, state: api.state }); }
  }
  return out;
}

test('video strategies: pass the plugin check, have the kit shape and are registered', () => {
  const idx = require('../src/strategies');
  for (const f of NEW) {
    const src = fs.readFileSync(path.join(__dirname, '../src/strategies', `${f}.js`), 'utf8');
    assert.deepStrictEqual(checkPlugin(src).problems, [], f);
    assert.deepStrictEqual(checkShape(require(`../src/strategies/${f}`)), [], f);
  }
  for (const n of ['mixing-bowl', 'fib-golden', 'abcd', 'wedge-break', 'ma-retest-plus']) assert.ok(idx.byName[n], `${n} loaded`);
  assert.deepStrictEqual(idx.rejected, []);
});

test('ma-retest-plus with every switch off trades exactly like ma-21-200', () => {
  const plus = require('../src/strategies/ma_retest_plus'), base = require('../src/strategies/ma_21_200');
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pts = [100]; for (let k = 0; k < 160; k++) pts.push(Math.max(20, pts[pts.length - 1] + (rnd() - 0.48) * 12));
  const bars = walk(pts, 1.5);
  for (const mode of ['retest', 'pullback']) {
    const a = feed(base, bars, { mode }, { close: true }).map((x) => [x.i, x.idea.side, x.idea.stop, x.idea.target]);
    const b = feed(plus, bars, { mode }, { close: true }).map((x) => [x.i, x.idea.side, x.idea.stop, x.idea.target]);
    assert.ok(a.length > 3, `${mode}: some ideas (${a.length})`);
    assert.deepStrictEqual(b, a, mode);
  }
});

test('ma-retest-plus golden zone: a shallow retest is skipped, a golden-zone retest is taken', () => {
  const plus = require('../src/strategies/ma_retest_plus');
  // a long base, a cross up, an impulse to 160, then a pull-back to the EMA: shallow (to ~150) or deep (to ~130)
    // 160 bars of chop, an impulse 100 → 160, a pull-back to `low`, a new high; only ideas after the impulse count
  const path = (low) => walk(chop(100, 80).concat([100, 160, low, 175]), 1);
  const longs = (low, extra) => feed(plus, path(low), Object.assign({ mode: 'pullback', slow: 150, fast: 10, fibLook: 100 }, extra)).map((x) => x.idea).filter((i) => i.side > 0 && i.entry.px > 120);
  const all = (low) => longs(low, {});
  const zoneOf = (low) => longs(low, { zone: [0.382, null] });
  assert.ok(all(145).length >= 1 && all(128).length >= 1, 'both retests trade without the switch');
  assert.strictEqual(zoneOf(145).length, 0, 'a ~25% pull-back is skipped');
  const deep = zoneOf(128);
  assert.strictEqual(deep.length, 1, 'a ~53% pull-back is taken');
  assert.match(deep[0].why, /pull-back \d+%/);
  assert.strictEqual(validIdea(deep[0]), null);
});

test('fib-golden: higher highs and lows, a pull-back into the golden zone and an up-close → long, stop past 78.6%, target 1.272', () => {
  const fg = require('../src/strategies/fib_golden');
  // swings 100 → 120 → 110 → 140, then back to ~125 (50% of 110→140) and up
  const bars = walk(chop(100).concat([100, 120, 110, 140, 125, 128, 126, 135]), 1);
  const ideas = feed(fg, bars, {}).map((x) => x.idea);
  assert.strictEqual(ideas.length, 1, JSON.stringify(ideas.map((i) => i.why)));
  const i = ideas[0];
  assert.strictEqual(i.side, 1);
  assert.ok(Math.abs(i.target - (110 + 1.272 * 30.15)) < 1, `target ${i.target}`);
  assert.ok(i.stop < 140.15 - 0.786 * 30.3 && i.stop > 140.15 - 0.886 * 30.3, `stop ${i.stop}`);
  assert.strictEqual(validIdea(i), null);
  // the same pull-back after a lower high: no trend, no trade
  assert.strictEqual(feed(fg, walk(chop(100).concat([100, 120, 110, 118, 112, 114, 113, 120]), 1), {}).length, 0);
});

test('abcd: bearish AB=CD with a turn and RSI lower than at B → short, stop past the 1.618, target 50% of A→D', () => {
  const ab = require('../src/strategies/abcd');
  // A 100 → B 130 → C 111.4 (62% of AB) → D ~135 (1.272 of BC), slower so RSI is lower, then turn down
  const bars = walk(chop(105).concat([105, 100, 130, 111.4]), 1).concat(walk([111.4, 135.5, 134, 133.5], 0.6).slice(1));
  let t = bars[0].t; for (const b of bars) { b.t = t; t += MS; }
  const ideas = feed(ab, bars, { needDiv: false }).map((x) => x.idea);
  assert.ok(ideas.length >= 1, 'an idea');
  const i = ideas[0];
  assert.strictEqual(i.side, -1);
  const D2 = 111.4 + 1.618 * (130 - 111.4);
  assert.ok(i.stop > D2 && i.stop < D2 + 3, `stop ${i.stop} vs D2 ${D2}`);
  assert.ok(i.target < i.entry.px && i.target > 100, `target ${i.target}`);
  assert.strictEqual(validIdea(i), null);
});

test('wedge-break: a falling wedge closed above its upper line → long, stop under the wedge, target 50% of it', () => {
  const wb = require('../src/strategies/wedge_break');
  // lower highs 150 > 140 > 133, lower lows 120 > 115 > 112 (highs fall faster), then a break up
  const bars = walk(chop(130, 40).concat([130, 150, 120, 140, 115, 133, 112, 140]), 1);
  const ideas = feed(wb, bars, { needDiv: false, minRR: 0, maxSpan: 200, maxAfter: 20 }).map((x) => x.idea);
  assert.strictEqual(ideas.length, 1, JSON.stringify(ideas.map((i) => i.why)));
  const i = ideas[0];
  assert.strictEqual(i.side, 1);
  assert.ok(i.stop < 111.85, `stop ${i.stop}`);
  assert.ok(Math.abs(i.target - (111.85 + 0.5 * (150.15 - 111.85))) < 0.5, `target ${i.target}`);
  assert.strictEqual(validIdea(i), null);
});

test('mixing-bowl: a double bottom at old support with RSI divergence → long; one ingredient alone is not enough', () => {
  const mb = require('../src/strategies/mixing_bowl');
  // chop around 100 (support), a rally to 140, a fast drop to 100.5, a bounce, a slow drift to 100 (higher RSI)
  const pts = chop(120, 30).concat([120, 101, 112, 100, 110, 101, 140, 100.5, 115]);
  const bars = walk(pts, 1).concat(walk([115, 100.2, 108, 112], 0.4).slice(1));
  let t = bars[0].t; for (const b of bars) { b.t = t; t += MS; }
  const ideas = feed(mb, bars, { htf: 0, minScore: 3, minBars: 20, minRR: 1 }).map((x) => x.idea).filter((i) => i.side > 0);
  assert.ok(ideas.length >= 1, 'an idea');
  const i = ideas[ideas.length - 1];
  assert.match(i.why, /RSI div|MACD div/);
  assert.match(i.why, /S\/R|double bottom/);
  assert.ok(i.stop < 100, `stop ${i.stop} below the lows`);
  assert.strictEqual(validIdea(i), null);
  assert.strictEqual(feed(mb, bars, { htf: 0, minScore: 7, minBars: 20 }).length, 0, 'score 7 of 5 possible: nothing');
});
