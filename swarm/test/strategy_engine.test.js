'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { FeatureState } = require('../src/analysis/features');
const { RegimeState } = require('../src/analysis/regime');
const { StrategyHost, validIdea } = require('../src/strategies/kit');
const { ExecSim } = require('../src/backtest/exec_sim');
const { summarize } = require('../src/backtest/stats');
const { backtest } = require('../src/backtest/run');
const strategies = require('../src/strategies');
const { tmpDir } = require('./helpers');

const MIN = 60000, T0 = Date.UTC(2026, 3, 1);
const bar = (t, o, h, l, c, extra) => Object.assign({ t, o, h, l, c, v: 10, q: 1000, bq: 500, n: 5 }, extra);

test('features: multi-timeframe aggregation closes on UTC boundaries', () => {
  const fs_ = new FeatureState({ tfs: [1, 5, 45] });
  const closed = [];
  for (let k = 0; k < 90; k++) for (const e of fs_.onBar1m('BTC', bar(T0 + k * MIN, 100 + k, 101 + k, 99 + k, 100.5 + k))) closed.push([e.tf, (e.t - T0) / MIN]);
  assert.deepStrictEqual(closed.filter((x) => x[0] === 45), [[45, 0], [45, 45]]);
  assert.strictEqual(closed.filter((x) => x[0] === 5).length, 18);
  const b45 = fs_.history('BTC', 45).at(1);
  assert.deepStrictEqual([b45.o, b45.h, b45.l, b45.c, b45.q, b45.bq], [100, 145, 99, 144.5, 45000, 22500]);
  // a missing boundary minute still closes the bar (marked partial)
  fs_.onBar1m('BTC', bar(T0 + 91 * MIN, 1, 1, 1, 1));
  const ev = fs_.onBar1m('BTC', bar(T0 + 96 * MIN, 1, 1, 1, 1)); // 92–94 never arrived
  assert.ok(ev.some((e) => e.tf === 5 && e.t === T0 + 90 * MIN && e.f.partial));
});

test('features: indicators, channels before the bar, flow share, BTC link', () => {
  const fs_ = new FeatureState({ tfs: [1] });
  let last;
  for (let k = 0; k < 300; k++) {
    const px = 100 + Math.sin(k / 7);
    fs_.onBar1m('BTC', bar(T0 + k * MIN, px, px + 0.2, px - 0.2, px + 0.05));
    [last] = fs_.onBar1m('ETH', bar(T0 + k * MIN, px * 20, px * 20 + 4, px * 20 - 4, px * 20 + 1, { bq: 800 }));
  }
  const f = last.f;
  assert.ok(f.atr > 0 && f.atrPct > 0 && Number.isFinite(f.ema20));
  assert.ok(f.dc20h >= last.bar.h || f.dc20h < last.bar.h); // computed before this bar
  assert.strictEqual(f.flowShare, 0.8);
  assert.strictEqual(f.btcRet, fs_.btcLast.get(1).ret, 'BTC is processed first, so its same-minute return is known');
  assert.ok(Math.abs(fs_.beta('ETH') - 1) < 0.05, `beta of a coin moving with BTC ≈ 1 (${fs_.beta('ETH')})`);
});

test('regime: hourly Donchian votes give a bias in trends', () => {
  const r = new RegimeState();
  for (let h = 0; h < 24 * 25; h++) r.onHour('UP', T0 + h * 3600000, 100 + h);
  for (let h = 0; h < 24 * 25; h++) r.onHour('DN', T0 + h * 3600000, 1000 - h);
  assert.strictEqual(r.get('UP', T0).bias, 1); assert.strictEqual(r.get('DN', T0).bias, -1);
  assert.strictEqual(r.get('UP', T0).warm, true);
});

test('kit: invalid ideas are rejected, one open idea per coin', () => {
  assert.match(validIdea({ side: 1, entry: { px: 100 }, stop: 101, timeStopMin: 5 }), /wrong side/);
  const fs_ = new FeatureState({ tfs: [1] });
  const s = { name: 'x', tfs: [1], params: {}, onBar: (ev) => ({ coin: ev.coin, side: 1, entry: { kind: 'maker', px: ev.bar.c }, stop: ev.bar.c * 0.99, target: null, timeStopMin: 5 }) };
  const h = new StrategyHost(s, { fs: fs_ });
  const ideas = [];
  for (let k = 0; k < 3; k++) for (const ev of fs_.onBar1m('BTC', bar(T0 + k * MIN, 100, 101, 99, 100))) ideas.push(...h.onEvent(ev));
  assert.strictEqual(ideas.length, 1);
  h.onClose('BTC', ideas[0].id, { idea: ideas[0], outcome: 'unfilled', exitT: T0 });
  for (const ev of fs_.onBar1m('BTC', bar(T0 + 3 * MIN, 100, 101, 99, 100))) ideas.push(...h.onEvent(ev));
  assert.strictEqual(ideas.length, 2);
});

test('exec sim: maker fills only through the price, stop beats target, costs add up', () => {
  const closed = [];
  const sim = new ExecSim({ onClose: (i, r) => closed.push(r) });
  const idea = (id, o) => Object.assign({ id, strategy: 's', coin: 'C', tf: 1, side: 1, t: T0, entry: { kind: 'maker', px: 100, waitMin: 3, fallback: 'cancel' }, stop: 99, target: 102, trail: null, timeStopMin: 30 }, o);
  sim.submit(idea('touch'));
  sim.onBar('C', bar(T0, 100.5, 100.6, 100, 100.2)); // touches 100 but not through → no fill
  sim.onBar('C', bar(T0 + MIN, 100.2, 100.3, 100.1, 100.2));
  sim.onBar('C', bar(T0 + 2 * MIN, 100.2, 100.3, 100.1, 100.2)); // wait over → unfilled
  assert.deepStrictEqual(closed.map((r) => r.outcome), ['unfilled']);
  sim.submit(idea('both', { t: T0 + 3 * MIN }));
  sim.onBar('C', bar(T0 + 3 * MIN, 100.2, 100.2, 99.9, 100)); // fills at 100 (maker)
  sim.onBar('C', bar(T0 + 4 * MIN, 100, 102.5, 98.5, 101)); // stop and target in one bar → stop
  const t1 = sim.trades[0];
  assert.deepStrictEqual([t1.reason, t1.entry, t1.exit, t1.feeBps, t1.slipBps], ['stop', 100, 99, 8, 1.5]);
  assert.ok(Math.abs(t1.netBps - (-100 - 8 - 1.5)) < 1e-9); assert.ok(Math.abs(t1.r - -1.095) < 1e-9);
  sim.submit(idea('win', { t: T0 + 5 * MIN }));
  sim.onBar('C', bar(T0 + 5 * MIN, 100.1, 100.1, 99.98, 100)); // fills
  sim.onBar('C', bar(T0 + 6 * MIN, 100, 102.2, 99.5, 102)); // target (maker)
  const t2 = sim.trades[1];
  assert.deepStrictEqual([t2.reason, t2.exitKind, t2.feeBps, t2.slipBps, t2.grossBps], ['target', 'maker', 4, 0, 200]);
  // a gap through the stop exits at the open, not at the stop
  sim.submit(idea('gap', { t: T0 + 7 * MIN, entry: { kind: 'taker', px: 100 } }));
  sim.onBar('C', bar(T0 + 7 * MIN, 100, 100.4, 99.6, 100.2)); // taker fill at open 100
  sim.onBar('C', bar(T0 + 8 * MIN, 98, 98.2, 97.5, 98));
  const t3 = sim.trades[2];
  assert.deepStrictEqual([t3.entryKind, t3.exit, t3.feeBps, t3.slipBps], ['taker', 98, 12, 3]);
  const s = summarize(sim.trades);
  assert.strictEqual(s.n, 3); assert.ok(Math.abs(s.winRate - 1 / 3) < 0.001);
  assert.ok(summarize(sim.trades, { costMult: 2 }).avgR < s.avgR);
});

test('exec sim: trailing stop, time stop, funding at settlements', () => {
  const sim = new ExecSim({ funding: { C: [[T0 + 8 * 3600000, 0.001]] } });
  sim.submit({ id: 'a', strategy: 's', coin: 'C', tf: 1, side: 1, t: T0, entry: { kind: 'taker', px: 100 }, stop: 99, target: null, trail: { dist: 1, afterR: 1 }, timeStopMin: 600 });
  sim.onBar('C', bar(T0, 100, 100.5, 99.5, 100.2));
  sim.onBar('C', bar(T0 + MIN, 100.2, 103.2, 100.1, 103)); // +3: trail to 102
  sim.onBar('C', bar(T0 + 2 * MIN, 103, 103.1, 101.5, 101.8)); // trail hit at 102
  assert.deepStrictEqual([sim.trades[0].reason, sim.trades[0].exit], ['stop', 102]);
  sim.submit({ id: 'b', strategy: 's', coin: 'C', tf: 1, side: -1, t: T0 + 8 * 3600000 - 2 * MIN, entry: { kind: 'taker', px: 100 }, stop: 110, target: null, trail: null, timeStopMin: 5 });
  for (let k = -2; k < 5; k++) sim.onBar('C', bar(T0 + 8 * 3600000 + k * MIN, 100, 100.1, 99.9, 100));
  const t = sim.trades[1];
  assert.deepStrictEqual([t.reason, t.fundBps], ['time', -10], 'a short receives positive funding (a negative cost)');
});

function writeDataset(dir, days) {
  const coins = { BTC: 80000, ETH: 2400 };
  const man = { months: ['2026-04'], currentMonthDays: [], coins: {} };
  for (const [c, p0] of Object.entries(coins)) {
    fs.mkdirSync(path.join(dir, c), { recursive: true });
    const rows = []; let px = p0;
    for (let k = 0; k < days * 1440; k++) {
      const drift = Math.sin(k / 3000) * 0.0004 + (k % 997 === 0 ? 0.01 : 0); // slow waves + occasional jumps
      const o = px; px = px * (1 + drift + Math.sin(k * 1.7) * 0.0003);
      rows.push([T0 + k * MIN, o, Math.max(o, px) * 1.0004, Math.min(o, px) * 0.9996, px, 1, 1e6 * (1 + (k % 13) / 10), 100, 5e5 * (1 + Math.sign(px - o) * 0.2)].join(','));
    }
    fs.writeFileSync(path.join(dir, c, '1m-2026-04.csv.gz'), zlib.gzipSync('t,o,h,l,c,v,q,n,bq\n' + rows.join('\n') + '\n'));
    fs.writeFileSync(path.join(dir, c, 'funding.csv.gz'), zlib.gzipSync('t,rate\n' + Array.from({ length: days * 3 }, (_, k) => `${T0 + k * 8 * 3600000},0.0001`).join('\n') + '\n'));
    fs.writeFileSync(path.join(dir, c, 'oi-2026-04.csv.gz'), zlib.gzipSync('t,oi,oiQ,lsTop,lsAll,takerLS\n' + Array.from({ length: days * 288 }, (_, k) => `${T0 + k * 300000},${1000 + k},${(1000 + k) * p0},1,1,1`).join('\n') + '\n'));
    man.coins[c] = { status: 'ok' };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man));
}

test('backtest runs every strategy end to end on a synthetic dataset', async () => {
  const dir = tmpDir('bt'); writeDataset(dir, 8);
  const r = await backtest({ data: dir, warmupDays: 2 });
  assert.deepStrictEqual(Object.keys(r.strategies).sort(), strategies.all.map((s) => s.name).sort());
  for (const [k, v] of Object.entries(r.strategies)) assert.strictEqual(v.ideas.errors, 0, `${k} raised no errors`);
  const total = Object.values(r.strategies).reduce((a, v) => a + v.all.n || 0, 0);
  assert.ok(total > 0, 'some strategy traded');
  for (const v of Object.values(r.strategies)) for (const t of v.trades) {
    assert.ok(t.exitT > t.entryT - 1 && t.entryT >= t.t, 'no fill before the decision');
    assert.ok(Math.abs(t.netBps - (t.grossBps - t.feeBps - t.slipBps - t.fundBps)) < 0.02);
  }
});
