'use strict';
const test = require('node:test');
const assert = require('node:assert');
const pm = require('../src/strategies/pivot_matrix');

// feeds 1h bars (closes; high/low ±0.5) to the plugin; returns the ideas and the state
function run(closes, extra = {}, shapes = {}) {
  const states = new Map(), p = Object.assign({}, pm.params, { htf: 240 }, extra), out = [];
  let t = 0, prev = null;
  closes.forEach((c, k) => {
    t += 3600000;
    const [o, h, l] = shapes[k] || [prev == null ? c : prev, c + 0.5, c - 0.5];
    const r = pm.onBar({ coin: 'X', tf: 60, t, bar: { t, o, h, l, c }, f: {} }, { p, now: t + 3600000, hist: () => null, state: (x) => { if (!states.has(x)) states.set(x, {}); return states.get(x); } });
    if (r) out.push(Object.assign({ k }, r));
    prev = c;
  });
  return { out, s: states.get('X').m };
}
const up = (a, b) => { const r = []; for (let x = a; x <= b; x += 2) r.push(x); return r; };
const down = (a, b) => { const r = []; for (let x = a; x >= b; x -= 2) r.push(x); return r; };
// a swing: rise to 110 (high 110.5), fall to 100 (low 99.5), then rise again
const swing = [...up(100, 110), ...down(108, 100), ...up(102, 108)];

test('pivot-matrix: a swing pivot is known only f bars after it (no repaint); a swing smaller than zz ATR is ignored', () => {
  const peak = up(100, 110).length - 1;
  assert.strictEqual(run(swing.slice(0, peak + 2)).s.H, null, 'one bar after the high: not confirmed yet');
  assert.strictEqual(run(swing.slice(0, peak + 3)).s.H, 110.5, 'f = 2 bars after the high: confirmed');
  const r = run(swing);
  assert.deepStrictEqual([r.s.H, r.s.L], [110.5, 99.5]);
  // a dip of 1.4 from the high, with an ATR of ~1.5: not a swing at zz 1.5
  const small = run([...up(100, 110), 109.8, 109.6, 109.8, 110.2, 111, 112]);
  assert.ok(small.s.atr * 1.5 > 110.5 - 109.1);
  assert.strictEqual(small.s.L, null);
});

test('pivot-matrix: break of structure → long at the close; stop under the swing low; no target above → trail and time stop', () => {
  const r = run([...swing, 110, 112], { minHtfBars: 1e9 }); // bias not formed yet: both sides allowed
  assert.strictEqual(r.out.length, 1);
  const i = r.out[0];
  assert.strictEqual(i.k, swing.length + 1, 'the close above 110.5 + 0.1 ATR');
  assert.strictEqual(i.side, 1); assert.match(i.why, /break of structure above 110\.5/);
  assert.strictEqual(i.entry.kind, 'taker'); assert.strictEqual(i.entry.px, 112);
  assert.ok(Math.abs(i.stop - (99.5 - 0.5 * r.s.atr)) < 1e-9 || i.stop < 99.5, 'stop under the swing low');
  assert.strictEqual(i.target, null);
  assert.ok(i.trail.dist > 0 && i.timeStopMin === pm.params.holdBars * 60);
});

test('pivot-matrix: the higher-timeframe bias blocks a break of structure against it, and only closed higher-timeframe bars count', () => {
  const fall = []; for (let x = 300; x > 100; x -= 1) fall.push(x);
  const r = run([...fall, ...swing, 110, 112], { minHtfBars: 1 });
  assert.ok(r.s.ef < r.s.es, 'down bias after a long fall');
  assert.ok(!r.out.some((i) => i.side === 1 && /break of structure/.test(i.why)), 'no long break against a down bias');
});

test('pivot-matrix: a sweep above the swing high that closes back under it on a down bar → short, stop over the sweep', () => {
  const pre = [...swing, 108];
  const k = pre.length;
  const r = run([...pre, 109.5], { minHtfBars: 1e9 }, { [k]: [110, 111.5, 109] });
  const i = r.out.find((x) => x.k === k);
  assert.ok(i, 'a sweep short'); assert.strictEqual(i.side, -1); assert.match(i.why, /sweep below 110\.5/);
  assert.ok(Math.abs(i.stop - (111.5 + 0.75 * r.s.atr)) < 1e-9);
  assert.ok(i.target == null || i.target < 109.5);
  // the same shape on an up bar is not a sweep
  const r2 = run([...pre, 110.8], { minHtfBars: 1e9 }, { [k]: [109, 111.5, 108.8] });
  assert.ok(!r2.out.some((x) => x.k === k && x.side === -1));
});
