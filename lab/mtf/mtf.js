/* Multi-timeframe, multi-coin portfolio engine (research + live core).
 *
 * Every timeframe is evaluated only on its own closed candles and its state is held until its next close.
 * Layers:
 *   strategic 1d → 3M : trend ensemble per timeframe + cross-coin momentum rank + funding crowding → direction & risk
 *   setups    1h → 12h: intraday trend ensemble → adds/removes exposure between daily closes
 *   execution 1m → 30m: (live / execution study) works orders toward the target with limit orders
 * Each coin's target position = volatility-targeted average of its active components.
 * The portfolio trades toward targets at the next hour's open only when the gap exceeds a hysteresis band.
 * No component sees a candle before it closes.
 */
'use strict';
const fs = require('fs'), zlib = require('zlib');

const H = 3600, D = 86400;
// timeframe definitions on top of 1h candles
const TF = {
  '1h': { kind: 'h', n: 1 }, '2h': { kind: 'h', n: 2 }, '4h': { kind: 'h', n: 4 }, '6h': { kind: 'h', n: 6 }, '12h': { kind: 'h', n: 12 },
  '1d': { kind: 'h', n: 24 }, '3d': { kind: 'h', n: 72 }, '1w': { kind: 'w' }, '1M': { kind: 'M', n: 1 }, '3M': { kind: 'M', n: 3 },
};
// Donchian lookbacks (in bars of that timeframe). Daily set follows Zarattini, Pagani & Barbon (2025).
const LOOKBACKS = {
  '1h': [24, 72, 168], '2h': [24, 84], '4h': [30, 90, 180], '6h': [28, 120], '12h': [20, 60, 120],
  '1d': [5, 10, 20, 30, 60, 90, 150, 250, 360], '3d': [10, 30, 60], '1w': [4, 13, 26, 52], '1M': [3, 6, 12], '3M': [2, 4],
};
const LAYER = { '1h': 'setup', '2h': 'setup', '4h': 'setup', '6h': 'setup', '12h': 'setup', '1d': 'strategic', '3d': 'strategic', '1w': 'strategic', '1M': 'strategic', '3M': 'strategic' };

// ───────────── data
function readCsvGz(path) {
  const txt = path.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(path)).toString('utf8') : fs.readFileSync(path, 'utf8');
  const lines = txt.split('\n'), hdr = lines[0].split(','), cols = {};
  hdr.forEach((h, k) => (cols[h.trim()] = k));
  const rows = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; rows.push(lines[i].split(',').map(Number)); }
  return { cols, rows };
}
function loadCoin(dir, coin) {
  const { cols, rows } = readCsvGz(`${dir}/${coin}/1h.csv.gz`);
  const n = rows.length, c = { coin, n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), qv: new Float64Array(n) };
  for (let i = 0; i < n; i++) { const r = rows[i]; c.t[i] = Math.floor(r[cols.t] / 1000); c.o[i] = r[cols.o]; c.h[i] = r[cols.h]; c.l[i] = r[cols.l]; c.c[i] = r[cols.c]; c.v[i] = r[cols.v]; c.qv[i] = cols.qv != null ? r[cols.qv] : r[cols.v] * r[cols.c]; }
  try { const f = readCsvGz(`${dir}/${coin}/funding.csv.gz`); c.funding = f.rows.map((r) => [Math.floor(r[f.cols.t] / 1000), r[f.cols.rate]]); } catch (e) { c.funding = []; }
  return c;
}
function loadCsvPlain(path, coin) {
  const { cols, rows } = readCsvGz(path);
  const n = rows.length, c = { coin, n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), qv: new Float64Array(n), funding: [] };
  for (let i = 0; i < n; i++) { const r = rows[i]; c.t[i] = Math.floor(r[cols.t] / 1000); c.o[i] = r[cols.o]; c.h[i] = r[cols.h]; c.l[i] = r[cols.l]; c.c[i] = r[cols.c]; c.v[i] = r[cols.v]; c.qv[i] = r[cols.v] * r[cols.c]; }
  return c;
}
// Align coins on one hourly grid. Missing hours (before listing, outages) carry NaN.
function align(coins) {
  let t0 = Infinity, t1 = -Infinity;
  for (const c of coins) { t0 = Math.min(t0, c.t[0]); t1 = Math.max(t1, c.t[c.n - 1]); }
  const n = Math.round((t1 - t0) / H) + 1, t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = t0 + i * H;
  const grid = { n, t, coins: [] };
  for (const c of coins) {
    const g = { coin: c.coin, o: new Float64Array(n).fill(NaN), h: new Float64Array(n).fill(NaN), l: new Float64Array(n).fill(NaN), c: new Float64Array(n).fill(NaN), v: new Float64Array(n).fill(0), qv: new Float64Array(n).fill(0), fund: new Float64Array(n).fill(0) };
    for (let i = 0; i < c.n; i++) { const k = Math.round((c.t[i] - t0) / H); if (k < 0 || k >= n) continue; g.o[k] = c.o[i]; g.h[k] = c.h[i]; g.l[k] = c.l[i]; g.c[k] = c.c[i]; g.v[k] = c.v[i]; g.qv[k] = c.qv[i]; }
    for (const [ft, rate] of c.funding) { const k = Math.floor((ft - t0) / H); if (k >= 0 && k < n) g.fund[k] += rate; } // funding settles at the start of hour k
    // forward-fill closes over short outages (≤ 6h) so the grid has no holes; never before the first candle
    let last = NaN, gap = 0;
    for (let k = 0; k < n; k++) { if (!isNaN(g.c[k])) { last = g.c[k]; gap = 0; } else if (!isNaN(last) && ++gap <= 6) { g.o[k] = g.h[k] = g.l[k] = g.c[k] = last; } }
    grid.coins.push(g);
  }
  return grid;
}

// ───────────── resample the hourly grid to a timeframe; returns bars with the hourly index where each bar closes
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
function resample(grid, g, tf) {
  const bars = { c: [], h: [], l: [], end: [] };
  let cur = -1, hi = -Infinity, lo = Infinity, cl = NaN, last = -1;
  for (let i = 0; i < grid.n; i++) {
    if (isNaN(g.c[i])) continue;
    const b = bucketOf(grid.t[i], tf);
    if (b !== cur) { if (cur >= 0) push(); cur = b; hi = -Infinity; lo = Infinity; }
    hi = Math.max(hi, g.h[i]); lo = Math.min(lo, g.l[i]); cl = g.c[i]; last = i;
  }
  if (cur >= 0 && grid.t[last] + H >= bucketEnd(cur, tf)) push(); // only complete buckets
  function push() { bars.c.push(cl); bars.h.push(hi); bars.l.push(lo); bars.end.push(last); }
  return bars;
}

// ───────────── signals
// Donchian trend state on closes (Zarattini et al.): enter when close breaks the lookback's highest close,
// trail at the midpoint of the lookback's highest and lowest close. Shorts mirror when allowed.
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
// map per-bar values onto the hourly grid: value of the last CLOSED bar (available from its closing hour on)
function toGrid(n, bars, vals, fill) {
  const out = new Float64Array(n).fill(fill);
  let k = -1;
  for (let i = 0; i < n; i++) { while (k + 1 < bars.end.length && bars.end[k + 1] <= i) k++; if (k >= 0) out[i] = vals[k]; }
  return out;
}
// daily realised volatility (annualised) from daily closes, mapped hourly
function dailyVol(grid, g, look) {
  const d = resample(grid, g, '1d'), r = [], v = new Float64Array(d.c.length).fill(NaN);
  for (let k = 1; k < d.c.length; k++) r.push(Math.log(d.c[k] / d.c[k - 1]));
  for (let k = look; k < d.c.length; k++) { let s = 0, s2 = 0; for (let q = k - look; q < k; q++) { s += r[q]; s2 += r[q] * r[q]; } const m = s / look; v[k] = Math.sqrt(Math.max(1e-12, s2 / look - m * m)) * Math.sqrt(365); }
  return toGrid(grid.n, d, v, NaN);
}
// cross-coin momentum score: vol-adjusted 30/90/180-day returns, ranked across coins each day → [-1, 1]
function crossMomentum(grid, vols) {
  const n = grid.n, N = grid.coins.length, daily = grid.coins.map((g) => resample(grid, g, '1d'));
  const score = grid.coins.map(() => new Float64Array(n).fill(0));
  // compute per coin per daily bar the raw score, then rank on the hourly grid at each day close
  const raw = daily.map((d) => { const s = new Float64Array(d.c.length).fill(NaN); for (let k = 180; k < d.c.length; k++) { const m = (Math.log(d.c[k] / d.c[k - 30]) + Math.log(d.c[k] / d.c[k - 90]) / Math.sqrt(3) + Math.log(d.c[k] / d.c[k - 180]) / Math.sqrt(6)) / 3; s[k] = m; } return toGrid(n, d, s, NaN); });
  for (let i = 0; i < n; i++) {
    if (i % 24 !== 23 && i !== n - 1) { for (let j = 0; j < N; j++) score[j][i] = i ? score[j][i - 1] : 0; continue; }
    const live = []; for (let j = 0; j < N; j++) { const v = raw[j][i] / (vols[j][i] || NaN); if (isFinite(v)) live.push([j, v]); }
    live.sort((a, b) => a[1] - b[1]);
    for (let j = 0; j < N; j++) score[j][i] = 0;
    live.forEach(([j], r) => (score[j][i] = live.length > 1 ? (2 * r) / (live.length - 1) - 1 : 0));
  }
  return score;
}

// ───────────── portfolio simulation
const DEFAULT = {
  tfs: Object.keys(TF), allowShort: true, shortTfs: null, // shorts allowed on these timeframes (null = all)
  layerWeight: { strategic: 0.6, setup: 0.4 },
  volTarget: 0.25, volLook: 90, maxCoinLev: 2, portVolTarget: 0.25, portVolLook: 60, maxGross: 3,
  xsec: 0.5, // cross-coin momentum tilt strength (0 = off)
  fundingCrowd: 0.5, // annualised funding above this scales longs down (and shorts up) — 0 = off
  band: 0.25, minTradePct: 0.005, // hysteresis: trade only if |gap| > band × |target| and > minTradePct of equity
  fee: 0.0006, slip: 0.0002, // per side, as a fraction of notional
  start: null, end: null, // unix seconds window for metrics (signals warm up before)
  // v2 options
  normLive: false, minLive: 5, // divide risk by the number of coins with data (≥ minLive) instead of the full universe
  adaptiveSetup: 0, // >0: per coin, a setup timeframe votes only while round-trip cost ≤ this share of its typical candle (trailing 90 days)
  setupLongOnly: false, // setup layer (1h→12h) adds long exposure only; shorts come from the strategic layer
  roundTripBps: 16, // used by adaptiveSetup: taker fee + slippage, both sides
  lbScale: 1, // sensitivity test: multiply every Donchian lookback
  sessionBoost: 0, // >0: setup-layer votes count (1+x)× from Sunday 23:00 to Monday 23:00 UTC (Asia-open trend effect)
};
// typical 1h candle range (bps), trailing ~90 days, causal (exponential average of (h-l)/c, outlier-capped)
function hourRange(grid, g) {
  const n = grid.n, out = new Float64Array(n).fill(NaN), k = 2 / (90 * 24 + 1);
  let e = NaN;
  for (let i = 0; i < n; i++) {
    if (isNaN(g.c[i]) || !(g.c[i] > 0)) { out[i] = e; continue; }
    let r = ((g.h[i] - g.l[i]) / g.c[i]) * 1e4;
    if (isFinite(e)) r = Math.min(r, 5 * e);
    e = isFinite(e) ? e + k * (r - e) : r;
    out[i] = e;
  }
  return out;
}
const TF_HOURS = { '1h': 1, '2h': 2, '4h': 4, '6h': 6, '12h': 12 };
function simulate(grid, opts) {
  const o = Object.assign({}, DEFAULT, opts || {});
  const n = grid.n, N = grid.coins.length;
  const vols = grid.coins.map((g) => dailyVol(grid, g, o.volLook));
  // component signals per coin
  const comps = grid.coins.map((g, j) => {
    const list = [];
    for (const tf of o.tfs) {
      const bars = resample(grid, g, tf);
      for (const L0 of LOOKBACKS[tf]) {
        const L = Math.max(2, Math.round(L0 * o.lbScale));
        if (bars.c.length <= L) continue;
        const shortOk = o.allowShort && (!o.shortTfs || o.shortTfs.includes(tf)) && !(o.setupLongOnly && LAYER[tf] === 'setup');
        const s = donchian(bars.c, L, shortOk);
        list.push({ tf, L, layer: LAYER[tf], sig: toGrid(n, bars, s, 0) });
      }
    }
    return list;
  });
  const xs = o.xsec ? crossMomentum(grid, vols) : null;
  // per layer component counts for weighting
  const lw = o.layerWeight;
  const tgt = grid.coins.map(() => new Float64Array(n));
  const ranges = o.adaptiveSetup ? grid.coins.map((g) => hourRange(grid, g)) : null;
  // Sunday 23:00 → Monday 23:00 UTC window
  const sess = (i) => { if (!o.sessionBoost) return 1; const d = new Date(grid.t[i] * 1000), wd = d.getUTCDay(), h = d.getUTCHours(); return (wd === 0 && h >= 23) || (wd === 1 && h < 23) ? 1 + o.sessionBoost : 1; };
  // live coin count per hour (coin has a price and a volatility estimate)
  const live = new Float64Array(n);
  for (let i = 0; i < n; i++) { let c = 0; for (let j = 0; j < N; j++) if (vols[j][i] > 0 && !isNaN(grid.coins[j].c[i])) c++; live[i] = c; }
  for (let j = 0; j < N; j++) {
    const cs = comps[j], g = grid.coins[j];
    const cnt = { strategic: cs.filter((c) => c.layer === 'strategic').length, setup: cs.filter((c) => c.layer === 'setup').length };
    for (let i = 0; i < n; i++) {
      const v = vols[j][i];
      if (!(v > 0) || isNaN(g.c[i])) continue;
      let pos = 0;
      if (ranges) {
        // setup timeframes vote only where a round trip is a small share of their typical candle
        const r1 = ranges[j][i];
        let nSetup = 0, setupSum = 0, nStrat = 0, stratSum = 0;
        for (const c of cs) {
          if (c.layer === 'setup') { const share = o.roundTripBps / (r1 * Math.sqrt(TF_HOURS[c.tf])); if (!(share <= o.adaptiveSetup)) continue; nSetup++; setupSum += c.sig[i]; }
          else { nStrat++; stratSum += c.sig[i]; }
        }
        const wS = nStrat ? lw.strategic : 0, wU = nSetup ? lw.setup * sess(i) : 0;
        if (wS + wU > 0) pos = ((nStrat ? (stratSum / nStrat) * wS : 0) + (nSetup ? (setupSum / nSetup) * wU : 0)) / (wS + wU);
      } else {
        const ws = sess(i);
        for (const c of cs) { const s = c.sig[i]; if (s) pos += (s * lw[c.layer] * (c.layer === 'setup' ? ws : 1)) / Math.max(1, cnt[c.layer]); }
        // normalise when a layer is absent so the remaining layer can still reach full size
        const wsum = (cnt.strategic ? lw.strategic : 0) + (cnt.setup ? lw.setup * ws : 0);
        if (wsum > 0) pos /= wsum;
      }
      let scale = Math.min(o.maxCoinLev, o.volTarget / v);
      if (xs) { const r = xs[j][i]; scale *= pos > 0 ? 1 + o.xsec * r : pos < 0 ? 1 - o.xsec * r : 1; }
      if (o.fundingCrowd) {
        // trailing 3-day funding, annualised (3 settlements/day × 365)
        let f = 0; for (let q = Math.max(0, i - 72); q <= i; q++) f += g.fund[q];
        const ann = (f / 9) * 3 * 365;
        if (pos > 0 && ann > o.fundingCrowd) scale *= 0.5; else if (pos < 0 && ann < -o.fundingCrowd) scale *= 0.5;
      }
      tgt[j][i] = pos * scale / (o.normLive ? Math.max(o.minLive, live[i]) : N); // fraction of equity in this coin
    }
  }
  // portfolio-level vol targeting on the strategy's own trailing returns (uses only past equity)
  const eq = new Float64Array(n).fill(NaN), hold = new Float64Array(N), ret = [];
  let equity = 1, peak = 1, mdd = 0, fees = 0, fundingPaid = 0, trades = 0, turnover = 0, portScale = 1;
  const inWin = (i) => (!o.start || grid.t[i] >= o.start) && (!o.end || grid.t[i] < o.end);
  const daily = []; let dayStart = 1, dayKey = -1;
  const tradeLog = [];
  let lastWant = null;
  for (let i = 1; i < n; i++) {
    const active = inWin(i);
    // 1) mark to market over hour i (positions held from the open of hour i)
    let pnl = 0;
    for (let j = 0; j < N; j++) {
      const g = grid.coins[j]; if (!hold[j]) continue;
      const pc = g.c[i - 1], c = g.c[i];
      if (isNaN(c) || isNaN(pc)) continue;
      pnl += hold[j] * (c / pc - 1); // hold[j] = position notional as a fraction of equity, set at the previous close
      if (g.fund[i]) { const fp = hold[j] * g.fund[i]; pnl -= fp; if (active) fundingPaid += fp * equity; }
    }
    if (active) equity *= 1 + pnl;
    for (let j = 0; j < N; j++) { const g = grid.coins[j]; if (hold[j] && !isNaN(g.c[i]) && !isNaN(g.c[i - 1])) hold[j] *= g.c[i] / g.c[i - 1] / (1 + pnl); }
    // 2) at the close of hour i: new targets → trade at the open of hour i+1 (modelled as now, at close, with costs)
    if (i % 24 === 0 && ret.length > o.portVolLook) {
      const w = ret.slice(-o.portVolLook), m = w.reduce((a, b) => a + b, 0) / w.length, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) * (b - m), 0) / w.length) * Math.sqrt(365);
      portScale = sd > 0 ? Math.min(3, o.portVolTarget / sd) : 1;
    }
    let gross = 0; const want = new Float64Array(N);
    for (let j = 0; j < N; j++) { want[j] = tgt[j][i] * (o.portVolTarget ? portScale : 1); gross += Math.abs(want[j]); }
    if (gross > o.maxGross) for (let j = 0; j < N; j++) want[j] *= o.maxGross / gross;
    lastWant = want;
    for (let j = 0; j < N; j++) {
      const gap = want[j] - hold[j];
      if (Math.abs(gap) < o.minTradePct || (Math.abs(gap) < o.band * Math.abs(want[j]) && want[j] !== 0 && Math.sign(want[j]) === Math.sign(hold[j]))) continue;
      if (isNaN(grid.coins[j].c[i])) continue;
      const cost = Math.abs(gap) * (o.fee + o.slip);
      if (active) { equity *= 1 - cost; fees += cost * equity; trades++; turnover += Math.abs(gap); if (o.log) tradeLog.push([grid.t[i], j, gap]); }
      hold[j] = want[j];
    }
    // daily bookkeeping
    const dk = Math.floor(grid.t[i] / D);
    if (dk !== dayKey) { if (dayKey >= 0 && active) { ret.push(equity / dayStart - 1); daily.push([dayKey, equity / dayStart - 1]); } dayKey = dk; dayStart = equity; }
    if (active) { eq[i] = equity; if (equity > peak) peak = equity; mdd = Math.max(mdd, 1 - equity / peak); }
  }
  const dr = daily.map((d) => d[1]), m = dr.reduce((a, b) => a + b, 0) / Math.max(1, dr.length), sd = Math.sqrt(dr.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, dr.length));
  const years = dr.length / 365;
  const byYear = {};
  for (const [dk, r] of daily) { const y = new Date(dk * D * 1000).getUTCFullYear(); byYear[y] = (byYear[y] || 1) * (1 + r); }
  for (const y in byYear) byYear[y] = +((byYear[y] - 1) * 100).toFixed(1);
  return {
    days: dr.length, cagr: years > 0 ? Math.pow(equity, 1 / years) - 1 : 0, vol: sd * Math.sqrt(365), sharpe: sd > 0 ? (m / sd) * Math.sqrt(365) : 0, maxDD: mdd, final: equity,
    trades, tradesPerDay: trades / Math.max(1, dr.length), turnoverPerYear: turnover / Math.max(1e-9, years), feesPct: fees * 100, fundingPct: fundingPaid * 100, byYear, eq, daily, tradeLog,
    // live use: the desired weight per coin at the last bar, and each component's state there
    lastWant: lastWant ? Array.from(lastWant) : null, portScale,
    lastComponents: comps.map((cs) => cs.map((c) => ({ tf: c.tf, L: c.L, layer: c.layer, s: c.sig[n - 1] }))),
    lastVol: vols.map((v) => v[n - 1]), lastXsec: xs ? xs.map((x) => x[n - 1]) : null,
  };
}

module.exports = { hourRange, TF_HOURS, TF, LOOKBACKS, LAYER, loadCoin, loadCsvPlain, align, resample, donchian, toGrid, dailyVol, crossMomentum, simulate, DEFAULT, bucketOf, bucketEnd };
