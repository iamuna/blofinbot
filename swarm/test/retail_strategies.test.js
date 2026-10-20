'use strict';
// The retail strategies Ibrahim asked to test: harmonic patterns (Carney) and RSI + MACD.
const test = require('node:test');
const assert = require('node:assert');
const harmonic = require('../src/strategies/harmonic');
const rsiMacd = require('../src/strategies/rsi_macd');

function runner(plugin, params) {
  const states = new Map(), p = Object.assign({}, plugin.params, params), out = [];
  let t = 0;
  const step = (px, tf) => {
    t += tf * 60000;
    const ev = { coin: 'X', tf, t, bar: { o: px, h: px, l: px, c: px }, f: { atr: 0.5, bars: 500 } };
    const api = { p, now: t + tf * 60000, state: (c) => { if (!states.has(c)) states.set(c, {}); return states.get(c); } };
    const r = plugin.onBar(ev, api); if (r) out.push(r);
  };
  return { step, out };
}
const path = (pts, stepSize) => { const a = []; for (let i = 1; i < pts.length; i++) { const n = Math.max(1, Math.round(Math.abs(pts[i] - pts[i - 1]) / stepSize)); for (let k = 1; k <= n; k++) a.push(pts[i - 1] + (pts[i] - pts[i - 1]) * k / n); } return a; };

test('harmonic: a bullish Bat puts a buy limit at 0.886 of XA, stop below, target 0.382 of AD', () => {
  const r = runner(harmonic, { tf: 15 });
  // X 100 → A 110 → B 105.5 (0.45 XA) → C 108.5 (0.67 AB) → falling towards D
  for (const px of path([104, 100, 110, 105.5, 108.5, 106], 0.25)) r.step(px, 15);
  assert.strictEqual(r.out.length, 1);
  const i = r.out[0];
  assert.strictEqual(i.side, 1); assert.match(i.why, /bullish bat/);
  assert.ok(Math.abs(i.entry.px - 101.14) < 1e-9, String(i.entry.px));
  assert.ok(i.stop < i.entry.px && i.target > i.entry.px);
  assert.ok(Math.abs(i.target - (101.14 + 0.382 * (110 - 101.14))) < 1e-9);
});

test('harmonic: no pattern when the ratios do not fit', () => {
  const r = runner(harmonic, { tf: 15 });
  for (const px of path([104, 100, 110, 101, 109.8, 106], 0.25)) r.step(px, 15); // B 0.9 XA: none of the four
  assert.strictEqual(r.out.length, 0);
});

test('rsi-macd: an oversold dip followed by a MACD turn up gives a long', () => {
  const r = runner(rsiMacd, { tf: 15, minBars: 30 });
  for (const px of path([100, 100.5, 99.8, 100.4, 100, 92, 91.5, 94], 0.2)) r.step(px, 15);
  assert.ok(r.out.length >= 1);
  assert.strictEqual(r.out[0].side, 1); assert.match(r.out[0].why, /MACD cross up/);
});

test('harmonic confirm mode: no order at D; buys only after price touches D and turns back up', () => {
  const r = runner(harmonic, { tf: 15, confirmAtr: 1, waitBars: 48 });
  for (const px of path([104, 100, 110, 105.5, 108.5, 101.5], 0.25)) r.step(px, 15); // not at D (101.14) yet
  assert.strictEqual(r.out.length, 0);
  for (const px of path([101.5, 100.9, 101.6], 0.1)) r.step(px, 15);
  assert.strictEqual(r.out.length, 1);
  const i = r.out[0];
  assert.strictEqual(i.side, 1); assert.match(i.why, /confirmed/);
  assert.ok(i.entry.px >= 100.9 + 0.5 - 1e-9 && i.stop < 100.9);
  const r2 = runner(harmonic, { tf: 15, confirmAtr: 1, waitBars: 48 }); // straight through the stop: nothing
  for (const px of path([104, 100, 110, 105.5, 108.5, 99, 101], 0.25)) r2.step(px, 15);
  assert.strictEqual(r2.out.length, 0);
});

const ma = require('../src/strategies/ma_21_200');
test('ma-21-200 retest: after the 21 crosses above the 200, a pull-back to the 21 that holds gives a long', () => {
  const r = runner(ma, { tf: 15, slow: 50, fast: 10, holdBars: 10 });
  for (const px of path([110, 100], 0.05)) r.step(px, 15);           // a long fall: fast below slow
  for (const px of path([100, 108], 0.3)) r.step(px, 15);            // rally: the fast line crosses above
  const before = r.out.length;
  for (const px of path([108, 106, 108], 0.1)) r.step(px, 15);       // pull back to the fast line and turn up
  assert.ok(r.out.length > before, 'a long after the retest');
  const i = r.out[r.out.length - 1];
  assert.strictEqual(i.side, 1); assert.match(i.why, /retest/); assert.ok(i.stop < i.entry.px && i.target > i.entry.px);
});
