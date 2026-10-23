'use strict';
// oi-flush: after open interest falls hard while price moves hard, enter against the move once a bar turns.
const test = require('node:test');
const assert = require('node:assert');
const plugin = require('../src/strategies/oi_flush');

function runner(params) {
  const states = new Map(), p = Object.assign({}, plugin.params, params), out = [];
  const ctx = { oi: { last: null } };
  let t = 0;
  const step = (bar, oi, tf = p.tf, stale = false) => {
    t += tf * 60000;
    const now = t + tf * 60000;
    ctx.oi.last = oi == null ? null : { t: stale ? now - 60 * 60000 : now - 60000, oi };
    const ev = { coin: 'X', tf, t, bar, f: { atr: 2, bars: 500 } };
    const api = { p, now, ctx: () => ctx, state: (c) => { if (!states.has(c)) states.set(c, {}); return states.get(c); } };
    const r = plugin.onBar(ev, api); if (r) out.push(r);
    return r;
  };
  return { step, out, p, states };
}
const flat = (c) => ({ o: c, h: c + 1, l: c - 1, c });

// 72h of 12h bars = 6 bars of lookback
function flush(r, dir = -1) {
  for (let i = 0; i < 6; i++) assert.strictEqual(r.step(flat(100), 1000), null);
  // price −10 (5 ATR) and open interest −20% over 72h: the flush bar arms but does not enter
  return r.step({ o: 100, h: 100, l: dir < 0 ? 88 : 100, c: 100 + dir * 10 }, 800);
}

test('oi-flush: long flush arms, the next bar closing above the previous high enters long, stop under the flush low', () => {
  const r = runner({});
  assert.strictEqual(flush(r, -1), null);
  const i = r.step({ o: 90, h: 92, l: 89, c: 91.5 }, 790);
  assert.strictEqual(i, null, 'close 91.5 is not above the flush bar high 100');
  const j = r.step({ o: 91.5, h: 94, l: 91, c: 93 }, 785); // above the previous bar's high 92
  assert.ok(j, 'expected a long');
  assert.strictEqual(j.side, 1);
  assert.strictEqual(j.target, null);
  assert.ok(Math.abs(j.stop - (88 - 0.5 * 2)) < 1e-9, String(j.stop));
  assert.strictEqual(j.timeStopMin, 10 * 720);
  assert.match(j.why, /long flush/);
});

test('oi-flush: short squeeze (price up, open interest down) → short once a bar closes below the previous low', () => {
  const r = runner({});
  assert.strictEqual(flush(r, 1), null);
  const j = r.step({ o: 110, h: 111, l: 98, c: 98.5 }, 790);
  assert.ok(j && j.side === -1);
  assert.ok(j.stop > 111, String(j.stop));
});

test('oi-flush: no arming when open interest rose, the move is small, or open interest is stale', () => {
  let r = runner({});
  for (let i = 0; i < 6; i++) r.step(flat(100), 1000);
  r.step({ o: 100, h: 100, l: 88, c: 90 }, 1200); // new positions, not a flush
  assert.strictEqual(r.step({ o: 90, h: 105, l: 89, c: 104 }, 1200), null);
  r = runner({});
  for (let i = 0; i < 6; i++) r.step(flat(100), 1000);
  r.step({ o: 100, h: 100, l: 97, c: 98 }, 800); // 1 ATR only
  assert.strictEqual(r.step({ o: 98, h: 105, l: 97, c: 104 }, 800), null);
  r = runner({});
  for (let i = 0; i < 6; i++) r.step(flat(100), 1000);
  r.step({ o: 100, h: 100, l: 88, c: 90 }, 800, 720, true); // open interest an hour old: ignored
  assert.strictEqual(r.step({ o: 90, h: 105, l: 89, c: 104 }, 800), null);
});

test('oi-flush: the arm expires after armBars bars without a turn', () => {
  const r = runner({ armBars: 2 });
  flush(r, -1);
  // open interest back to where it was: the flush condition stops holding, the arm counts down
  assert.strictEqual(r.step({ o: 90, h: 91, l: 85, c: 86 }, 1000), null);
  assert.strictEqual(r.step({ o: 86, h: 87, l: 84, c: 85 }, 1000), null);
  assert.strictEqual(r.step({ o: 85, h: 95, l: 85, c: 94 }, 1000), null, 'arm expired');
});

test('oi-flush: ignores other timeframes', () => {
  const r = runner({});
  for (let i = 0; i < 10; i++) assert.strictEqual(r.step(flat(100), 1000, 60), null);
});
