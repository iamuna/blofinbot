/* BTC Strategy Lab — engine. Pure functions; runs in the page and inside a Web Worker. */
var Engine = (function () {
  'use strict';

  // ───────────────────────────── utilities
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const nanArr = (n) => new Float64Array(n).fill(NaN);

  // ───────────────────────────── datasets
  function makeDataset(bars, meta) {
    const n = bars.length;
    const D = { n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), meta: meta || {}, cache: new Map() };
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      D.t[i] = b.t; D.o[i] = b.o; D.h[i] = b.h; D.l[i] = b.l; D.c[i] = b.c; D.v[i] = b.v || 0;
    }
    D.tf = detectTf(D.t);
    D.barsPerYear = (365 * 86400) / D.tf;
    return D;
  }
  function datasetFromArrays(a, meta) {
    const D = { n: a.t.length, t: a.t, o: a.o, h: a.h, l: a.l, c: a.c, v: a.v, meta: meta || {}, cache: new Map() };
    D.tf = detectTf(D.t);
    D.barsPerYear = (365 * 86400) / D.tf;
    return D;
  }
  function toArrays(D) { return { t: D.t, o: D.o, h: D.h, l: D.l, c: D.c, v: D.v }; }
  function detectTf(t) {
    const n = t.length; if (n < 2) return 60;
    const diffs = [];
    for (let i = 1; i < Math.min(n, 400); i++) diffs.push(t[i] - t[i - 1]);
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)] || 60;
  }
  function sliceDataset(D, from, to) {
    const bars = [];
    for (let i = from; i < to; i++) bars.push({ t: D.t[i], o: D.o[i], h: D.h[i], l: D.l[i], c: D.c[i], v: D.v[i] });
    return makeDataset(bars, D.meta);
  }

  // Simulated BTC-like 1-minute candles: trending and ranging regimes with volatility clustering.
  function genSample(opts) {
    opts = opts || {};
    const n = opts.n || 6000, tf = opts.tf || 60, r = rng(opts.seed || 20261018);
    const end = Math.floor((opts.end || Date.now() / 1000) / tf) * tf;
    let price = opts.start || 98000, regime = 'range', left = 0, drift = 0, anchor = price;
    let vol = 0.0008, volTarget = 0.0008;
    const bars = [];
    for (let i = 0; i < n; i++) {
      if (left <= 0) {
        const u = r();
        regime = u < 0.36 ? 'up' : u < 0.68 ? 'down' : 'range';
        left = 180 + Math.floor(r() * 720);
        drift = (0.00003 + r() * 0.0001) * (regime === 'up' ? 1 : -1);
        anchor = price;
        volTarget = 0.0004 + r() * 0.001;
      }
      left--;
      vol += (volTarget - vol) * 0.03;
      vol *= Math.exp(gauss(r) * 0.06);
      vol = clamp(vol, 0.00018, 0.0045);
      const mu = regime === 'range' ? -0.012 * Math.log(price / anchor) : drift;
      let z = gauss(r);
      if (r() < 0.012) z *= 3.2;
      const ret = mu + vol * z;
      const o = price, c = price * Math.exp(ret);
      const wick = vol * 0.75;
      let h = Math.max(o, c) * Math.exp(Math.abs(gauss(r)) * wick);
      let l = Math.min(o, c) * Math.exp(-Math.abs(gauss(r)) * wick);
      if (regime === 'range' && r() < 0.01) { if (r() < 0.5) l *= 1 - vol * 3; else h *= 1 + vol * 3; }
      const v = 18 * Math.exp(gauss(r) * 0.45) * (1 + 2.2 * Math.abs(z)) * (vol / 0.0008);
      bars.push({ t: end - (n - 1 - i) * tf, o, h, l, c, v });
      price = c;
    }
    return bars;
  }

  // CSV / JSON candle import: TradingView exports, Binance kline CSVs, BloFin/OKX JSON, generic OHLCV.
  function parseTime(x) {
    if (x === undefined || x === null || x === '') return NaN;
    const num = typeof x === 'number' ? x : (/^\s*-?\d+(\.\d+)?\s*$/.test(String(x)) ? parseFloat(x) : NaN);
    if (!isNaN(num)) {
      if (num > 1e14) return Math.floor(num / 1e6);
      if (num > 1e11) return Math.floor(num / 1e3);
      return Math.floor(num);
    }
    let s = String(x).trim().replace(/^"|"$/g, '');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
    const ms = Date.parse(s);
    return isNaN(ms) ? NaN : Math.floor(ms / 1000);
  }
  function parseCandles(text) {
    text = String(text || '').trim();
    if (!text) return { bars: [], error: 'The file is empty.' };
    let rows = [];
    if (text[0] === '[' || text[0] === '{') {
      let js;
      try { js = JSON.parse(text); } catch (e) { return { bars: [], error: 'That looks like JSON but could not be read: ' + e.message }; }
      let arr = Array.isArray(js) ? js : (js.data || js.result || js.candles || js.klines || []);
      if (arr && !Array.isArray(arr) && typeof arr === 'object') { const k = Object.keys(arr).find((kk) => Array.isArray(arr[kk])); arr = k ? arr[k] : []; }
      for (const r of arr) {
        if (Array.isArray(r)) rows.push({ t: parseTime(r[0]), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +(r[5] || 0) });
        else if (r && typeof r === 'object') {
          const g = (...ks) => { for (const k of ks) if (r[k] !== undefined) return r[k]; return undefined; };
          rows.push({ t: parseTime(g('time', 't', 'timestamp', 'ts', 'open_time', 'openTime', 'date')), o: +g('open', 'o'), h: +g('high', 'h'), l: +g('low', 'l'), c: +g('close', 'c'), v: +(g('volume', 'vol', 'v') || 0) });
        }
      }
    } else {
      const lines = text.split(/\r?\n/).filter((s) => s.trim());
      const first = lines[0];
      const delim = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
      const split = (s) => s.split(delim).map((x) => x.trim().replace(/^"|"$/g, ''));
      const head = split(first);
      const hasHeader = head.some((x) => /[a-df-z]/i.test(x) && isNaN(parseTime(x)));
      let idx = { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5 };
      if (hasHeader) {
        const find = (re) => head.findIndex((hd) => re.test(hd.toLowerCase()));
        idx = { t: find(/^(time|date|datetime|timestamp|ts|open[ _]?time|unix)/), o: find(/^(open|o)$/), h: find(/^(high|h)$/), l: find(/^(low|l)$/), c: find(/^(close|c|last)$/), v: find(/^(volume|vol|v|base[ _]?volume)/) };
        if (idx.t < 0) idx.t = 0;
        if (idx.o < 0 || idx.h < 0 || idx.l < 0 || idx.c < 0) return { bars: [], error: 'Could not find open, high, low and close columns in the header.' };
      }
      for (let k = hasHeader ? 1 : 0; k < lines.length; k++) {
        const p = split(lines[k]);
        rows.push({ t: parseTime(p[idx.t]), o: +p[idx.o], h: +p[idx.h], l: +p[idx.l], c: +p[idx.c], v: idx.v >= 0 ? +(p[idx.v] || 0) : 0 });
      }
    }
    rows = rows.filter((b) => isFinite(b.t) && isFinite(b.o) && isFinite(b.h) && isFinite(b.l) && isFinite(b.c) && b.h >= b.l && b.o > 0);
    rows.forEach((b) => { if (!isFinite(b.v)) b.v = 0; b.h = Math.max(b.h, b.o, b.c); b.l = Math.min(b.l, b.o, b.c); });
    rows.sort((a, b) => a.t - b.t);
    const out = [];
    for (const b of rows) if (!out.length || b.t > out[out.length - 1].t) out.push(b);
    if (out.length < 300) return { bars: out, error: out.length ? 'Only ' + out.length + ' candles found. Load at least 300 for meaningful tests.' : 'No candles found. Expected columns: time, open, high, low, close, volume.' };
    return { bars: out, error: null };
  }
  function resample(D, factor) {
    if (factor <= 1) return D;
    const span = D.tf * factor, bars = [];
    let cur = null;
    for (let i = 0; i < D.n; i++) {
      const bucket = Math.floor(D.t[i] / span) * span;
      if (!cur || cur.t !== bucket) { if (cur) bars.push(cur); cur = { t: bucket, o: D.o[i], h: D.h[i], l: D.l[i], c: D.c[i], v: D.v[i] }; }
      else { cur.h = Math.max(cur.h, D.h[i]); cur.l = Math.min(cur.l, D.l[i]); cur.c = D.c[i]; cur.v += D.v[i]; }
    }
    if (cur) bars.push(cur);
    return makeDataset(bars, D.meta);
  }

  // ───────────────────────────── indicators (all causal: value at i uses bars ≤ i)
  function memo(D, key, fn) {
    let v = D.cache.get(key);
    if (v === undefined) { v = fn(); D.cache.set(key, v); }
    return v;
  }
  function firstValid(src) { for (let i = 0; i < src.length; i++) if (!isNaN(src[i])) return i; return src.length; }
  function smaArr(src, n) {
    const out = nanArr(src.length), f = firstValid(src);
    let s = 0;
    for (let i = f; i < src.length; i++) {
      s += src[i];
      if (i - f >= n) s -= src[i - n];
      if (i - f >= n - 1) out[i] = s / n;
    }
    return out;
  }
  function emaArr(src, n) {
    const out = nanArr(src.length), f = firstValid(src), k = 2 / (n + 1);
    if (f + n > src.length) return out;
    let s = 0;
    for (let i = f; i < f + n; i++) s += src[i];
    let e = s / n; out[f + n - 1] = e;
    for (let i = f + n; i < src.length; i++) { e = src[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }
  const ma = (D, type, n) => memo(D, type + n, () => (type === 'SMA' ? smaArr(D.c, n) : emaArr(D.c, n)));
  function rsi(D, n) {
    return memo(D, 'rsi' + n, () => {
      const c = D.c, out = nanArr(D.n);
      let g = 0, l = 0;
      for (let i = 1; i < D.n; i++) {
        const ch = c[i] - c[i - 1], up = ch > 0 ? ch : 0, dn = ch < 0 ? -ch : 0;
        if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
        else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
      }
      return out;
    });
  }
  function macd(D, f, s, sig) {
    return memo(D, 'macd' + f + '_' + s + '_' + sig, () => {
      const ef = emaArr(D.c, f), es = emaArr(D.c, s), m = nanArr(D.n);
      for (let i = 0; i < D.n; i++) m[i] = ef[i] - es[i];
      const sg = emaArr(m, sig), hist = nanArr(D.n);
      for (let i = 0; i < D.n; i++) hist[i] = m[i] - sg[i];
      return { m, s: sg, h: hist };
    });
  }
  function bb(D, n, k) {
    return memo(D, 'bb' + n + '_' + k, () => {
      const c = D.c, mid = smaArr(c, n), up = nanArr(D.n), lo = nanArr(D.n);
      let s = 0, s2 = 0;
      for (let i = 0; i < D.n; i++) {
        s += c[i]; s2 += c[i] * c[i];
        if (i >= n) { s -= c[i - n]; s2 -= c[i - n] * c[i - n]; }
        if (i >= n - 1) { const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean)); up[i] = mean + k * sd; lo[i] = mean - k * sd; }
      }
      return { mid, up, lo };
    });
  }
  function atr(D, n) {
    n = n || 14;
    return memo(D, 'atr' + n, () => {
      const out = nanArr(D.n);
      let a = 0;
      for (let i = 1; i < D.n; i++) {
        const tr = Math.max(D.h[i] - D.l[i], Math.abs(D.h[i] - D.c[i - 1]), Math.abs(D.l[i] - D.c[i - 1]));
        if (i <= n) { a += tr; if (i === n) { a /= n; out[i] = a; } }
        else { a = (a * (n - 1) + tr) / n; out[i] = a; }
      }
      return out;
    });
  }
  function volSma(D, n) { return memo(D, 'vsma' + n, () => smaArr(D.v, n)); }
  // annualised realised volatility over the last 100 bars (used for risk-parity sizing)
  function realizedVol(D) {
    return memo(D, 'rv', () => {
      const out = nanArr(D.n), n = 100;
      let s = 0, s2 = 0;
      const r = new Float64Array(D.n);
      for (let i = 1; i < D.n; i++) r[i] = Math.log(D.c[i] / D.c[i - 1]);
      for (let i = 1; i < D.n; i++) {
        s += r[i]; s2 += r[i] * r[i];
        if (i > n) { s -= r[i - n]; s2 -= r[i - n] * r[i - n]; }
        if (i >= n) { const m = s / n; out[i] = Math.sqrt(Math.max(1e-12, s2 / n - m * m)) * Math.sqrt(D.barsPerYear); }
      }
      return out;
    });
  }

  // Swing pivots: a pivot at i is only known k bars later (conf = i + k). Rules respect conf.
  function pivots(D, k) {
    return memo(D, 'piv' + k, () => {
      const out = [];
      for (let i = k; i < D.n - k; i++) {
        let isH = true, isL = true;
        for (let j = 1; j <= k; j++) {
          if (isH && (D.h[i - j] >= D.h[i] || D.h[i + j] > D.h[i])) isH = false;
          if (isL && (D.l[i - j] <= D.l[i] || D.l[i + j] < D.l[i])) isL = false;
          if (!isH && !isL) break;
        }
        const H = isH ? { i, type: 'H', price: D.h[i], conf: i + k } : null;
        const L = isL ? { i, type: 'L', price: D.l[i], conf: i + k } : null;
        if (H && L) { if (D.c[i] >= D.o[i]) out.push(L, H); else out.push(H, L); }
        else if (H) out.push(H); else if (L) out.push(L);
      }
      return out;
    });
  }
  // Incremental alternating zig-zag built only from confirmed pivots.
  function ZigZag(piv) { this.p = piv; this.ptr = 0; this.pts = []; this.ver = 0; }
  ZigZag.prototype.advance = function (j) {
    while (this.ptr < this.p.length && this.p[this.ptr].conf <= j) {
      const q = this.p[this.ptr++], pts = this.pts, last = pts[pts.length - 1];
      if (!last || last.type !== q.type) { pts.push(q); this.ver++; }
      else if ((q.type === 'H' && q.price >= last.price) || (q.type === 'L' && q.price <= last.price)) { pts[pts.length - 1] = q; this.ver++; }
    }
    return this.pts;
  };

  // ───────────────────────────── harmonic ratios (Scott Carney)
  const HARMONICS = {
    Gartley: { ab: [0.618, 0.618], bc: [0.382, 0.886], d: 0.786, ext: [1.13, 1.618] },
    Bat: { ab: [0.382, 0.5], bc: [0.382, 0.886], d: 0.886, ext: [1.618, 2.618] },
    Butterfly: { ab: [0.786, 0.786], bc: [0.382, 0.886], d: 1.27, ext: [1.618, 2.24] },
    Crab: { ab: [0.382, 0.618], bc: [0.382, 0.886], d: 1.618, ext: [2.24, 3.618] },
  };
  const inR = (x, lo, hi, tol) => x >= lo * (1 - tol) && x <= hi * (1 + tol);
  // pts: last four zig-zag points X,A,B,C. Returns matching patterns with their D level.
  function harmonicCandidates(X, A, B, C, tol, only) {
    const bull = X.type === 'L';
    const sgn = bull ? 1 : -1;
    const XA = (A.price - X.price) * sgn, AB = (A.price - B.price) * sgn, BC = (C.price - B.price) * sgn;
    if (XA <= 0 || AB <= 0 || BC <= 0) return [];
    const abR = AB / XA, bcR = BC / AB, out = [];
    for (const name in HARMONICS) {
      if (only && only !== 'any' && only !== name) continue;
      const H = HARMONICS[name];
      if (!inR(abR, H.ab[0], H.ab[1], tol) || !inR(bcR, H.bc[0], H.bc[1], tol)) continue;
      const D = A.price - sgn * H.d * XA;
      const ext = ((C.price - D) * sgn) / BC;
      if (!inR(ext, H.ext[0], H.ext[1], tol * 2)) continue;
      const band = Math.max(tol * 0.5 * XA, 0);
      out.push({ name, bull, D, top: D + band, bot: D - band, X, A, B, C, ratios: { ab: abR, bc: bcR, ext } });
    }
    return out;
  }

  // ───────────────────────────── rule catalogue
  const RULES = {
    ma_cross: { role: 'trigger', group: 'Moving averages', label: 'MA crossover', params: { type: ['EMA', 'SMA'], fast: [9, 21, 37, 50], slow: [50, 100, 200] }, def: { type: 'EMA', fast: 21, slow: 50 }, desc: 'Fast MA crosses the slow MA.' },
    rsi_cross: { role: 'trigger', group: 'Oscillators', label: 'RSI reversal', params: { len: [7, 14, 21], lo: [20, 25, 30, 35], hi: [65, 70, 75, 80] }, def: { len: 14, lo: 30, hi: 70 }, desc: 'RSI climbs back above oversold (long) or drops below overbought (short).' },
    macd_cross: { role: 'trigger', group: 'Oscillators', label: 'MACD signal cross', params: { fast: [8, 12], slow: [21, 26], sig: [5, 9], zone: ['any', 'beyond zero'] }, def: { fast: 12, slow: 26, sig: 9, zone: 'any' }, desc: 'MACD line crosses its signal line.' },
    bb_revert: { role: 'trigger', group: 'Bands', label: 'Bollinger re-entry', params: { len: [20, 30], mult: [2, 2.5] }, def: { len: 20, mult: 2 }, desc: 'Close returns inside the band after closing outside it.' },
    bb_break: { role: 'trigger', group: 'Bands', label: 'Bollinger breakout', params: { len: [20, 30], mult: [2, 2.5] }, def: { len: 20, mult: 2 }, desc: 'Close breaks outside the band.' },
    sr_bounce: { role: 'trigger', group: 'Structure', label: 'Support / resistance bounce', params: { k: [3, 5, 8, 13], tol: [0.25, 0.5, 1], touches: [1, 2] }, def: { k: 5, tol: 0.5, touches: 2 }, desc: 'Wick tags a swing level and the candle closes back away from it.' },
    sr_break: { role: 'trigger', group: 'Structure', label: 'Support / resistance breakout', params: { k: [3, 5, 8, 13], tol: [0.25, 0.5], touches: [1, 2] }, def: { k: 5, tol: 0.25, touches: 2 }, desc: 'Close breaks through the nearest swing level.' },
    fib_pull: { role: 'trigger', group: 'Structure', label: 'Fibonacci pullback', params: { k: [3, 5, 8, 13], level: [0.382, 0.5, 0.618, 0.786], tol: [0.25, 0.5] }, def: { k: 5, level: 0.618, tol: 0.25 }, desc: 'Price retraces the last swing leg to a Fib level and rejects it.' },
    harmonic: { role: 'trigger', group: 'Patterns', label: 'Harmonic PRZ (Carney)', params: { k: [3, 5, 8], pattern: ['any', 'Gartley', 'Bat', 'Butterfly', 'Crab'], tol: [0.05, 0.08, 0.12] }, def: { k: 5, pattern: 'any', tol: 0.08 }, desc: 'XABC matches Gartley, Bat, Butterfly or Crab ratios and price reaches the D zone.' },
    elliott: { role: 'trigger', group: 'Patterns', label: 'Elliott impulse entry', params: { k: [3, 5, 8, 13], wave: ['3', '5', '3 or 5'] }, def: { k: 5, wave: '3 or 5' }, desc: 'Valid wave 1–2 then break of wave 1 (wave 3), or valid 1–4 count turning into wave 5.' },
    wyckoff: { role: 'trigger', group: 'Patterns', label: 'Wyckoff spring / upthrust', params: { len: [30, 60, 120], width: [6, 10, 15], vol: ['required', 'ignored'] }, def: { len: 60, width: 10, vol: 'required' }, desc: 'Price pierces a trading range and closes back inside it.' },
    price_ma: { role: 'filter', group: 'Moving averages', label: 'Price vs MA', params: { type: ['EMA', 'SMA'], len: [21, 37, 50, 100, 200, 500, 1000] }, def: { type: 'EMA', len: 200 }, desc: 'Longs only above the MA, shorts only below.' },
    ma_ribbon: { role: 'filter', group: 'Moving averages', label: 'MA ribbon aligned', params: { type: ['EMA', 'SMA'], depth: [3, 4, 5] }, def: { type: 'EMA', depth: 3 }, desc: '21 > 37 > 50 (> 100 > 200) for longs; reversed for shorts.' },
    rsi_side: { role: 'filter', group: 'Oscillators', label: 'RSI side of 50', params: { len: [7, 14, 21] }, def: { len: 14 }, desc: 'Longs with RSI above 50, shorts below.' },
    macd_side: { role: 'filter', group: 'Oscillators', label: 'MACD histogram side', params: { fast: [8, 12], slow: [21, 26], sig: [5, 9] }, def: { fast: 12, slow: 26, sig: 9 }, desc: 'Longs with a positive histogram, shorts with a negative one.' },
    regime: { role: 'filter', group: 'Regime', label: 'Regime quadrant (Dalio-style)', params: { len: [100, 200, 500], mode: ['with trend', 'calm only', 'volatile only', 'with trend + calm', 'with trend + volatile'] }, def: { len: 200, mode: 'with trend' }, desc: 'Splits the market into four quadrants (trend up/down × calm/volatile) and only trades the ones you allow.' },
  };
  const RIBBON = [21, 37, 50, 100, 200];

  function ruleKey(r) { return r.id + JSON.stringify(r.p); }
  function ruleSignals(D, r) {
    return memo(D, 'rule:' + ruleKey(r), () => RULE_FN[r.id](D, r.p));
  }
  const U8 = (n) => new Uint8Array(n);

  const RULE_FN = {
    ma_cross(D, p) {
      const f = ma(D, p.type, p.fast), s = ma(D, p.type, p.slow), L = U8(D.n), S = U8(D.n);
      if (p.fast >= p.slow) return { L, S };
      for (let i = 1; i < D.n; i++) {
        if (isNaN(s[i - 1])) continue;
        if (f[i - 1] <= s[i - 1] && f[i] > s[i]) L[i] = 1;
        if (f[i - 1] >= s[i - 1] && f[i] < s[i]) S[i] = 1;
      }
      return { L, S };
    },
    rsi_cross(D, p) {
      const r = rsi(D, p.len), L = U8(D.n), S = U8(D.n);
      for (let i = 1; i < D.n; i++) {
        if (isNaN(r[i - 1])) continue;
        if (r[i - 1] < p.lo && r[i] >= p.lo) L[i] = 1;
        if (r[i - 1] > p.hi && r[i] <= p.hi) S[i] = 1;
      }
      return { L, S };
    },
    macd_cross(D, p) {
      const m = macd(D, p.fast, p.slow, p.sig), L = U8(D.n), S = U8(D.n);
      for (let i = 1; i < D.n; i++) {
        if (isNaN(m.s[i - 1])) continue;
        const up = m.m[i - 1] <= m.s[i - 1] && m.m[i] > m.s[i], dn = m.m[i - 1] >= m.s[i - 1] && m.m[i] < m.s[i];
        if (up && (p.zone === 'any' || m.m[i] < 0)) L[i] = 1;
        if (dn && (p.zone === 'any' || m.m[i] > 0)) S[i] = 1;
      }
      return { L, S };
    },
    bb_revert(D, p) {
      const b = bb(D, p.len, p.mult), c = D.c, L = U8(D.n), S = U8(D.n);
      for (let i = 1; i < D.n; i++) {
        if (isNaN(b.lo[i - 1])) continue;
        if (c[i - 1] < b.lo[i - 1] && c[i] > b.lo[i]) L[i] = 1;
        if (c[i - 1] > b.up[i - 1] && c[i] < b.up[i]) S[i] = 1;
      }
      return { L, S };
    },
    bb_break(D, p) {
      const b = bb(D, p.len, p.mult), c = D.c, L = U8(D.n), S = U8(D.n);
      for (let i = 1; i < D.n; i++) {
        if (isNaN(b.up[i - 1])) continue;
        if (c[i - 1] <= b.up[i - 1] && c[i] > b.up[i]) L[i] = 1;
        if (c[i - 1] >= b.lo[i - 1] && c[i] < b.lo[i]) S[i] = 1;
      }
      return { L, S };
    },
    sr_bounce(D, p) { return srRule(D, p, 'bounce'); },
    sr_break(D, p) { return srRule(D, p, 'break'); },
    fib_pull(D, p) {
      const zz = new ZigZag(pivots(D, p.k)), a = atr(D, 14), L = U8(D.n), S = U8(D.n);
      let used = -1;
      for (let j = 1; j < D.n; j++) {
        const pts = zz.advance(j);
        if (pts.length < 2 || isNaN(a[j])) continue;
        const P1 = pts[pts.length - 1], P0 = pts[pts.length - 2];
        if (P1.i === used || j <= P1.conf) continue;
        const size = Math.abs(P1.price - P0.price);
        if (size < 3 * a[j]) continue;
        const tol = p.tol * a[j];
        if (P1.type === 'H') {
          const lv = P1.price - p.level * size;
          if (D.l[j] <= lv + tol && D.c[j] > lv && D.c[j] > D.o[j] && D.l[j] > P0.price) { L[j] = 1; used = P1.i; }
        } else {
          const lv = P1.price + p.level * size;
          if (D.h[j] >= lv - tol && D.c[j] < lv && D.c[j] < D.o[j] && D.h[j] < P0.price) { S[j] = 1; used = P1.i; }
        }
      }
      return { L, S };
    },
    harmonic(D, p) {
      const zz = new ZigZag(pivots(D, p.k)), L = U8(D.n), S = U8(D.n);
      let ver = -1, cands = [], used = -1, extreme = NaN;
      for (let j = 1; j < D.n; j++) {
        const pts = zz.advance(j);
        if (pts.length < 4) continue;
        const C = pts[pts.length - 1];
        if (zz.ver !== ver) {
          ver = zz.ver;
          cands = harmonicCandidates(pts[pts.length - 4], pts[pts.length - 3], pts[pts.length - 2], C, p.tol, p.pattern);
          extreme = C.price;
          // price since C must not have broken beyond C before confirmation
          for (let q = C.i + 1; q < j; q++) extreme = C.type === 'H' ? Math.max(extreme, D.h[q]) : Math.min(extreme, D.l[q]);
        }
        if (!cands.length || used === C.i) continue;
        if (C.type === 'H') extreme = Math.max(extreme, D.h[j]); else extreme = Math.min(extreme, D.l[j]);
        if (extreme !== C.price) { cands = []; continue; }
        for (const h of cands) {
          if (h.bull && D.l[j] <= h.top && D.c[j] >= h.bot) { L[j] = 1; used = C.i; break; }
          if (!h.bull && D.h[j] >= h.bot && D.c[j] <= h.top) { S[j] = 1; used = C.i; break; }
        }
      }
      return { L, S };
    },
    elliott(D, p) {
      const zz = new ZigZag(pivots(D, p.k)), a = atr(D, 14), L = U8(D.n), S = U8(D.n);
      const want3 = p.wave !== '5', want5 = p.wave !== '3';
      let used3 = -1, used5 = -1;
      for (let j = 1; j < D.n; j++) {
        const pts = zz.advance(j), m = pts.length;
        if (m < 3 || isNaN(a[j])) continue;
        if (want3) {
          const P0 = pts[m - 3], P1 = pts[m - 2], P2 = pts[m - 1];
          if (P2.i !== used3 && j > P2.conf) {
            const sg = P2.type === 'L' ? 1 : -1;
            const w1 = (P1.price - P0.price) * sg, w2 = (P1.price - P2.price) * sg;
            if (w1 > 2 * a[j] && w2 > 0) {
              const ret = w2 / w1;
              if (ret >= 0.382 && ret <= 0.886) {
                if (sg > 0 && D.c[j] > P1.price && D.c[j - 1] <= P1.price) { L[j] = 1; used3 = P2.i; }
                if (sg < 0 && D.c[j] < P1.price && D.c[j - 1] >= P1.price) { S[j] = 1; used3 = P2.i; }
              }
            }
          }
        }
        if (want5 && m >= 5) {
          const P = pts.slice(m - 5), P4 = P[4];
          if (P4.i !== used5 && j === P4.conf) {
            const sg = P4.type === 'L' ? 1 : -1;
            const w1 = (P[1].price - P[0].price) * sg, w2 = (P[1].price - P[2].price) * sg, w3 = (P[3].price - P[2].price) * sg, w4 = (P[3].price - P[4].price) * sg;
            const ok = w1 > 0 && w3 > 0 && w2 > 0 && w4 > 0 && w2 < w1 && w3 >= w1 && (P[4].price - P[1].price) * sg > 0 && w4 / w3 >= 0.236 && w4 / w3 <= 0.618 && w3 > 2 * a[j];
            if (ok && (sg > 0 ? D.c[j] > P4.price && D.c[j] > D.c[j - 1] : D.c[j] < P4.price && D.c[j] < D.c[j - 1])) {
              if (sg > 0) L[j] = 1; else S[j] = 1;
              used5 = P4.i;
            }
          }
        }
      }
      return { L, S };
    },
    wyckoff(D, p) {
      const a = atr(D, 14), vs = volSma(D, 20), L = U8(D.n), S = U8(D.n), n = p.len;
      for (let j = n + 1; j < D.n; j++) {
        const A = a[j - 1];
        if (isNaN(A)) continue;
        let hi = -Infinity, lo = Infinity;
        for (let q = j - n; q < j; q++) { if (D.h[q] > hi) hi = D.h[q]; if (D.l[q] < lo) lo = D.l[q]; }
        const w = hi - lo;
        if (w > p.width * A || w < 2 * A) continue;
        const volOk = p.vol === 'ignored' || (vs[j - 1] > 0 && D.v[j] > 1.3 * vs[j - 1]);
        if (!volOk) continue;
        if (D.l[j] < lo && D.c[j] > lo && D.l[j] > lo - 1.5 * A) L[j] = 1;
        if (D.h[j] > hi && D.c[j] < hi && D.h[j] < hi + 1.5 * A) S[j] = 1;
      }
      return { L, S };
    },
    price_ma(D, p) {
      const m = ma(D, p.type, p.len), L = U8(D.n), S = U8(D.n);
      for (let i = 0; i < D.n; i++) { if (isNaN(m[i])) continue; if (D.c[i] > m[i]) L[i] = 1; else if (D.c[i] < m[i]) S[i] = 1; }
      return { L, S };
    },
    ma_ribbon(D, p) {
      const lens = RIBBON.slice(0, p.depth), arrs = lens.map((n) => ma(D, p.type, n)), L = U8(D.n), S = U8(D.n);
      for (let i = 0; i < D.n; i++) {
        let up = true, dn = true;
        for (let q = 0; q < arrs.length - 1; q++) {
          const x = arrs[q][i], y = arrs[q + 1][i];
          if (isNaN(x) || isNaN(y)) { up = dn = false; break; }
          if (!(x > y)) up = false;
          if (!(x < y)) dn = false;
        }
        L[i] = up ? 1 : 0; S[i] = dn ? 1 : 0;
      }
      return { L, S };
    },
    rsi_side(D, p) {
      const r = rsi(D, p.len), L = U8(D.n), S = U8(D.n);
      for (let i = 0; i < D.n; i++) { if (isNaN(r[i])) continue; if (r[i] > 50) L[i] = 1; else if (r[i] < 50) S[i] = 1; }
      return { L, S };
    },
    macd_side(D, p) {
      const m = macd(D, p.fast, p.slow, p.sig), L = U8(D.n), S = U8(D.n);
      for (let i = 0; i < D.n; i++) { if (isNaN(m.h[i])) continue; if (m.h[i] > 0) L[i] = 1; else if (m.h[i] < 0) S[i] = 1; }
      return { L, S };
    },
    regime(D, p) {
      const q = regimeQuad(D, p.len), L = U8(D.n), S = U8(D.n);
      for (let i = 0; i < D.n; i++) {
        const v = q[i];
        if (v < 0) continue;
        const up = v === 0 || v === 1, calm = v === 0 || v === 2;
        let okL = true, okS = true;
        if (p.mode.indexOf('with trend') === 0) { okL = up; okS = !up; }
        if (p.mode.indexOf('calm') >= 0) { okL = okL && calm; okS = okS && calm; }
        if (p.mode.indexOf('volatile') >= 0) { okL = okL && !calm; okS = okS && !calm; }
        L[i] = okL ? 1 : 0; S[i] = okS ? 1 : 0;
      }
      return { L, S };
    },
  };

  // 0 trend up + calm, 1 trend up + volatile, 2 trend down + calm, 3 trend down + volatile, -1 unknown
  function regimeQuad(D, len) {
    return memo(D, 'quad' + len, () => {
      const e = ma(D, 'EMA', len), a = atr(D, 14), pct = nanArr(D.n), out = new Int8Array(D.n).fill(-1);
      for (let i = 0; i < D.n; i++) pct[i] = a[i] / D.c[i];
      const base = smaArr(pct, Math.min(500, Math.max(50, Math.floor(D.n / 6))));
      for (let i = 20; i < D.n; i++) {
        if (isNaN(e[i]) || isNaN(e[i - 20]) || isNaN(base[i])) continue;
        const up = D.c[i] > e[i] && e[i] >= e[i - 20];
        const down = D.c[i] < e[i] && e[i] <= e[i - 20];
        const trendUp = up || (!down && D.c[i] > e[i]);
        const calm = pct[i] <= base[i];
        out[i] = (trendUp ? 0 : 2) + (calm ? 0 : 1);
      }
      return out;
    });
  }

  function srLevels(recent, ref, tolAbs) {
    // returns sorted list of {price, touches}
    return recent.map((p) => { let t = 0; for (const q of recent) if (Math.abs(q.price - p.price) <= tolAbs) t++; return { price: p.price, touches: t, type: p.type, i: p.i }; });
  }
  function srRule(D, p, mode) {
    const piv = pivots(D, p.k), a = atr(D, 14), L = U8(D.n), S = U8(D.n), recent = [];
    let ptr = 0;
    for (let j = 1; j < D.n; j++) {
      let changed = false;
      while (ptr < piv.length && piv[ptr].conf <= j) { recent.push(piv[ptr++]); if (recent.length > 24) recent.shift(); changed = true; }
      const A = a[j];
      if (isNaN(A) || recent.length < 2) continue;
      const tol = p.tol * A;
      let sup = -Infinity, res = Infinity, supT = 0, resT = 0;
      const ref = mode === 'bounce' ? D.c[j] : D.c[j - 1];
      for (const q of recent) {
        if (q.price < ref && q.price > sup) sup = q.price;
        if (q.price > ref && q.price < res) res = q.price;
      }
      if (isFinite(sup)) for (const q of recent) if (Math.abs(q.price - sup) <= tol) supT++;
      if (isFinite(res)) for (const q of recent) if (Math.abs(q.price - res) <= tol) resT++;
      if (mode === 'bounce') {
        if (isFinite(sup) && supT >= p.touches && D.l[j] <= sup + tol && D.c[j] > sup && D.c[j - 1] > sup && D.c[j] > D.o[j]) L[j] = 1;
        if (isFinite(res) && resT >= p.touches && D.h[j] >= res - tol && D.c[j] < res && D.c[j - 1] < res && D.c[j] < D.o[j]) S[j] = 1;
      } else {
        if (isFinite(res) && resT >= p.touches && D.c[j] > res + tol * 0.25) L[j] = 1;
        if (isFinite(sup) && supT >= p.touches && D.c[j] < sup - tol * 0.25) S[j] = 1;
      }
    }
    return { L, S };
  }

  // ───────────────────────────── strategy → per-bar entry signal
  function stratKey(s) { return JSON.stringify([s.dir, s.mode, s.window, s.triggers, s.filters]); }
  function prepare(D, s) {
    return memo(D, 'prep:' + stratKey(s), () => {
      const n = D.n, sig = new Int8Array(n);
      const trig = s.triggers.map((r) => ruleSignals(D, r)), filt = s.filters.map((r) => ruleSignals(D, r));
      if (!trig.length) return { sig };
      const w = Math.max(1, s.window || 1), lastL = trig.map(() => -1e9), lastS = trig.map(() => -1e9);
      const allowL = s.dir !== 'short', allowS = s.dir !== 'long';
      for (let i = 0; i < n; i++) {
        let anyL = false, anyS = false, allL = true, allS = true;
        for (let k = 0; k < trig.length; k++) {
          if (trig[k].L[i]) { lastL[k] = i; anyL = true; }
          if (trig[k].S[i]) { lastS[k] = i; anyS = true; }
          if (i - lastL[k] >= w) allL = false;
          if (i - lastS[k] >= w) allS = false;
        }
        let goL = s.mode === 'all' ? allL && anyL : anyL, goS = s.mode === 'all' ? allS && anyS : anyS;
        if (goL || goS) for (const f of filt) { if (!f.L[i]) goL = false; if (!f.S[i]) goS = false; }
        goL = goL && allowL; goS = goS && allowS;
        sig[i] = goL && !goS ? 1 : goS && !goL ? -1 : 0;
      }
      return { sig };
    });
  }

  // ───────────────────────────── simulator (bar by bar; also drives the paper-trading bot)
  // Risk governor mirrors btc_bot/risk.py RiskPolicy: hard limits, never optimised.
  const GOV_DEFAULT = { on: true, minRisk: 0.05, maxRisk: 0.5, dailyLoss: 2, maxDD: 6, streakReduce: 3, streakStop: 6, minStopAtr: 0.65, maxStopAtr: 2.5 };
  function newState(cfg) {
    return { cfg, cash: cfg.equity, pos: null, pending: null, trades: [], peak: cfg.equity, maxDD: 0, blown: false, hwm: cfg.equity, day: -1, dayStart: cfg.equity, streak: 0, rejects: {}, halted: null };
  }
  function gate(S, D, i) {
    const g = S.cfg.gov;
    let riskPct = S.cfg.risk.riskPct;
    if (!g || !g.on) return { ok: true, riskPct };
    if (S.cash <= S.hwm * (1 - g.maxDD / 100)) return { ok: false, reason: 'account drawdown breaker' };
    if (S.cash <= S.dayStart * (1 - g.dailyLoss / 100)) return { ok: false, reason: 'daily loss breaker' };
    if (S.streak >= g.streakStop) return { ok: false, reason: 'loss-streak breaker' };
    riskPct = clamp(riskPct, g.minRisk, g.maxRisk);
    if (S.streak >= g.streakReduce) riskPct *= 0.5;
    return { ok: true, riskPct };
  }
  function stopDistance(D, s, ex, dir, gov) {
    const a = atr(D, 14)[s];
    if (isNaN(a) || a <= 0) return NaN;
    let d;
    if (ex.stop === 'pct') d = D.c[s] * ex.pct / 100;
    else if (ex.stop === 'swing') {
      let ext = dir > 0 ? Infinity : -Infinity;
      for (let q = Math.max(0, s - 10); q <= s; q++) ext = dir > 0 ? Math.min(ext, D.l[q]) : Math.max(ext, D.h[q]);
      d = Math.abs(D.c[s] - ext) + 0.1 * a;
      d = clamp(d, 0.3 * a, 6 * a);
    } else d = ex.mult * a;
    if (gov && gov.on) d = clamp(d, gov.minStopAtr * a, gov.maxStopAtr * a);
    return d;
  }
  function closePos(S, D, i, price, reason, ev) {
    const P = S.pos, cfg = S.cfg, fee = cfg.costs.fee / 100, slip = cfg.costs.slip / 100;
    let xp = price;
    if (reason !== 'target') xp = P.dir > 0 ? price * (1 - slip) : price * (1 + slip);
    const pnl = P.dir * P.qty * (xp - P.ep) - P.feeIn - P.qty * xp * fee;
    S.cash += pnl;
    S.streak = pnl < 0 ? S.streak + 1 : 0;
    if (S.cash > S.hwm) S.hwm = S.cash;
    const tr = { dir: P.dir, ei: P.ei, ep: P.ep, xi: i, xp, stop0: P.stop0, tp: P.tp, qty: P.qty, pnl, R: pnl / P.risk, reason, bars: i - P.ei + 1, rr: P.rr, sid: P.sid };
    S.trades.push(tr);
    S.pos = null;
    if (S.cash <= S.cfg.equity * 0.05) S.blown = true;
    if (ev) ev.push({ type: 'exit', i, tr });
    return tr;
  }
  // Process bar i. X = prepare(D, strat). allowEntry=false stops new signals (end of a test window).
  function step(S, D, X, strat, i, allowEntry, ev) {
    const cfg = S.cfg, ex = strat.exit, fee = cfg.costs.fee / 100, slip = cfg.costs.slip / 100;
    const o = D.o[i], h = D.h[i], l = D.l[i], c = D.c[i];
    const day = Math.floor(D.t[i] / 86400);
    if (day !== S.day) {
      S.day = day;
      S.dayStart = S.cash + (S.pos ? S.pos.dir * S.pos.qty * (o - S.pos.ep) : 0);
      if (cfg.gov && cfg.gov.on && S.streak >= cfg.gov.streakStop) S.streak = 0; // loss-streak pause lasts until the next UTC day
    }
    // 1 — fill an entry signalled on the previous close
    if (S.pending && !S.pos) {
      const pd = S.pending; S.pending = null;
      const ep = pd.dir > 0 ? o * (1 + slip) : o * (1 - slip);
      const d = pd.d;
      const stop = ep - pd.dir * d, tp = ep + pd.dir * pd.rr * d;
      const eq = S.cash;
      let qty;
      if (cfg.risk.mode === 'vol') {
        const rv = realizedVol(D)[pd.s];
        const notional = eq * (cfg.risk.targetVol / 100) / (isNaN(rv) || rv <= 0 ? 0.6 : rv);
        qty = notional / ep;
      } else qty = (eq * pd.riskPct / 100) / d;
      qty = Math.min(qty, (eq * cfg.risk.maxLev) / ep);
      if (qty > 0 && isFinite(qty)) {
        S.pos = { dir: pd.dir, ei: i, ep, stop, stop0: stop, tp, d, qty, risk: qty * d, feeIn: qty * ep * fee, best: ep, rr: pd.rr, sid: pd.sid, be: false, exit: pd.exit || ex };
        if (ev) ev.push({ type: 'enter', i, pos: S.pos });
      }
    }
    // 2 — stops and targets against this bar's range (stop assumed first when both are touched)
    const P = S.pos;
    if (P) {
      if (P.dir > 0) {
        if (o <= P.stop && P.ei < i) closePos(S, D, i, o, 'stop', ev);
        else if (l <= P.stop) closePos(S, D, i, P.stop, P.stop > P.stop0 ? (P.stop >= P.ep ? 'trail' : 'stop') : 'stop', ev);
        else if (o >= P.tp && P.ei < i) closePos(S, D, i, o, 'target', ev);
        else if (h >= P.tp) closePos(S, D, i, P.tp, 'target', ev);
      } else {
        if (o >= P.stop && P.ei < i) closePos(S, D, i, o, 'stop', ev);
        else if (h >= P.stop) closePos(S, D, i, P.stop, P.stop < P.stop0 ? (P.stop <= P.ep ? 'trail' : 'stop') : 'stop', ev);
        else if (o <= P.tp && P.ei < i) closePos(S, D, i, o, 'target', ev);
        else if (l <= P.tp) closePos(S, D, i, P.tp, 'target', ev);
      }
    }
    // 3 — end-of-bar management: breakeven, trailing (stops only ever tighten), time stop, opposite signal
    if (S.pos) {
      const Q = S.pos, a = atr(D, 14)[i], qx = Q.exit || ex;
      Q.best = Q.dir > 0 ? Math.max(Q.best, h) : Math.min(Q.best, l);
      const fav = (Q.best - Q.ep) * Q.dir;
      if (qx.be > 0 && !Q.be && fav >= qx.be * Q.d) {
        const ns = Q.ep + Q.dir * Q.ep * fee * 2;
        if ((ns - Q.stop) * Q.dir > 0) { Q.stop = ns; Q.be = true; if (ev) ev.push({ type: 'be', i, stop: ns }); }
      }
      if (qx.trail > 0 && fav >= qx.trailAfter * Q.d && !isNaN(a)) {
        const ns = Q.best - Q.dir * qx.trail * a;
        if ((ns - Q.stop) * Q.dir > 0) { Q.stop = ns; if (ev) ev.push({ type: 'trail', i, stop: ns }); }
      }
      if (qx.maxBars > 0 && i - Q.ei + 1 >= qx.maxBars) closePos(S, D, i, c, 'time', ev);
      else if (qx.opp && X.sig[i] === -Q.dir) closePos(S, D, i, c, 'signal', ev);
    }
    // 4 — new signal at this close → risk governor → fill next open
    if (!S.pos && !S.pending && allowEntry && !S.blown) {
      const sg = X.sig[i];
      if (sg !== 0) {
        const gt = gate(S, D, i);
        if (!gt.ok) {
          S.rejects[gt.reason] = (S.rejects[gt.reason] || 0) + 1;
          if (gt.reason === 'account drawdown breaker' && !S.halted) S.halted = { i, reason: gt.reason };
          if (ev) ev.push({ type: 'reject', i, dir: sg, reason: gt.reason });
        } else {
          const d = stopDistance(D, i, ex, sg, cfg.gov);
          if (d > 0) S.pending = { dir: sg, s: i, d, rr: ex.rr, sid: strat.id, riskPct: gt.riskPct, exit: ex };
        }
      }
    }
    const unreal = S.pos ? S.pos.dir * S.pos.qty * (c - S.pos.ep) : 0;
    const eqNow = S.cash + unreal;
    if (eqNow > S.peak) S.peak = eqNow;
    const dd = (S.peak - eqNow) / S.peak;
    if (dd > S.maxDD) S.maxDD = dd;
    return eqNow;
  }

  function backtest(D, strat, cfg, from, to) {
    from = Math.max(1, from || 1); to = Math.min(D.n, to || D.n);
    const X = prepare(D, strat), S = newState(cfg), curve = new Float64Array(Math.max(0, to - from));
    for (let i = from; i < to; i++) curve[i - from] = step(S, D, X, strat, i, i < to - 1, null);
    if (S.pos) { closePos(S, D, to - 1, D.c[to - 1], 'end', null); curve[curve.length - 1] = S.cash; }
    const m = metrics(S.trades, curve, cfg, D, from, to); m.rejects = S.rejects; m.halted = S.halted;
    return { trades: S.trades, curve, from, to, metrics: m };
  }

  function metrics(trades, curve, cfg, D, from, to) {
    const n = trades.length, eq0 = cfg.equity;
    const end = curve.length ? curve[curve.length - 1] : eq0;
    let wins = 0, gw = 0, gl = 0, sR = 0, sR2 = 0, winR = 0, lossR = 0, bars = 0, rrT = 0;
    for (const t of trades) {
      sR += t.R; sR2 += t.R * t.R; bars += t.bars; rrT += t.rr;
      if (t.pnl > 0) { wins++; gw += t.pnl; winR += t.R; } else { gl -= t.pnl; lossR += t.R; }
    }
    let peak = eq0, mdd = 0, sr = 0, sr2 = 0, prev = eq0;
    for (let k = 0; k < curve.length; k++) {
      const e = curve[k];
      if (e > peak) peak = e;
      const dd = (peak - e) / peak; if (dd > mdd) mdd = dd;
      const r = prev > 0 ? e / prev - 1 : 0; sr += r; sr2 += r * r; prev = e;
    }
    const m = curve.length || 1, mean = sr / m, sd = Math.sqrt(Math.max(0, sr2 / m - mean * mean));
    const expR = n ? sR / n : 0, sdR = n > 1 ? Math.sqrt(Math.max(1e-9, (sR2 - n * expR * expR) / (n - 1))) : 1;
    const avgWin = wins ? winR / wins : 0, avgLoss = n - wins ? lossR / (n - wins) : 0;
    return {
      n, winRate: n ? wins / n : 0, netPct: (end / eq0 - 1) * 100, end,
      pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0),
      maxDD: mdd * 100, expR, sdR, sqn: n > 1 ? (expR / sdR) * Math.sqrt(Math.min(n, 100)) : 0,
      avgWinR: avgWin, avgLossR: avgLoss, realRR: avgLoss < 0 ? avgWin / -avgLoss : 0, targetRR: n ? rrT / n : 0,
      sharpe: sd > 0 ? (mean / sd) * Math.sqrt(D.barsPerYear) : 0,
      exposure: (bars / Math.max(1, to - from)) * 100, avgBars: n ? bars / n : 0,
    };
  }

  // ───────────────────────────── strategies & genetic optimiser
  const EXIT_OPTS = { stop: ['atr', 'swing', 'pct'], mult: [1, 1.5, 2, 2.5, 3], pct: [0.15, 0.3, 0.5, 1], trail: [0, 0, 1.5, 2, 3], trailAfter: [0.5, 1, 1.5, 2], be: [0, 0, 0.75, 1, 1.5], maxBars: [0, 0, 30, 60, 120, 240], opp: [false, false, true] };
  let uid = 0;
  function newId() { uid++; return 's' + Date.now().toString(36) + uid.toString(36); }
  function defaultParams(id) { return Object.assign({}, RULES[id].def); }
  function randomParams(r, id) { const ps = RULES[id].params, out = {}; for (const k in ps) out[k] = pick(r, ps[k]); fixParams(id, out); return out; }
  function fixParams(id, p) { if (id === 'ma_cross' && p.fast >= p.slow) { p.fast = 21; p.slow = Math.max(50, p.slow); } return p; }
  function roundRR(x) { return Math.round(x * 4) / 4; }
  function randomStrat(r, space) {
    const tr = space.triggers.slice(), fl = space.filters.slice();
    const nt = tr.length ? 1 + (r() < 0.35 && tr.length > 1 ? 1 : 0) : 0;
    const triggers = [];
    for (let k = 0; k < nt; k++) { const id = tr.splice(Math.floor(r() * tr.length), 1)[0]; triggers.push({ id, p: randomParams(r, id) }); }
    const nf = fl.length ? Math.floor(r() * Math.min(3, fl.length + 1)) : 0;
    const filters = [];
    for (let k = 0; k < nf; k++) { const id = fl.splice(Math.floor(r() * fl.length), 1)[0]; filters.push({ id, p: randomParams(r, id) }); }
    const s = {
      id: newId(), dir: space.dir === 'auto' ? pick(r, ['long', 'short', 'both']) : space.dir,
      mode: triggers.length > 1 && r() < 0.5 ? 'all' : 'any', window: pick(r, [1, 3, 5, 8]), triggers, filters,
      exit: { stop: pick(r, EXIT_OPTS.stop), mult: pick(r, EXIT_OPTS.mult), pct: pick(r, EXIT_OPTS.pct), rr: roundRR(space.minRR + r() * (space.maxRR - space.minRR)), trail: pick(r, EXIT_OPTS.trail), trailAfter: pick(r, EXIT_OPTS.trailAfter), be: pick(r, EXIT_OPTS.be), maxBars: pick(r, EXIT_OPTS.maxBars), opp: pick(r, EXIT_OPTS.opp) },
    };
    return s;
  }
  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function mutate(r, s0, space) {
    const s = clone(s0); s.id = newId();
    const ops = r();
    if (ops < 0.3 && (s.triggers.length || s.filters.length)) {
      const all = s.triggers.concat(s.filters), rule = pick(r, all), keys = Object.keys(RULES[rule.id].params), k = pick(r, keys);
      rule.p[k] = pick(r, RULES[rule.id].params[k]); fixParams(rule.id, rule.p);
    } else if (ops < 0.42) {
      const unused = space.triggers.filter((id) => !s.triggers.some((t) => t.id === id));
      if (s.triggers.length > 1 && (r() < 0.5 || !unused.length || s.triggers.length >= 3)) s.triggers.splice(Math.floor(r() * s.triggers.length), 1);
      else if (unused.length) { const id = pick(r, unused); s.triggers.push({ id, p: randomParams(r, id) }); }
    } else if (ops < 0.54) {
      const unused = space.filters.filter((id) => !s.filters.some((t) => t.id === id));
      if (s.filters.length && (r() < 0.5 || !unused.length || s.filters.length >= 3)) s.filters.splice(Math.floor(r() * s.filters.length), 1);
      else if (unused.length) { const id = pick(r, unused); s.filters.push({ id, p: randomParams(r, id) }); }
    } else if (ops < 0.66) {
      s.exit.rr = roundRR(clamp(s.exit.rr + (r() - 0.5) * 1.5, space.minRR, space.maxRR));
    } else if (ops < 0.9) {
      const k = pick(r, ['stop', 'mult', 'pct', 'trail', 'trailAfter', 'be', 'maxBars', 'opp']);
      s.exit[k] = pick(r, EXIT_OPTS[k]);
    } else if (ops < 0.95) {
      s.mode = s.mode === 'all' ? 'any' : 'all'; s.window = pick(r, [1, 3, 5, 8]);
    } else if (space.dir === 'auto') s.dir = pick(r, ['long', 'short', 'both']);
    if (!s.triggers.length && space.triggers.length) { const id = pick(r, space.triggers); s.triggers.push({ id, p: randomParams(r, id) }); }
    return s;
  }
  function crossover(r, a, b) {
    const s = clone(r() < 0.5 ? a : b); s.id = newId();
    const o = r() < 0.5 ? a : b;
    if (r() < 0.5) s.triggers = clone(o.triggers);
    if (r() < 0.5) s.filters = clone(o.filters);
    for (const k in s.exit) if (r() < 0.5) s.exit[k] = o.exit[k];
    return s;
  }
  // Robust fitness: expectancy is shrunk toward a small loss for small samples, R spread is floored,
  // thin samples and extra rules are penalised. This keeps the optimiser from crowning 6-trade flukes.
  function fitness(m, objective, minTrades, complexity) {
    if (m.n < 3) return -50 + m.n;
    const n = m.n, prior = 8;
    const shrunk = (m.expR * n - 0.1 * prior) / (n + prior);
    const sd = Math.max(m.sdR || 1, 0.9);
    const conf = n / (n + prior);
    let f;
    if (objective === 'expectancy') f = shrunk * 4 * Math.sqrt(Math.min(n, 60) / 60) - m.maxDD / 40;
    else if (objective === 'pf') f = (Math.min(m.pf, 4) - 1) * conf - m.maxDD / 50;
    else if (objective === 'return_dd') f = (m.netPct / Math.max(m.maxDD, 2)) * conf;
    else f = (shrunk / sd) * Math.sqrt(Math.min(n, 100)) - m.maxDD / 30;
    if (n < minTrades) f -= 4 * (1 - n / minTrades);
    return f - 0.03 * (complexity || 0);
  }
  const complexityOf = (s) => s.triggers.length + s.filters.length + (s.exit.trail > 0 ? 1 : 0) + (s.exit.be > 0 ? 1 : 0) + (s.exit.maxBars > 0 ? 1 : 0) + (s.exit.opp ? 1 : 0);
  function describe(s) {
    const lab = (r) => {
      const p = r.p;
      switch (r.id) {
        case 'ma_cross': return p.type + ' ' + p.fast + '/' + p.slow + ' cross';
        case 'rsi_cross': return 'RSI' + p.len + ' ' + p.lo + '/' + p.hi;
        case 'macd_cross': return 'MACD ' + p.fast + '/' + p.slow + '/' + p.sig + (p.zone === 'any' ? '' : ' beyond 0');
        case 'bb_revert': return 'BB' + p.len + '×' + p.mult + ' re-entry';
        case 'bb_break': return 'BB' + p.len + '×' + p.mult + ' breakout';
        case 'sr_bounce': return 'S/R bounce';
        case 'sr_break': return 'S/R breakout';
        case 'fib_pull': return 'Fib ' + p.level;
        case 'harmonic': return (p.pattern === 'any' ? 'Harmonic' : p.pattern) + ' PRZ';
        case 'elliott': return 'Elliott w' + p.wave.replace(' or ', '/');
        case 'wyckoff': return 'Wyckoff spring/UT';
        case 'price_ma': return '> ' + p.type + p.len;
        case 'ma_ribbon': return 'ribbon ×' + p.depth;
        case 'rsi_side': return 'RSI±50';
        case 'macd_side': return 'MACD side';
        case 'regime': return 'regime: ' + p.mode;
        default: return r.id;
      }
    };
    const t = s.triggers.map(lab).join(s.mode === 'all' ? ' + ' : ' | ');
    const f = s.filters.length ? ' · ' + s.filters.map(lab).join(', ') : '';
    return t + f;
  }

  // Genetic optimiser, run one generation at a time. Chronological split like btc_bot/learning.py:
  // train (evolves), validation (ranks), test (untouched until the promotion gate).
  function gateCheck(val, test, minTrades) {
    const need = Math.max(5, Math.round(minTrades / 4));
    const ok = (m) => m && m.n >= need && m.expR > 0 && m.pf > 1;
    return { pass: ok(val) && ok(test), valOk: ok(val), testOk: ok(test), need };
  }
  function createOptimizer(D, opt) {
    const r = rng(opt.seed || 1234567);
    const sp = opt.splits || [0.6, 0.8];
    const a = Math.floor(D.n * sp[0]), b = Math.floor(D.n * sp[1]);
    const warm = Math.min(Math.floor(D.n * 0.05), 300);
    const cache = new Map();
    let evals = 0, gen = 0;
    const keyOf = (s) => stratKey(s) + JSON.stringify(s.exit);
    const evalS = (s) => {
      const k = keyOf(s);
      let e = cache.get(k);
      if (!e) {
        const bt = backtest(D, s, opt.cfg, warm, a);
        e = { m: bt.metrics, f: fitness(bt.metrics, opt.objective, opt.minTrades, complexityOf(s)) };
        cache.set(k, e); evals++;
      }
      return e;
    };
    let pop = [];
    if (opt.seedStrats) for (const s of opt.seedStrats) { const c = clone(s); c.id = newId(); pop.push(c); }
    while (pop.length < opt.pop) pop.push(randomStrat(r, opt.space));
    let scored = pop.map((s) => ({ s, e: evalS(s) }));
    const valCache = new Map();
    function board(limit) {
      const seen = new Set(), rows = [];
      const sorted = scored.slice().sort((x, y) => y.e.f - x.e.f || complexityOf(x.s) - complexityOf(y.s));
      for (const x of sorted.slice(0, 40)) {
        const sig = x.e.m.n + '|' + x.e.m.netPct.toFixed(3) + '|' + x.e.m.maxDD.toFixed(3);
        if (seen.has(sig)) continue; seen.add(sig);
        const k = keyOf(x.s);
        let vt = valCache.get(k);
        if (!vt) {
          const val = backtest(D, x.s, opt.cfg, a, b).metrics, test = backtest(D, x.s, opt.cfg, b, D.n).metrics;
          vt = { val, test, vf: fitness(val, opt.objective, Math.max(5, Math.round(opt.minTrades / 3)), 0) };
          valCache.set(k, vt);
        }
        rows.push({ s: x.s, name: describe(x.s), train: x.e.m, val: vt.val, test: vt.test, fit: x.e.f, score: x.e.f + vt.vf, gate: gateCheck(vt.val, vt.test, opt.minTrades) });
      }
      rows.sort((x, y) => y.score - x.score);
      return rows.slice(0, limit || opt.top || 10);
    }
    function next() {
      if (gen >= opt.gens) return null;
      scored.sort((x, y) => y.e.f - x.e.f);
      const nextPop = scored.slice(0, Math.max(2, Math.floor(opt.pop * 0.12))).map((x) => x.s);
      const tour = () => { let best = null; for (let k = 0; k < 3; k++) { const x = scored[Math.floor(r() * scored.length)]; if (!best || x.e.f > best.e.f) best = x; } return best.s; };
      while (nextPop.length < opt.pop) {
        const u = r();
        let c;
        if (u < 0.12) c = randomStrat(r, opt.space);
        else if (u < 0.55) c = mutate(r, crossover(r, tour(), tour()), opt.space);
        else c = mutate(r, tour(), opt.space);
        if (r() < 0.3) c = mutate(r, c, opt.space);
        nextPop.push(c);
      }
      scored = nextPop.map((s) => ({ s, e: evalS(s) }));
      gen++;
      return { gen, gens: opt.gens, evals, best: scored.reduce((m, x) => Math.max(m, x.e.f), -Infinity) };
    }
    return { next, board, splits: { warm, a, b, n: D.n }, get gen() { return gen; } };
  }
  function optimize(D, opt, onGen) {
    const O = createOptimizer(D, opt);
    let p;
    while ((p = O.next())) { if (onGen) onGen(Object.assign(p, { top: (p.gen % (opt.boardEvery || 1) === 0 || p.gen === opt.gens) ? O.board() : null })); }
    return O.board();
  }

  // ───────────────────────────── market structure for drawing and for the bot's "thinking" feed
  function structureAt(D, j, k) {
    k = k || 5;
    const piv = pivots(D, k), zz = new ZigZag(piv);
    const pts = zz.advance(j).slice(-12);
    const a = atr(D, 14)[j] || 0;
    const recent = piv.filter((p) => p.conf <= j).slice(-24);
    const tol = 0.5 * a;
    const lv = srLevels(recent, D.c[j], tol);
    const levels = [];
    for (const x of lv.sort((p, q) => q.touches - p.touches)) {
      if (levels.some((y) => Math.abs(y.price - x.price) <= tol)) continue;
      levels.push(x);
      if (levels.length >= 6) break;
    }
    let sup = null, res = null;
    for (const x of levels) {
      if (x.price < D.c[j] && (!sup || x.price > sup.price)) sup = x;
      if (x.price > D.c[j] && (!res || x.price < res.price)) res = x;
    }
    let fib = null;
    if (pts.length >= 2) {
      const P1 = pts[pts.length - 1], P0 = pts[pts.length - 2];
      const size = P1.price - P0.price;
      fib = { from: P0, to: P1, up: size > 0, levels: [0.236, 0.382, 0.5, 0.618, 0.786].map((f) => ({ f, price: P1.price - f * size })), ext: [1.272, 1.618].map((f) => ({ f, price: P0.price + f * size })) };
    }
    let harm = null;
    if (pts.length >= 4) {
      const m = pts.length, c = harmonicCandidates(pts[m - 4], pts[m - 3], pts[m - 2], pts[m - 1], 0.08, 'any');
      if (c.length) harm = c[0];
    }
    let ew = null;
    if (pts.length >= 5) {
      const P = pts.slice(-5), sg = P[4].type === 'L' ? 1 : -1;
      const w1 = (P[1].price - P[0].price) * sg, w2 = (P[1].price - P[2].price) * sg, w3 = (P[3].price - P[2].price) * sg, w4 = (P[3].price - P[4].price) * sg;
      if (w1 > 0 && w2 > 0 && w2 < w1 && w3 >= w1 && w4 > 0 && (P[4].price - P[1].price) * sg > 0) ew = { pts: P, bull: sg > 0, label: 'Waves 1–4 valid, watching for wave 5' };
    }
    if (!ew && pts.length >= 3) {
      const P = pts.slice(-3), sg = P[2].type === 'L' ? 1 : -1;
      const w1 = (P[1].price - P[0].price) * sg, w2 = (P[1].price - P[2].price) * sg;
      if (w1 > 2 * a && w2 > 0 && w2 / w1 >= 0.382 && w2 / w1 <= 0.886) ew = { pts: P, bull: sg > 0, label: 'Wave 1–2 complete, wave 3 starts above ' + fmtP(P[1].price) };
    }
    let wy = null;
    const n = 60;
    if (j > n) {
      let hi = -Infinity, lo = Infinity;
      for (let q = j - n; q < j; q++) { hi = Math.max(hi, D.h[q]); lo = Math.min(lo, D.l[q]); }
      const A = atr(D, 14)[j - 1];
      if (hi - lo <= 10 * A && hi - lo >= 2 * A) wy = { hi, lo, from: j - n, to: j };
    }
    const q = regimeQuad(D, 200)[j];
    return { pts, levels, sup, res, fib, harm, ew, wy, quad: q, atr: a };
  }
  function fmtP(x) { return x >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : x.toFixed(2); }

  // Rule-by-rule status at bar j for the bot's thinking panel.
  function explain(D, s, j) {
    const rows = [];
    const w = Math.max(1, s.window || 1);
    for (const r of s.triggers) {
      const sg = ruleSignals(D, r);
      let lastL = -1, lastS = -1;
      for (let q = j; q >= Math.max(0, j - 400); q--) { if (lastL < 0 && sg.L[q]) lastL = q; if (lastS < 0 && sg.S[q]) lastS = q; if (lastL >= 0 && lastS >= 0) break; }
      rows.push({ role: 'trigger', label: RULES[r.id].label, L: lastL >= 0 && j - lastL < w, S: lastS >= 0 && j - lastS < w, agoL: lastL >= 0 ? j - lastL : null, agoS: lastS >= 0 ? j - lastS : null });
    }
    for (const r of s.filters) {
      const sg = ruleSignals(D, r);
      rows.push({ role: 'filter', label: RULES[r.id].label, L: !!sg.L[j], S: !!sg.S[j] });
    }
    return rows;
  }

  const api = { rng, genSample, parseCandles, makeDataset, datasetFromArrays, toArrays, sliceDataset, resample, detectTf, ma, emaArr, smaArr, rsi, macd, bb, atr, pivots, ZigZag, regimeQuad, RULES, RIBBON, HARMONICS, EXIT_OPTS, ruleSignals, prepare, newState, step, closePos, backtest, metrics, optimize, randomStrat, describe, structureAt, explain, defaultParams, newId, clone, stratKey, fitness, createOptimizer, gateCheck, GOV_DEFAULT };

  // ───────────────────────────── worker glue
  if (typeof importScripts === 'function' && typeof self !== 'undefined') {
    let DS = null;
    self.onmessage = function (e) {
      const m = e.data;
      if (m.cmd === 'data') { DS = datasetFromArrays(m.arrays, m.meta); return; }
      if (m.cmd === 'optimize') {
        let D = DS;
        if (m.range) D = sliceDataset(DS, m.range[0], m.range[1]);
        const t0 = Date.now(), O = createOptimizer(D, m.opt);
        let p, last = 0;
        while ((p = O.next())) {
          const now = Date.now();
          const send = now - last > 250 || p.gen === p.gens;
          if (send) { last = now; self.postMessage({ type: 'progress', job: m.job, gen: p.gen, gens: p.gens, evals: p.evals, top: (p.gen % 3 === 0 || p.gen === p.gens) ? O.board() : null, ms: now - t0, splits: O.splits }); }
        }
        self.postMessage({ type: 'done', job: m.job, top: O.board(), ms: Date.now() - t0, splits: O.splits, range: m.range || null });
      }
    };
  }
  return api;
})();
if (typeof module !== 'undefined') module.exports = Engine;
