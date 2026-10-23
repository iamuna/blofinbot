'use strict';
// possible-expansion (2026-10-23): what was brought over from the 1-minute bot (expansion/README.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { Ring } = require('../src/analysis/ta');
const { validIdea } = require('../src/strategies/kit');
const { checkPlugin } = require('../src/factory/plugin_check');
const strategies = require('../src/strategies');
const { ExecSim } = require('../src/backtest/exec_sim');
const { ExcursionTracker, summarize } = require('../src/research/excursions');
const { contextTags, lift } = require('../src/research/trade_tags');
const { replay, expectedLongestStreak } = require('../src/research/streak_rules');
const { mutate, decide } = require('../src/factory/tuner');
const { importFile, parseTimeMs } = require('../tools/import_binance_1m');
const { makeZip, tmpDir } = require('./helpers');

const MIN = 60000, H4 = 240 * MIN;
const plugin = strategies.byName['adaptive-score'];

// 251 closed 4h bars with returns ret(k), then the bar under test (its close = open × last)
function rig(ret, params, last) {
  const h = new Ring(400), t0 = Date.UTC(2025, 0, 1);
  let c = 100;
  for (let k = 0; k < 251; k++) { const o = c; c = c * (1 + ret(k)); h.push({ t: t0 + k * H4, o, h: Math.max(o, c) * 1.001, l: Math.min(o, c) * 0.999, c, v: 10, q: 1000 }); }
  const o = c; c = o * last;
  const bar = { t: t0 + 251 * H4, o, h: Math.max(o, c) * 1.001, l: Math.min(o, c) * 0.999, c, v: 10, q: 1000 };
  const states = new Map(), p = Object.assign({}, plugin.params, params);
  const api = { p, now: bar.t + H4, hist: () => h, state: (k) => { if (!states.has(k)) states.set(k, {}); return states.get(k); } };
  return plugin.onBar({ coin: 'BTC', tf: 240, t: bar.t, bar, f: { atr: c * 0.01 } }, api);
}
// zig-zag trends: +0.8% / −0.4% bars ending on an up bar (or on a down bar), and −0.8% / +0.4% down
const upTrend = (k) => (k % 2 ? -0.004 : 0.008), upEndingDown = (k) => (k % 2 ? 0.008 : -0.004), downTrend = (k) => (k % 2 ? 0.004 : -0.008);

test('adaptive-score: loads, passes the plugin check, is registered but off in config', () => {
  assert.ok(plugin, 'in the plugin list');
  assert.strictEqual(checkPlugin(fs.readFileSync(path.join(__dirname, '..', 'src', 'strategies', 'adaptive_score.js'), 'utf8')).ok, true);
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'swarm.json'), 'utf8')).strategies;
  for (const k of ['adaptive-score', 'adaptive-score-4h', 'adaptive-score-12h']) assert.strictEqual(cfg[k].enabled, false, `${k} stays off until the sweep has spoken`);
});

test('adaptive-score: a steady uptrend gives a long with an ATR stop and a 1.8 R target; a downtrend a short', () => {
  const up = rig(upTrend, {}, 1.003);
  assert.ok(up, 'idea in an uptrend');
  assert.strictEqual(up.side, 1); assert.strictEqual(validIdea(up), null);
  const risk = up.entry.px - up.stop;
  assert.ok(Math.abs(risk - up.entry.px * 0.01) < 1e-9, 'stop 1 ATR below the close');
  assert.ok(Math.abs(up.target - (up.entry.px + 1.8 * risk)) < 1e-9);
  assert.strictEqual(up.timeStopMin, 60 * 240);
  assert.match(up.why, /trend 100/);
  const dn = rig(downTrend, {}, 0.997);
  assert.ok(dn); assert.strictEqual(dn.side, -1); assert.strictEqual(validIdea(dn), null);
});

test('adaptive-score: no idea on a mixed EMA stack, on the wrong timeframe, below the RSI band or without the candle when asked', () => {
  // 200 bars up, then 51 down: price under EMA20 under EMA50, EMA50 still over EMA200 → trend −20
  assert.strictEqual(rig((k) => (k < 200 ? 0.004 : -0.006), {}, 0.997), null, 'mixed EMA stack');
  assert.strictEqual(rig(upTrend, { tf: 720 }, 1.003), null, 'only its own timeframe');
  assert.strictEqual(rig(upTrend, { rsiLongMax: 50 }, 1.003), null, 'RSI above the long band');
  assert.strictEqual(rig(upTrend, { candleConfirm: true }, 1.003), null, 'an up bar after an up bar is no engulfing / hammer / outside bar');
  const engulf = rig(upEndingDown, { candleConfirm: true }, 1.008); // its body covers the previous down bar's
  assert.ok(engulf && engulf.side === 1, 'bullish engulfing confirms'); assert.match(engulf.why, /bullish_engulfing/);
});

test('exec sim: breakevenR (opt-in) moves a no-trail stop to entry + fees after +1 R, as the paper trader does', () => {
  const run = (be) => {
    const sim = new ExecSim({ breakevenR: be }), t0 = Date.UTC(2026, 0, 1);
    sim.submit({ id: 'x', strategy: 's', coin: 'C', side: 1, tf: 60, t: t0, entry: { kind: 'taker', px: 100 }, stop: 99, target: 105, trail: null, timeStopMin: 600 });
    const bars = [[100, 100.2, 99.9, 100.1], [100.1, 101.3, 100, 101.2], [101.2, 101.2, 98.5, 98.6]];
    bars.forEach(([o, h, l, c], k) => sim.onBar('C', { t: t0 + k * MIN, o, h, l, c }));
    return sim.trades[0];
  };
  const off = run(null), on = run(1);
  assert.strictEqual(off.reason, 'stop'); assert.strictEqual(off.exit, 99, 'off: the original stop');
  assert.strictEqual(on.reason, 'stop'); assert.ok(Math.abs(on.exit - 100 * 1.0008) < 1e-9, 'on: break-even plus 8 bps of fees');
  assert.ok(on.r > off.r);
});

test('excursions: forward R, MFE and MAE per horizon in the idea\'s own bars; −1 R first counted against', () => {
  const t = Date.UTC(2026, 0, 1), tr = new ExcursionTracker({ horizons: [1, 2] }), done = [];
  tr.onDone = (i, rec) => done.push(rec);
  tr.add({ id: 'a', coin: 'C', side: 1, tf: 2, t, entry: { px: 100 }, stop: 98 });
  const px = [[100.5, 99.5, 100], [101, 99.9, 101], [104.5, 100.5, 104], [104, 101, 103]]; // highs, lows, closes; 1 R = 2
  px.forEach(([h, l, c], k) => tr.onBar('C', { t: t + k * MIN, h, l, c }));
  assert.strictEqual(done.length, 1);
  const [a, b] = done[0].rows;
  assert.deepStrictEqual([a.h, a.fwdR, a.mfeR, a.maeR], [1, 0.5, 0.5, -0.25]);
  assert.deepStrictEqual([b.h, b.fwdR, b.mfeR, b.maeR], [2, 1.5, 2.25, -0.25]);
  assert.strictEqual(done[0].first, 1, '+1 R (102) before −1 R (98)');
  const s = summarize(done);
  assert.strictEqual(s.n, 1); assert.strictEqual(s.horizons[1].edge, 9);
  const t2 = new ExcursionTracker({ horizons: [1] }); t2.add({ id: 'b', coin: 'C', side: -1, tf: 1, t, entry: { px: 100 }, stop: 101 });
  t2.onBar('C', { t, h: 101.5, l: 98.5, c: 100 }); // both in one minute
  assert.strictEqual(t2.done[0].first, -1, 'both levels in one minute: the stop wins, as ExecSim');
});

test('trade tags: entry-time conditions, and lift compares with and without (winners counted too)', () => {
  const tags = contextTags({ side: 1 }, { regime: { bias: -0.5, state: 'range', volPct: 0.9, session: 'us' }, f: { volZ: -1 } });
  assert.deepStrictEqual(tags, ['in_range', 'low_volume', 'against_trend', 'high_volatility', 'session_us', 'long']);
  const items = [];
  for (let k = 0; k < 40; k++) items.push({ tags: ['a'], r: k % 2 ? 1 : -0.5 }, { tags: [], r: k % 2 ? 1 : -1 });
  const L = lift(items);
  assert.strictEqual(L.a.lift, 0.25); assert.strictEqual(L.a.n, 40);
});

test('streak rule: replays a trade list with and without it; the chance-level longest streak', () => {
  const tr = [-1, -1, -1, 2, -1, -1, -1, -1, -1, -1, -1, 3, 3].map((r, k) => ({ r, exitT: k, entryT: k }));
  const x = replay(tr);
  assert.strictEqual(x.without.sumR, -2);
  // sizes: 1,1,1,.5(win 2→1),1,1,1,.5,.5,.5,0,0(win 3, shadow),1(3)
  assert.strictEqual(x.with.sumR, -1 - 1 - 1 + 1 - 1 - 1 - 1 - 0.5 - 0.5 - 0.5 + 0 + 0 + 3);
  assert.strictEqual(x.tradesStopped, 2); assert.strictEqual(x.longestLosingStreak, 7);
  assert.ok(Math.abs(expectedLongestStreak(300, 0.38) - 9.9) < 0.1, 'a 38% strategy runs ~10 losses in a row by chance in 300 trades');
});

test('tuner: challengers stay inside the bounds and repeat with the seed; promotion needs validation and test', () => {
  const ma = strategies.byName['ma-21-200'], a = mutate(ma, { tf: 720 }, 7, 20), b = mutate(ma, { tf: 720 }, 7, 20);
  assert.deepStrictEqual(a, b, 'seeded');
  for (const p of a) for (const [k, [lo, hi]] of Object.entries(ma.bounds)) assert.ok(p[k] >= lo && p[k] <= hi, `${k} ${p[k]} in [${lo}, ${hi}]`);
  assert.ok(a.every((p) => p.tf === 720), 'parent settings outside the bounds are kept');
  const flips = mutate(plugin, {}, 3, 50).filter((p) => p.candleConfirm === true).length;
  assert.ok(flips > 3 && flips < 25, 'booleans flip about 20% of the time');
  // a trade a day for 100 days, ±1 R around +0.4 R (challenger) or −0.1 R (parent) at 1.5× costs, 20 bps risk
  const mk = (r) => Array.from({ length: 100 }, (_, d) => ({ entryT: d * 86400000, exitT: d * 86400000 + 1, grossBps: (r + (d % 2 ? 1 : -1)) * 20 + 9.5 * 1.5, feeBps: 8, slipBps: 1.5, fundBps: 0, riskBps: 20 }));
  const good = decide({ parent: mk(-0.1), c1: mk(0.4) }, 0, 100 * 86400000, { minTrades: 40 });
  assert.strictEqual(good.promote, true, good.why.join('; '));
  const bad = decide({ parent: mk(0.4), c1: mk(0.4) }, 0, 100 * 86400000, { minTrades: 40 });
  assert.strictEqual(bad.promote, false); assert.match(bad.why.join(' '), /not 0.10 better/);
});

test('import: a Binance kline zip becomes swarm months; gaps listed, not filled; run through the event study', async () => {
  assert.strictEqual(parseTimeMs('2017-08-17 04:00:00'), Date.UTC(2017, 7, 17, 4));
  assert.strictEqual(parseTimeMs('1502942400000000'), 1502942400000);
  assert.strictEqual(parseTimeMs('1502942400'), 1502942400000);
  const t0 = Date.UTC(2020, 0, 31), lines = ['Open time,Open,High,Low,Close,Volume,Close time,Quote asset volume,Number of trades,Taker buy base asset volume,Taker buy quote asset volume,Ignore'];
  let c = 9000;
  for (let k = 0; k < 2880; k++) {
    if (k >= 100 && k < 103) continue; // a 3-minute hole
    const o = c; c = c * (1 + (Math.floor(k / 5) % 2 ? -0.0008 : 0.0016)); // 5m bars: +0.8%, −0.4%, …
    const d = new Date(t0 + k * MIN).toISOString().replace('T', ' ').slice(0, 19);
    lines.push([d, o, Math.max(o, c) * 1.0002, Math.min(o, c) * 0.9998, c, 2, d, 2 * c, 30, 1, c, 0].join(','));
  }
  const dir = tmpDir('import'), zip = path.join(dir, 'BTC.zip');
  fs.writeFileSync(zip, makeZip('BTCUSD_1m.csv', lines.join('\n') + '\n'));
  const info = await importFile({ in: zip, out: path.join(dir, 'data'), coin: 'BTC' });
  assert.strictEqual(info.rows1m, 2877); assert.strictEqual(info.gaps.length, 1); assert.strictEqual(info.gaps[0].missingMinutes, 3);
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'manifest.json'), 'utf8'));
  assert.deepStrictEqual(man.months, ['2020-01', '2020-02']);
  const jan = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'data', 'BTC', '1m-2020-01.csv.gz'))).toString().split('\n');
  assert.strictEqual(jan[0], 't,o,h,l,c,v,q,n,bq'); assert.strictEqual(jan.filter(Boolean).length - 1, 1437);
  const { eventStudy } = require('../src/research/event_study');
  const r = await eventStudy({ data: path.join(dir, 'data'), variants: [{ name: 'as5', base: 'adaptive-score', params: { tf: 5, onlyTfs: [5], minBars: 60, holdBars: 12 } }], warmupDays: 0, horizons: [1, 3, 6] });
  const s = r.strategies.as5.summary;
  assert.ok(s.n > 5, `${s.n} ideas`);
  assert.ok(s.horizons[s.horizons.length - 1].fwdR > 0, 'a rising market: 30 minutes after a long, price is higher');
  const { backtest } = require('../src/backtest/run');
  const bt = await backtest({ data: path.join(dir, 'data'), variants: [{ name: 'as5', base: 'adaptive-score', params: { tf: 5, onlyTfs: [5], minBars: 60, holdBars: 12 } }], warmupDays: 0, breakevenR: 1 });
  assert.ok(bt.strategies.as5.all.n > 0); assert.strictEqual(bt.costs.breakevenR, 1);
});
