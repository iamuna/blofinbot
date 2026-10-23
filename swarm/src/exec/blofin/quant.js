/* Instrument precision for BloFin perpetuals. Never hard-code contract sizes: read contractValue, lotSize,
 * minSize, tickSize, maxLimitSize, maxMarketSize from /api/v1/market/instruments.
 * Order size is in CONTRACTS (base qty = contracts × contractValue).
 */
'use strict';

function decimals(step) {
  const s = String(step);
  if (s.includes('e-')) return +s.split('e-')[1];
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
// integer number of steps, robust to binary noise (0.3/0.1 → 3, not 2.9999)
const steps = (x, step) => Math.floor(Math.abs(x) / step + 1e-9);
const fmt = (x, step) => (+x).toFixed(decimals(step));

function parseInstrument(r) {
  const n = (k) => +r[k];
  return { instId: r.instId, contractValue: n('contractValue'), lotSize: n('lotSize'), minSize: n('minSize'), tickSize: n('tickSize'), maxLimitSize: n('maxLimitSize') || Infinity, maxMarketSize: n('maxMarketSize') || Infinity, state: r.state || 'live' };
}

// signed base quantity → signed contracts, rounded toward zero to the lot size
function toContracts(baseQty, inst) {
  const lots = steps(baseQty / inst.contractValue, inst.lotSize);
  return Math.sign(baseQty) * +(lots * inst.lotSize).toFixed(decimals(inst.lotSize)) || 0;
}
const contractsToBase = (contracts, inst) => contracts * inst.contractValue;
// size string for an order of |contracts|, clipped to the exchange maximum; null when below the minimum
function sizeString(contracts, inst, market) {
  const max = (market ? inst.maxMarketSize : inst.maxLimitSize) || Infinity;
  let c = Math.min(Math.abs(contracts), max);
  c = steps(c, inst.lotSize) * inst.lotSize;
  if (c + 1e-12 < inst.minSize || c <= 0) return null;
  return fmt(c, inst.lotSize);
}
// passive price: a buy rounds down to the tick, a sell rounds up (never crosses by rounding)
function passivePrice(p, side, inst) {
  const t = inst.tickSize;
  const k = side === 'buy' ? Math.floor(p / t + 1e-9) : Math.ceil(p / t - 1e-9);
  return fmt(k * t, t);
}

module.exports = { decimals, parseInstrument, toContracts, contractsToBase, sizeString, passivePrice, fmt };
