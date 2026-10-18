/* Coin profiler: how does this market move? Builds the facts each coin's trading plan is built on.
 *   node lab/mtf/profile.js <research-data dir> <out dir>
 * Per coin: history, liquidity, volatility per timeframe, what fees cost relative to a typical candle,
 * whether each horizon trends or mean-reverts (variance ratios, autocorrelation), seasonality by hour and
 * weekday, beta and correlation to BTC, funding behaviour — then a plan derived from those facts.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const M = require('./mtf.js');

const COST_TAKER_BPS = 2 * (6 + 2); // round trip: taker fee + slippage, both sides
const COST_MAKER_BPS = 2 * 2;
const H = 3600;

function logret(c, step) { const r = []; for (let i = step; i < c.length; i += step) { const a = c[i - step], b = c[i]; if (a > 0 && b > 0) r.push(Math.log(b / a)); } return r; }
function variance(x) { const n = x.length; if (n < 3) return NaN; const m = x.reduce((a, b) => a + b, 0) / n; return x.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1); }
function autocorr(x) { const n = x.length; const m = x.reduce((a, b) => a + b, 0) / n; let num = 0, den = 0; for (let i = 0; i < n; i++) { den += (x[i] - m) ** 2; if (i) num += (x[i] - m) * (x[i - 1] - m); } return num / den; }
// variance ratio of q-period returns vs q × 1-period variance, on non-overlapping returns
function vr(c, base, q) { const r1 = logret(c, base), rq = logret(c, base * q); return variance(rq) / (q * variance(r1)); }
function median(a) { const s = a.filter((x) => isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
function pct(a, p) { const s = a.filter((x) => isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; }

// close of each UTC day (the 23:00 hourly candle), keyed by day number; missing days are skipped
function dayCloses(t, c) { const m = new Map(); for (let i = 0; i < t.length; i++) if (new Date(t[i] * 1000).getUTCHours() === 23 && c[i] > 0) m.set(Math.floor(t[i] / 86400), c[i]); return m; }
function dayReturns(t, c) { const dc = dayCloses(t, c), out = new Map(); for (const [k, v] of dc) if (dc.has(k - 1)) out.set(k, Math.log(v / dc.get(k - 1))); return out; }
function load5m(dir, coin) {
  const p = `${dir}/${coin}/5m.csv.gz`;
  if (!fs.existsSync(p)) return null;
  const lines = zlib.gunzipSync(fs.readFileSync(p)).toString('utf8').split('\n');
  const hdr = lines[0].split(','), ix = (k) => hdr.indexOf(k), c = [], h = [], l = [], t = [], v = [], tb = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const r = lines[i].split(','); t.push(+r[ix('t')] / 1000); h.push(+r[ix('h')]); l.push(+r[ix('l')]); c.push(+r[ix('c')]); v.push(+r[ix('v')]); tb.push(+r[ix('tbv')]); }
  return { t, h, l, c, v, tb };
}

function profileCoin(coin, hourly, five, btcDaily) {
  const c = Array.from(hourly.c), t = Array.from(hourly.t), n = c.length;
  const p = { coin, from: new Date(t[0] * 1000).toISOString().slice(0, 10), to: new Date(t[n - 1] * 1000).toISOString().slice(0, 10), days: Math.round((t[n - 1] - t[0]) / 86400) };
  // liquidity: median daily quote volume over the last 90 days
  const qvDay = []; for (let i = Math.max(0, n - 90 * 24); i + 24 <= n; i += 24) { let s = 0; for (let k = i; k < i + 24; k++) s += hourly.qv[k]; qvDay.push(s); }
  p.medianDailyVolumeUSD = Math.round(median(qvDay));
  // volatility
  const dr = [...dayReturns(t, c).values()];
  p.annualVol = +(Math.sqrt(variance(dr.slice(-365))) * Math.sqrt(365)).toFixed(3);
  // median candle range (high-low)/close in bps per timeframe, and what a taker round trip costs relative to it
  const rangeBps = (h, l, cl) => { const a = []; for (let i = 0; i < cl.length; i++) if (cl[i] > 0) a.push(((h[i] - l[i]) / cl[i]) * 1e4); return median(a); };
  const agg = (h, l, cl, k) => { const H_ = [], L_ = [], C_ = []; for (let i = 0; i + k <= cl.length; i += k) { let hi = -Infinity, lo = Infinity; for (let q = i; q < i + k; q++) { hi = Math.max(hi, h[q]); lo = Math.min(lo, l[q]); } H_.push(hi); L_.push(lo); C_.push(cl[i + k - 1]); } return [H_, L_, C_]; };
  p.range = {};
  if (five) { const N5 = five.c.length, s = Math.max(0, N5 - 365 * 288); const h5 = five.h.slice(s), l5 = five.l.slice(s), c5 = five.c.slice(s); p.range['5m'] = rangeBps(h5, l5, c5); p.range['15m'] = rangeBps(...agg(h5, l5, c5, 3)); p.range['30m'] = rangeBps(...agg(h5, l5, c5, 6)); }
  const hs = Math.max(0, n - 365 * 24), hh = Array.from(hourly.h).slice(hs), hl = Array.from(hourly.l).slice(hs), hc = c.slice(hs);
  p.range['1h'] = rangeBps(hh, hl, hc); p.range['4h'] = rangeBps(...agg(hh, hl, hc, 4)); p.range['1d'] = rangeBps(...agg(hh, hl, hc, 24));
  for (const k in p.range) p.range[k] = +p.range[k].toFixed(1);
  p.costShareTaker = {}; p.costShareMaker = {};
  for (const k in p.range) { p.costShareTaker[k] = +(COST_TAKER_BPS / p.range[k]).toFixed(3); p.costShareMaker[k] = +(COST_MAKER_BPS / p.range[k]).toFixed(3); }
  // trend vs mean reversion by horizon (last 2 years of hourly; 5m for sub-hour horizons)
  const c2 = c.slice(Math.max(0, n - 730 * 24));
  p.varianceRatio = { '4h': +vr(c2, 1, 4).toFixed(3), '1d': +vr(c2, 1, 24).toFixed(3), '1w': +vr(c2, 24, 7).toFixed(3), '1M': +vr(c.slice(Math.max(0, n - 1460 * 24)), 24, 30).toFixed(3) };
  if (five) { const c5 = five.c.slice(Math.max(0, five.c.length - 365 * 288)); p.varianceRatio['15m'] = +vr(c5, 1, 3).toFixed(3); p.varianceRatio['1h'] = +vr(c5, 1, 12).toFixed(3); }
  p.autocorr = { '1h': +autocorr(logret(c2, 1)).toFixed(4), '1d': +autocorr(logret(c, 24).slice(-730)).toFixed(4) };
  if (five) p.autocorr['5m'] = +autocorr(logret(five.c.slice(-365 * 288), 1)).toFixed(4);
  // Kaufman efficiency of daily moves over 30 days (1 = straight line, 0 = noise)
  const d = [...dayCloses(t, c).values()];
  const eff = []; for (let k = 30; k < d.length; k++) { let path = 0; for (let q = k - 29; q <= k; q++) path += Math.abs(d[q] - d[q - 1]); eff.push(Math.abs(d[k] - d[k - 30]) / path); }
  p.trendEfficiency30d = +median(eff.slice(-730)).toFixed(3);
  // seasonality (last 2 years): relative volatility and mean return by UTC hour; mean return by weekday
  const hv = new Array(24).fill(0), hn = new Array(24).fill(0), hr = new Array(24).fill(0), wr = new Array(7).fill(0), wn = new Array(7).fill(0);
  for (let i = Math.max(1, n - 730 * 24); i < n; i++) { const r = Math.log(c[i] / c[i - 1]); if (!isFinite(r)) continue; const dt = new Date(t[i] * 1000), hr_ = dt.getUTCHours(); hv[hr_] += r * r; hr[hr_] += r; hn[hr_]++; wr[dt.getUTCDay()] += r; wn[dt.getUTCDay()]++; }
  const avgV = hv.reduce((a, b) => a + b, 0) / hn.reduce((a, b) => a + b, 0);
  p.hourVol = hv.map((x, k) => +(Math.sqrt(x / hn[k]) / Math.sqrt(avgV)).toFixed(2));
  p.hourReturnBps = hr.map((x, k) => +((x / hn[k]) * 1e4).toFixed(2));
  p.weekdayReturnBps = wr.map((x, k) => +((x / Math.max(1, wn[k])) * 1e4).toFixed(1)); // Sunday = 0 (per hour)
  // beta and correlation to BTC (daily, last 365 days)
  if (btcDaily && coin !== 'BTC') {
    const mine = dayReturns(t, c);
    const xs = [], ys = []; for (const [k, r] of btcDaily) if (mine.has(k)) { xs.push(r); ys.push(mine.get(k)); }
    const X = xs.slice(-365), Y = ys.slice(-365), mx = X.reduce((a, b) => a + b, 0) / X.length, my = Y.reduce((a, b) => a + b, 0) / Y.length;
    let cov = 0, vx = 0, vy = 0; for (let i = 0; i < X.length; i++) { cov += (X[i] - mx) * (Y[i] - my); vx += (X[i] - mx) ** 2; vy += (Y[i] - my) ** 2; }
    p.betaBTC = +(cov / vx).toFixed(2); p.corrBTC = +(cov / Math.sqrt(vx * vy)).toFixed(2);
  } else { p.betaBTC = 1; p.corrBTC = 1; }
  // funding
  if (hourly.funding && hourly.funding.length) {
    const f = hourly.funding.slice(-3 * 365).map((x) => x[1]);
    p.funding = { annualMean: +((f.reduce((a, b) => a + b, 0) / f.length) * 3 * 365 * 100).toFixed(1), positiveShare: +(f.filter((x) => x > 0).length / f.length).toFixed(2), p95Annual: +(pct(f, 0.95) * 3 * 365 * 100).toFixed(1), p05Annual: +(pct(f, 0.05) * 3 * 365 * 100).toFixed(1) };
  }
  p.plan = plan(p);
  return p;
}

// Turn the facts into a plan. These rules are starting points; validation decides what survives.
function plan(p) {
  const order = ['5m', '15m', '30m', '1h', '4h', '1d'];
  const execTf = order.find((k) => p.costShareMaker[k] != null && p.costShareMaker[k] <= 0.1) || '1h';
  const minSignalTf = order.find((k) => p.costShareTaker[k] != null && p.costShareTaker[k] <= 0.08) || '1d';
  const vr = p.varianceRatio;
  const trendy = (k) => vr[k] != null && vr[k] >= 1.0;
  const notes = [];
  if (vr['15m'] != null && vr['15m'] < 0.95) notes.push('15-minute moves tend to snap back: buy dips / sell rips when entering');
  if (vr['1h'] != null && vr['1h'] < 0.95) notes.push('1-hour moves tend to snap back: avoid chasing hourly breakouts');
  if (trendy('1d') || trendy('1w') || trendy('1M')) notes.push('trends persist at ' + ['1d', '1w', '1M'].filter(trendy).join('/') + ': trend ensemble leads');
  else notes.push('no horizon shows clear persistence: smaller trend allocation');
  if (p.funding && p.funding.annualMean > 15) notes.push('funding is usually expensive for longs: crowding filter matters');
  if (p.corrBTC > 0.8) notes.push('moves mostly with BTC: counts toward the BTC risk cluster');
  const quiet = p.hourVol.map((v, h) => [h, v]).sort((a, b) => a[1] - b[1]).slice(0, 4).map((x) => x[0]);
  return {
    executionTimeframe: execTf,
    smallestSignalTimeframe: minSignalTf,
    quietestHoursUTC: quiet.sort((a, b) => a - b),
    trendHorizons: Object.keys(vr).filter(trendy),
    meanReversionHorizons: Object.keys(vr).filter((k) => vr[k] < 0.95),
    riskCluster: p.corrBTC > 0.8 ? 'BTC' : 'own',
    notes,
  };
}

function main() {
  const [dir, out] = process.argv.slice(2);
  const uni = JSON.parse(fs.readFileSync(path.join(dir, 'universe.json'), 'utf8')).selected.map((r) => r.base);
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const ok = new Set((man.coins || []).filter((c) => c.status === 'ok').map((c) => c.coin));
  fs.mkdirSync(out, { recursive: true });
  let btcDaily = null;
  const profiles = [];
  for (const coin of ['BTC', ...uni.filter((x) => x !== 'BTC')]) {
    if (!ok.has(coin)) { profiles.push({ coin, skipped: 'no data' }); continue; }
    const hc = M.loadCoin(dir, coin), five = load5m(dir, coin);
    if (coin === 'BTC') btcDaily = [...dayReturns(Array.from(hc.t), Array.from(hc.c))].sort((a, b) => a[0] - b[0]);
    const p = profileCoin(coin, hc, five, btcDaily);
    fs.writeFileSync(path.join(out, coin + '.json'), JSON.stringify(p, null, 1));
    profiles.push(p);
    console.log(coin.padEnd(8), p.from, `vol ${(p.annualVol * 100).toFixed(0)}%`, `$${(p.medianDailyVolumeUSD / 1e6).toFixed(0)}M/day`, 'VR', JSON.stringify(p.varianceRatio), 'beta', p.betaBTC, 'exec', p.plan.executionTimeframe, 'minSig', p.plan.smallestSignalTimeframe);
  }
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(profiles, null, 1));
}
if (require.main === module) main();
module.exports = { profileCoin, plan, vr };
