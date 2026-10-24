/* Trend sleeve engine: the retired trend bot's portfolio (tag archive/trend-bot-2026-10-20, lab/mtf/mtf.js, the
 * "v3" configuration of docs/TREND_BOT_RESEARCH_2026-10-18.md), ported without changing a number.
 *
 * Every timeframe from 1h to 3M is read on its own closed candles (built from 1h bars) and holds its state until its
 * next close. Each (timeframe, lookback) pair is a Donchian trend state on closes: +1 after a close above the
 * lookback's highest close, held until the close falls below the trailing midpoint; shorts mirror it, but only on
 * the strategic timeframes (1d, 3d, 1w, 1M, 3M). Per coin:
 *   vote   = 0.6 × mean(strategic states) + 0.4 × mean(setup states, 1h → 12h)
 *   weight = vote × min(2, 25% ÷ its 90-day volatility) × (1 ± 0.5 × cross-coin momentum rank) ÷ coins live
 * then the whole book is scaled to 25% volatility on its own trailing 60 daily returns (at most 3×) and capped at
 * 3× gross. A coin trades only when it drifts outside a 25% band around its target (and by ≥ 0.5% of capital).
 *
 * targets() + simulate() are the research engine: simulate() reproduces the archived engine exactly (the test and
 * tools/trend_sleeve_backtest.js compare them). sleeve.js applies the swarm's hard limits to the weights it makes.
 * Time is in unix SECONDS here (as in the original); the agent converts at its edge. Pure: no I/O.
 */
'use strict';

const H = 3600, D = 86400;
const TF = {
  '1h': { kind: 'h', n: 1 }, '2h': { kind: 'h', n: 2 }, '4h': { kind: 'h', n: 4 }, '6h': { kind: 'h', n: 6 }, '12h': { kind: 'h', n: 12 },
  '1d': { kind: 'h', n: 24 }, '3d': { kind: 'h', n: 72 }, '1w': { kind: 'w' }, '1M': { kind: 'M', n: 1 }, '3M': { kind: 'M', n: 3 },
};
// Donchian lookbacks in bars of each timeframe; the daily set follows Zarattini, Pagani & Barbon (2025)
const LOOKBACKS = {
  '1h': [24, 72, 168], '2h': [24, 84], '4h': [30, 90, 180], '6h': [28, 120], '12h': [20, 60, 120],
  '1d': [5, 10, 20, 30, 60, 90, 150, 250, 360], '3d': [10, 30, 60], '1w': [4, 13, 26, 52], '1M': [3, 6, 12], '3M': [2, 4],
};
const STRATEGIC = ['1d', '3d', '1w', '1M', '3M'];
const LAYER = { '1h': 'setup', '2h': 'setup', '4h': 'setup', '6h': 'setup', '12h': 'setup', '1d': 'strategic', '3d': 'strategic', '1w': 'strategic', '1M': 'strategic', '3M': 'strategic' };

// the validated configuration (archived study_v3.js V3 over mtf.js DEFAULT); fee is per side, execution measured at 5.9 bps
const DEFAULT = {
  tfs: Object.keys(TF), allowShort: true, shortTfs: STRATEGIC,
  layerWeight: { strategic: 0.6, setup: 0.4 },
  volTarget: 0.25, volLook: 90, maxCoinLev: 2, portVolTarget: 0.25, portVolLook: 60, maxGross: 3,
  xsec: 0.5, normLive: true, minLive: 5,
  band: 0.25, minTradePct: 0.005, fee: 0.00059, slip: 0,
  lbScale: 1, start: null, end: null,
};

// ───────────── data: coins on one hourly grid. coin = {coin, t[] (s, candle open), o[], h[], l[], c[], funding: [[t s, rate]]}
// Missing hours carry NaN; closes are carried over outages of ≤ 6 h, never before a coin's first candle.
function align(coins) {
  let t0 = Infinity, t1 = -Infinity;
  for (const c of coins) { const n = c.t.length; if (!n) continue; t0 = Math.min(t0, c.t[0]); t1 = Math.max(t1, c.t[n - 1]); }
  if (!(t1 >= t0)) return { n: 0, t: new Float64Array(0), coins: [] };
  const n = Math.round((t1 - t0) / H) + 1, t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = t0 + i * H;
  const grid = { n, t, coins: [] };
  for (const c of coins) {
    const g = { coin: c.coin, o: new Float64Array(n).fill(NaN), h: new Float64Array(n).fill(NaN), l: new Float64Array(n).fill(NaN), c: new Float64Array(n).fill(NaN), fund: new Float64Array(n).fill(0) };
    for (let i = 0; i < c.t.length; i++) { const k = Math.round((c.t[i] - t0) / H); if (k < 0 || k >= n) continue; g.o[k] = c.o[i]; g.h[k] = c.h[i]; g.l[k] = c.l[i]; g.c[k] = c.c[i]; }
    for (const [ft, rate] of c.funding || []) { const k = Math.floor((ft - t0) / H); if (k >= 0 && k < n) g.fund[k] += rate; } // settles at the start of hour k
    let last = NaN, gap = 0;
    for (let k = 0; k < n; k++) { if (!isNaN(g.c[k])) { last = g.c[k]; gap = 0; } else if (!isNaN(last) && ++gap <= 6) { g.o[k] = g.h[k] = g.l[k] = g.c[k] = last; } }
    grid.coins.push(g);
  }
  return grid;
}

// ───────────── timeframes on the hourly grid
function bucketOf(t, tf) {
  const d = TF[tf];
  if (d.kind === 'h') return Math.floor(t / (d.n * H));
  if (d.kind === 'w') return Math.floor((t - 4 * D) / (7 * D)); // weeks start Monday 00:00 UTC
  const dt = new Date(t * 1000), m = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
  return Math.floor(m / d.n);
}
function bucketEnd(b, tf) { // exclusive end time of bucket b
  const d = TF[tf];
  if (d.kind === 'h') return (b + 1) * d.n * H;
  if (d.kind === 'w') return 4 * D + (b + 1) * 7 * D;
  const m = (b + 1) * d.n; return Date.UTC(Math.floor(m / 12), m % 12, 1) / 1000;
}
// complete bars of tf; end[k] = the hourly index where bar k closes
function resample(grid, g, tf) {
  const bars = { c: [], h: [], l: [], end: [] };
  let cur = -1, hi = -Infinity, lo = Infinity, cl = NaN, last = -1;
  const push = () => { bars.c.push(cl); bars.h.push(hi); bars.l.push(lo); bars.end.push(last); };
  for (let i = 0; i < grid.n; i++) {
    if (isNaN(g.c[i])) continue;
    const b = bucketOf(grid.t[i], tf);
    if (b !== cur) { if (cur >= 0) push(); cur = b; hi = -Infinity; lo = Infinity; }
    hi = Math.max(hi, g.h[i]); lo = Math.min(lo, g.l[i]); cl = g.c[i]; last = i;
  }
  if (cur >= 0 && grid.t[last] + H >= bucketEnd(cur, tf)) push(); // only complete buckets
  return bars;
}

// ───────────── signals
// Donchian trend state on closes: enter beyond the lookback's extreme close, exit through the trailing midpoint
function donchian(c, L, allowShort) {
  const n = c.length, s = new Int8Array(n);
  let state = 0, stop = 0;
  for (let k = L; k < n; k++) {
    let hi = -Infinity, lo = Infinity;
    for (let q = k - L; q < k; q++) { if (c[q] > hi) hi = c[q]; if (c[q] < lo) lo = c[q]; }
    const mid = (hi + lo) / 2;
    if (state > 0) { stop = Math.max(stop, mid); if (c[k] < stop) state = 0; }
    else if (state < 0) { stop = Math.min(stop, mid); if (c[k] > stop) state = 0; }
    if (state === 0) {
      if (c[k] > hi) { state = 1; stop = mid; }
      else if (allowShort && c[k] < lo) { state = -1; stop = mid; }
    }
    s[k] = state;
  }
  return s;
}
// per-bar values on the hourly grid: the last CLOSED bar's value, from its closing hour on
function toGrid(n, bars, vals, fill) {
  const out = new Float64Array(n).fill(fill);
  let k = -1;
  for (let i = 0; i < n; i++) { while (k + 1 < bars.end.length && bars.end[k + 1] <= i) k++; if (k >= 0) out[i] = vals[k]; }
  return out;
}
// annualised volatility of daily log returns over `look` days, on the hourly grid
function dailyVol(grid, g, look) {
  const d = resample(grid, g, '1d'), r = [], v = new Float64Array(d.c.length).fill(NaN);
  for (let k = 1; k < d.c.length; k++) r.push(Math.log(d.c[k] / d.c[k - 1]));
  for (let k = look; k < d.c.length; k++) { let s = 0, s2 = 0; for (let q = k - look; q < k; q++) { s += r[q]; s2 += r[q] * r[q]; } const m = s / look; v[k] = Math.sqrt(Math.max(1e-12, s2 / look - m * m)) * Math.sqrt(365); }
  return toGrid(grid.n, d, v, NaN);
}
// cross-coin momentum: vol-adjusted 30/90/180-day returns ranked across coins at each day's close → [-1, 1]
function crossMomentum(grid, vols) {
  const n = grid.n, N = grid.coins.length, daily = grid.coins.map((g) => resample(grid, g, '1d'));
  const score = grid.coins.map(() => new Float64Array(n).fill(0));
  const raw = daily.map((d) => { const s = new Float64Array(d.c.length).fill(NaN); for (let k = 180; k < d.c.length; k++) { s[k] = (Math.log(d.c[k] / d.c[k - 30]) + Math.log(d.c[k] / d.c[k - 90]) / Math.sqrt(3) + Math.log(d.c[k] / d.c[k - 180]) / Math.sqrt(6)) / 3; } return toGrid(n, d, s, NaN); });
  for (let i = 0; i < n; i++) {
    if (i % 24 !== 23 && i !== n - 1) { for (let j = 0; j < N; j++) score[j][i] = i ? score[j][i - 1] : 0; continue; }
    const live = []; for (let j = 0; j < N; j++) { const v = raw[j][i] / (vols[j][i] || NaN); if (isFinite(v)) live.push([j, v]); }
    live.sort((a, b) => a[1] - b[1]);
    for (let j = 0; j < N; j++) score[j][i] = 0;
    live.forEach(([j], r) => (score[j][i] = live.length > 1 ? (2 * r) / (live.length - 1) - 1 : 0));
  }
  return score;
}

// ───────────── per-coin targets (fraction of the book's equity, before portfolio vol scaling), every hour
function targets(grid, opts) {
  const o = Object.assign({}, DEFAULT, opts || {});
  const n = grid.n, N = grid.coins.length;
  const vols = grid.coins.map((g) => dailyVol(grid, g, o.volLook));
  const comps = grid.coins.map((g) => {
    const list = [];
    for (const tf of o.tfs) {
      const bars = resample(grid, g, tf);
      for (const L0 of LOOKBACKS[tf]) {
        const L = Math.max(2, Math.round(L0 * o.lbScale));
        if (bars.c.length <= L) continue;
        const shortOk = o.allowShort && (!o.shortTfs || o.shortTfs.includes(tf));
        list.push({ tf, L, layer: LAYER[tf], sig: toGrid(n, bars, donchian(bars.c, L, shortOk), 0) });
      }
    }
    return list;
  });
  const xs = o.xsec ? crossMomentum(grid, vols) : null;
  const lw = o.layerWeight, tgt = grid.coins.map(() => new Float64Array(n));
  const live = new Float64Array(n);
  for (let i = 0; i < n; i++) { let c = 0; for (let j = 0; j < N; j++) if (vols[j][i] > 0 && !isNaN(grid.coins[j].c[i])) c++; live[i] = c; }
  for (let j = 0; j < N; j++) {
    const cs = comps[j], g = grid.coins[j];
    const cnt = { strategic: cs.filter((c) => c.layer === 'strategic').length, setup: cs.filter((c) => c.layer === 'setup').length };
    const wsum = (cnt.strategic ? lw.strategic : 0) + (cnt.setup ? lw.setup : 0); // a missing layer leaves the other at full size
    for (let i = 0; i < n; i++) {
      const v = vols[j][i];
      if (!(v > 0) || isNaN(g.c[i])) continue;
      let pos = 0;
      for (const c of cs) { const s = c.sig[i]; if (s) pos += (s * lw[c.layer]) / Math.max(1, cnt[c.layer]); }
      if (wsum > 0) pos /= wsum;
      let scale = Math.min(o.maxCoinLev, o.volTarget / v);
      if (xs) { const r = xs[j][i]; scale *= pos > 0 ? 1 + o.xsec * r : pos < 0 ? 1 - o.xsec * r : 1; }
      tgt[j][i] = (pos * scale) / (o.normLive ? Math.max(o.minLive, live[i]) : N);
    }
  }
  return { o, tgt, comps, xs, vols, live };
}

// ───────────── the research portfolio: trades toward the targets with costs and funding; hourly marks, daily stats
// opts.keepWant: also return want[j][i], the weights the book wanted each hour (the sleeve executes those)
function simulate(grid, opts) {
  const T = targets(grid, opts), o = T.o, tgt = T.tgt;
  const n = grid.n, N = grid.coins.length;
  const wantHist = o.keepWant ? grid.coins.map(() => new Float32Array(n)) : null;
  const hold = new Float64Array(N), ret = [];
  let equity = 1, peak = 1, mdd = 0, fees = 0, fundingPaid = 0, trades = 0, turnover = 0, portScale = 1;
  const inWin = (i) => (!o.start || grid.t[i] >= o.start) && (!o.end || grid.t[i] < o.end);
  const daily = []; let dayStart = 1, dayKey = -1, lastWant = null;
  for (let i = 1; i < n; i++) {
    const active = inWin(i);
    // 1) mark to market over hour i (hold[j] = notional ÷ equity, set at the previous close)
    let pnl = 0;
    for (let j = 0; j < N; j++) {
      const g = grid.coins[j]; if (!hold[j]) continue;
      const pc = g.c[i - 1], c = g.c[i];
      if (isNaN(c) || isNaN(pc)) continue;
      pnl += hold[j] * (c / pc - 1);
      if (g.fund[i]) { const fp = hold[j] * g.fund[i]; pnl -= fp; if (active) fundingPaid += fp * equity; }
    }
    if (active) equity *= 1 + pnl;
    for (let j = 0; j < N; j++) { const g = grid.coins[j]; if (hold[j] && !isNaN(g.c[i]) && !isNaN(g.c[i - 1])) hold[j] *= g.c[i] / g.c[i - 1] / (1 + pnl); }
    // 2) at the close of hour i: portfolio vol scaling (daily, past returns only), new targets, trades with costs
    if (i % 24 === 0 && ret.length > o.portVolLook) {
      const w = ret.slice(-o.portVolLook), m = w.reduce((a, b) => a + b, 0) / w.length, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) * (b - m), 0) / w.length) * Math.sqrt(365);
      portScale = sd > 0 ? Math.min(3, o.portVolTarget / sd) : 1;
    }
    let gross = 0; const want = new Float64Array(N);
    for (let j = 0; j < N; j++) { want[j] = tgt[j][i] * (o.portVolTarget ? portScale : 1); gross += Math.abs(want[j]); }
    if (gross > o.maxGross) for (let j = 0; j < N; j++) want[j] *= o.maxGross / gross;
    if (wantHist) for (let j = 0; j < N; j++) wantHist[j][i] = want[j];
    lastWant = want;
    for (let j = 0; j < N; j++) {
      const gap = want[j] - hold[j];
      if (Math.abs(gap) < o.minTradePct || (Math.abs(gap) < o.band * Math.abs(want[j]) && want[j] !== 0 && Math.sign(want[j]) === Math.sign(hold[j]))) continue;
      if (isNaN(grid.coins[j].c[i])) continue;
      const cost = Math.abs(gap) * (o.fee + o.slip);
      if (active) { equity *= 1 - cost; fees += cost * equity; trades++; turnover += Math.abs(gap); }
      hold[j] = want[j];
    }
    const dk = Math.floor(grid.t[i] / D);
    if (dk !== dayKey) { if (dayKey >= 0 && active) { ret.push(equity / dayStart - 1); daily.push([dayKey, equity / dayStart - 1]); } dayKey = dk; dayStart = equity; }
    if (active) { if (equity > peak) peak = equity; mdd = Math.max(mdd, 1 - equity / peak); }
  }
  const st = stats(daily, equity);
  return Object.assign(st, {
    maxDD: mdd, final: equity, trades, tradesPerDay: trades / Math.max(1, daily.length), turnoverPerYear: turnover / Math.max(1e-9, daily.length / 365), feesPct: fees * 100, fundingPct: fundingPaid * 100, daily,
    want: wantHist, lastWant: lastWant ? Array.from(lastWant) : null, portScale, targets: T,
  });
}

// Sharpe, CAGR, volatility and calendar-year returns of daily returns [[utcDay, r], …]; final = ending equity (default: their product)
function stats(daily, final) {
  const dr = daily.map((d) => d[1]), n = Math.max(1, dr.length), m = dr.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(dr.reduce((a, b) => a + (b - m) * (b - m), 0) / n);
  const years = dr.length / 365, byYear = {};
  if (final == null) final = dr.reduce((a, r) => a * (1 + r), 1);
  for (const [dk, r] of daily) { const y = new Date(dk * D * 1000).getUTCFullYear(); byYear[y] = (byYear[y] || 1) * (1 + r); }
  for (const y in byYear) byYear[y] = +((byYear[y] - 1) * 100).toFixed(1);
  return { days: dr.length, cagr: years > 0 ? Math.pow(final, 1 / years) - 1 : 0, vol: sd * Math.sqrt(365), sharpe: sd > 0 ? (m / sd) * Math.sqrt(365) : 0, worstDay: dr.length ? Math.min(...dr) : 0, byYear };
}

// what each coin's components say at hour i (for the sleeve's report): mean state per timeframe
function votesAt(T, j, i) {
  const by = {};
  for (const c of T.comps[j]) (by[c.tf] = by[c.tf] || []).push(c.sig[i]);
  const out = {}; for (const k in by) out[k] = +(by[k].reduce((a, b) => a + b, 0) / by[k].length).toFixed(2);
  return out;
}

module.exports = { H, D, TF, LOOKBACKS, LAYER, STRATEGIC, DEFAULT, align, bucketOf, bucketEnd, resample, donchian, toGrid, dailyVol, crossMomentum, targets, simulate, stats, votesAt };
