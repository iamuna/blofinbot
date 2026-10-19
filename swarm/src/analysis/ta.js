/* Incremental indicators (one update per closed bar, O(1) or O(window)). */
'use strict';

class Ring {
  constructor(n) { this.n = n; this.a = new Array(n); this.i = 0; this.len = 0; }
  push(x) { this.a[this.i] = x; this.i = (this.i + 1) % this.n; if (this.len < this.n) this.len++; }
  // k = 0 → newest, k = 1 → the one before …
  at(k) { if (k >= this.len) return undefined; return this.a[(this.i - 1 - k + this.n * 2) % this.n]; }
  get last() { return this.at(0); }
  toArray() { const out = []; for (let k = this.len - 1; k >= 0; k--) out.push(this.at(k)); return out; }
}

// rolling mean / std over the last n values
class RollStat {
  constructor(n) { this.r = new Ring(n); this.s = 0; this.s2 = 0; }
  push(x) {
    if (!Number.isFinite(x)) return;
    if (this.r.len === this.r.n) { const old = this.r.at(this.r.n - 1); this.s -= old; this.s2 -= old * old; }
    this.r.push(x); this.s += x; this.s2 += x * x;
  }
  get n() { return this.r.len; }
  get mean() { return this.r.len ? this.s / this.r.len : NaN; }
  get std() { const n = this.r.len; if (n < 2) return NaN; const m = this.s / n; return Math.sqrt(Math.max(0, this.s2 / n - m * m)); }
  z(x) { const sd = this.std; return sd > 0 ? (x - this.mean) / sd : 0; }
}

class EMA { constructor(n) { this.k = 2 / (n + 1); this.v = NaN; } push(x) { this.v = Number.isFinite(this.v) ? this.v + this.k * (x - this.v) : x; return this.v; } }

// Wilder ATR
class ATR {
  constructor(n = 14) { this.n = n; this.v = NaN; this.prevC = NaN; this.count = 0; this.sum = 0; }
  push(h, l, c) {
    const tr = Number.isFinite(this.prevC) ? Math.max(h - l, Math.abs(h - this.prevC), Math.abs(l - this.prevC)) : h - l;
    this.prevC = c; this.count++;
    if (this.count <= this.n) { this.sum += tr; this.v = this.sum / this.count; }
    else this.v = (this.v * (this.n - 1) + tr) / this.n;
    return this.v;
  }
}

function hiLo(ring, field, n, skip = 0) { // highest/lowest of the n values before the newest `skip`
  let hi = -Infinity, lo = Infinity;
  const end = Math.min(ring.len, n + skip);
  for (let k = skip; k < end; k++) { const x = ring.at(k)[field]; if (x > hi) hi = x; if (x < lo) lo = x; }
  return end - skip >= n ? { hi, lo } : { hi: NaN, lo: NaN };
}
function hiLoOf(ring, hiField, loField, n, skip = 0) {
  let hi = -Infinity, lo = Infinity;
  const end = Math.min(ring.len, n + skip);
  for (let k = skip; k < end; k++) { const b = ring.at(k); if (b[hiField] > hi) hi = b[hiField]; if (b[loField] < lo) lo = b[loField]; }
  return end - skip >= n ? { hi, lo } : { hi: NaN, lo: NaN };
}
// Kaufman efficiency ratio over n bars: net move / path length (1 = straight line, ~0 = chop)
function efficiency(ring, n) {
  if (ring.len < n + 1) return NaN;
  let path = 0;
  for (let k = 0; k < n; k++) path += Math.abs(ring.at(k).c - ring.at(k + 1).c);
  return path > 0 ? Math.abs(ring.at(0).c - ring.at(n).c) / path : 0;
}

module.exports = { Ring, RollStat, EMA, ATR, hiLo, hiLoOf, efficiency };
