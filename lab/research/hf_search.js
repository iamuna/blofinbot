// Random search + local refinement for 1-minute strategies that trade 100–200 times a day.
// usage: node hf_search.js <family> <samples> <outfile>
'use strict';
const H = require('./hf.js'), fs = require('fs');
const [FAM, SAMPLES, OUT] = [process.argv[2], +(process.argv[3] || 1200), process.argv[4] || 'hf_' + process.argv[2] + '.json'];
const D = H.loadHF('/home/claude/data/hf8.bin', '2024-04-01', '2026-10-19');
const idx = (iso) => { const t = Date.parse(iso) / 1000; let lo = 0, hi = D.n; while (lo < hi) { const m = (lo + hi) >> 1; if (D.t[m] < t) lo = m + 1; else hi = m; } return lo; };
const W = { era: [idx('2024-04-08'), idx('2025-04-01')], train: [idx('2025-10-18'), idx('2026-05-18')], val: [idx('2026-05-18'), idx('2026-08-18')], test: [idx('2026-08-18'), D.n] };
let seed = 12345 + FAM.length * 77;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const SPACE = {
  mr: { n: [10, 15, 20, 30, 45, 60, 90], z: [0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3], off: [0, 0.1, 0.25, 0.5, 0.75, 1], ttl: [1, 2, 3, 5], tpMode: ['mean', 'bps'], tpBps: [3, 5, 8, 12, 20], slBps: [8, 12, 20, 30, 50, 80], hold: [3, 5, 10, 20, 45], imbK: [0, 0, 3, 5, 10], imbT: [0, 0.1, 0.2, 0.3], trendN: [0, 0, 60, 240], trendMax: [0.5, 1, 2, 4], vol: [0, 0, 'calm', 'volatile'], side: ['both', 'both', 'long', 'short'] },
  grid: { n: [5, 10, 20, 30, 60], sBps: [2, 3, 5, 8, 12, 20], tpBps: [2, 3, 5, 8, 12, 20], slBps: [5, 10, 20, 40, 80], ttl: [1, 2, 3], hold: [5, 10, 30, 60, 120], trendN: [0, 0, 60, 240], trendMax: [0.5, 1, 2, 4], vol: [0, 0, 'calm', 'volatile'], side: ['both', 'both', 'long', 'short'] },
  flow: { k: [1, 2, 3, 5, 10], thr: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], br: [3, 5, 10, 20, 30], tpBps: [5, 8, 12, 20, 30, 40], slBps: [5, 8, 12, 20, 30, 40], hold: [2, 3, 5, 10, 20, 30], withTrend: [false, true], trendN: [0, 60, 240], side: ['both', 'both', 'long', 'short'] },
  tpull: { n: [10, 15, 20, 30, 45, 60], z: [0.5, 0.8, 1, 1.25, 1.5, 2], off: [0, 0.1, 0.25, 0.5], ttl: [1, 2, 3, 5], tpMode: ['bps', 'bps', 'mean'], tpBps: [3, 5, 8, 12, 20, 30], slBps: [8, 12, 20, 30, 50], hold: [3, 5, 10, 20, 45], imbK: [0, 0, 3, 5], imbT: [0, 0.1, 0.2], trendN: [60, 240, 720], trendDir: [1], trendMin: [0.25, 0.5, 1, 2], trendMax: [99], vol: [0, 0, 'calm', 'volatile'], side: ['both'] },
  flowfade: { k: [1, 2, 3, 5], thr: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8], off: [0, 0.1, 0.25, 0.5, 1], ttl: [1, 2, 3], tpBps: [3, 5, 8, 12, 20], slBps: [8, 12, 20, 30, 60], hold: [3, 5, 10, 20, 30], side: ['both', 'both', 'long', 'short'] },
};
const sp = SPACE[FAM];
const sample = () => { const p = { fam: FAM === 'tpull' ? 'mr' : FAM }; for (const k in sp) p[k] = pick(sp[k]); return p; };
const mutate = (p) => { const q = Object.assign({}, p), k = pick(Object.keys(sp)); q[k] = pick(sp[k]); return q; };
const tstat = (res, fees) => { const nets = res.trades.map((x) => x.gross - (x.mIn ? fees.maker : fees.taker) - (x.mOut ? fees.maker : fees.taker)); const n = nets.length; if (n < 30) return { t: -99, mean: 0 }; const m = nets.reduce((a, b) => a + b, 0) / n, s = Math.sqrt(nets.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1)); return { t: (m / s) * Math.sqrt(n), mean: m }; };
const evalW = (p, w) => H.run(D, p, H.FEES.zero, W[w][0], W[w][1]);
const LO = +(process.env.MINDAY || 90), HI = +(process.env.MAXDAY || 260);
const score = (r) => { // train objective: VIP1 net t-stat, trades/day must be within [LO, HI]
  const v = tstat(r, H.FEES.vip1);
  // hard band: only configurations that actually trade LO–HI times a day compete
  if (r.perDay < LO || r.perDay > HI) return -1000 - Math.abs(r.perDay - (LO + HI) / 2);
  return v.t;
};
const t0 = Date.now();
let pool = [];
let bestGross = null;
for (let k = 0; k < SAMPLES; k++) {
  const p = sample(), r = evalW(p, 'train'), s = score(r);
  if (r.perDay >= LO && r.perDay <= HI && (!bestGross || r.grossBps > bestGross.g)) bestGross = { g: r.grossBps, p, perDay: r.perDay };
  pool.push({ p, s, perDay: r.perDay, gross: r.grossBps });
  if (pool.length > 400) { pool.sort((a, b) => b.s - a.s); pool = pool.slice(0, 200); }
}
pool.sort((a, b) => b.s - a.s);
// local refinement around the 6 best
const seen = new Set(pool.map((x) => JSON.stringify(x.p)));
for (const base of pool.slice(0, 6)) {
  let cur = base;
  for (let k = 0; k < 60; k++) {
    const q = mutate(cur.p), key = JSON.stringify(q); if (seen.has(key)) continue; seen.add(key);
    const r = evalW(q, 'train'), s = score(r);
    if (r.perDay >= LO && r.perDay <= HI && (!bestGross || r.grossBps > bestGross.g)) bestGross = { g: r.grossBps, p: q, perDay: r.perDay };
    const cand = { p: q, s, perDay: r.perDay, gross: r.grossBps };
    pool.push(cand);
    if (s > cur.s) cur = cand;
  }
}
pool.sort((a, b) => b.s - a.s);
const uniq = []; const us = new Set();
for (const x of pool) { const k = JSON.stringify(x.p); if (us.has(k)) continue; us.add(k); uniq.push(x); if (uniq.length >= 8) break; }
const fmt = (r, fees) => { const v = H.reprice(r, H.FEES[fees], 0, 0); return null; };
const out = [];
for (const x of uniq) {
  const row = { p: x.p, trainScore: +x.s.toFixed(2) };
  for (const w of ['train', 'val', 'test', 'era']) {
    const r = evalW(x.p, w);
    const v1 = tstat(r, H.FEES.vip1), st = tstat(r, H.FEES.standard);
    const days = (D.t[W[w][1] - 1] - D.t[W[w][0]]) / 86400;
    const tot = (fees) => r.trades.reduce((a, t) => a + t.gross - (t.mIn ? fees.maker : fees.taker) - (t.mOut ? fees.maker : fees.taker), 0) / 100;
    row[w] = { perDay: +r.perDay.toFixed(1), grossBps: +r.grossBps.toFixed(2), vip1Bps: +v1.mean.toFixed(2), stdBps: +st.mean.toFixed(2), vip1Pct: +tot(H.FEES.vip1).toFixed(1), stdPct: +tot(H.FEES.standard).toFixed(1), win: +r.win.toFixed(3), n: r.n, days: +days.toFixed(0) };
  }
  out.push(row);
}
fs.writeFileSync(OUT, JSON.stringify({ fam: FAM, samples: SAMPLES, seconds: Math.round((Date.now() - t0) / 1000), bestGross, top: out }, null, 1));
console.log(FAM, 'done in', Math.round((Date.now() - t0) / 1000), 's; best gross at 90–260/day:', bestGross && bestGross.g.toFixed(2), 'bps');
for (const r of out.slice(0, 5)) console.log(FAM, JSON.stringify(r.p).slice(0, 150), '\n   train', JSON.stringify(r.train), '\n   val  ', JSON.stringify(r.val), '\n   test ', JSON.stringify(r.test), '\n   era  ', JSON.stringify(r.era));
