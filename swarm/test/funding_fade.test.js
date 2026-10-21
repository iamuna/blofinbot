'use strict';
// funding-fade: fade a crowd that has paid high funding for days once price breaks against it.
const test = require('node:test');
const assert = require('node:assert');
const plugin = require('../src/strategies/funding_fade');

function runner(params) {
  const states = new Map(), p = Object.assign({}, plugin.params, params), out = [], ctx = { funding: null };
  let t = 0;
  const step = (bar, funding, tf = p.tf) => {
    t += tf * 60000; ctx.funding = funding;
    const ev = { coin: 'X', tf, t, bar, f: { atr: 1, bars: 500 } };
    const api = { p, now: t + tf * 60000, ctx: () => ctx, state: (c) => { if (!states.has(c)) states.set(c, {}); return states.get(c); } };
    const r = plugin.onBar(ev, api); if (r) out.push(r);
    return r;
  };
  return { step, out, p };
}
const flat = (c) => ({ o: c, h: c + 1, l: c - 1, c });

test('funding-fade: longs crowded for 3 days, close below the 3-bar low → short, stop above the recent high', () => {
  const r = runner({});
  for (let i = 0; i < 18; i++) assert.strictEqual(r.step(flat(100), 0.0005), null); // 72h of 4h bars, no break
  const i = r.step({ o: 100, h: 100.5, l: 97, c: 97.5 }, 0.0005);
  assert.ok(i, 'expected a short');
  assert.strictEqual(i.side, -1);
  assert.strictEqual(i.target, null);
  assert.ok(Math.abs(i.stop - (101 + 0.5)) < 1e-9, String(i.stop)); // highest high of the 3 bars before + 0.5 ATR
  assert.strictEqual(i.timeStopMin, 12 * 240);
  assert.match(i.why, /longs crowded/);
});

test('funding-fade: shorts crowded (negative funding) and a break up → long', () => {
  const r = runner({});
  for (let i = 0; i < 18; i++) r.step(flat(100), -0.0004);
  const i = r.step({ o: 100, h: 103, l: 99.5, c: 102.5 }, -0.0004);
  assert.ok(i && i.side === 1);
  assert.ok(i.stop < 102.5);
});

test('funding-fade: no trade when funding is ordinary, too short a history, or the latest rate has dropped', () => {
  let r = runner({});
  for (let i = 0; i < 18; i++) r.step(flat(100), 0.0001);
  assert.strictEqual(r.step({ o: 100, h: 100.5, l: 97, c: 97.5 }, 0.0001), null);
  r = runner({});
  for (let i = 0; i < 5; i++) r.step(flat(100), 0.0008); // only 20h of history
  assert.strictEqual(r.step({ o: 100, h: 100.5, l: 97, c: 97.5 }, 0.0008), null);
  r = runner({});
  for (let i = 0; i < 18; i++) r.step(flat(100), 0.0008);
  assert.strictEqual(r.step({ o: 100, h: 100.5, l: 97, c: 97.5 }, 0.0001), null); // crowd already paid down
});

test('funding-fade: ignores other timeframes and missing funding', () => {
  const r = runner({});
  for (let i = 0; i < 18; i++) r.step(flat(100), 0.0005);
  assert.strictEqual(r.step({ o: 100, h: 100.5, l: 97, c: 97.5 }, 0.0005, 60), null);
  assert.strictEqual(r.step({ o: 100, h: 100.5, l: 97, c: 97.5 }, null), null);
});
