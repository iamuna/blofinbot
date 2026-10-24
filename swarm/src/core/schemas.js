/* Message types on the swarm bus.
 *
 * Every message is an envelope { v, id, type, ts, src, trace, data }. `data` is checked against the type's
 * required fields before it is published, so a malformed message fails at its sender, not three agents later.
 * Field kinds: s string · n number · a array · o object · b boolean · ? optional (prefix).
 * `keep` = how many recent messages the bus keeps per type (Redis MAXLEN ~); the recorder keeps everything.
 * Coins are named by their BloFin base (BTC, PEPE, 1000BONK). Prices are BloFin units; sizes are base units.
 */
'use strict';

const TYPES = {
  // ── market data (BloFin = where we trade)
  'md.trade': { keep: 200000, req: { coin: 's', trades: 'a' } }, // trades: [[tsMs, px, qtyBase, side(+1 taker buy | -1 taker sell)]]
  'md.book': { keep: 100000, req: { coin: 's', ts: 'n', bids: 'a', asks: 'a', mid: 'n', spreadBps: 'n' } }, // top 5 levels, [px, qtyBase]
  'md.bar': { keep: 100000, req: { coin: 's', venue: 's', tf: 's', t: 'n', o: 'n', h: 'n', l: 'n', c: 'n', v: 'n', q: 'n' } }, // t = open time ms
  'md.ticker': { keep: 100000, req: { coin: 's', ts: 'n', last: 'n', bid: 'n', ask: 'n' } },
  'md.funding': { keep: 20000, req: { coin: 's', ts: 'n', rate: 'n', nextTs: 'n' } },
  // ── reference data (Binance USD-M = where the market's volume is)
  'ref.flow': { keep: 50000, req: { ts: 'n', coins: 'o' } }, // per second: {coin: {buyQ, sellQ, n, last, hi, lo}}
  'ref.bar': { keep: 100000, req: { coin: 's', venue: 's', tf: 's', t: 'n', o: 'n', h: 'n', l: 'n', c: 'n', v: 'n', q: 'n', buyQ: 'n', n: 'n' } },
  'ref.liq': { keep: 50000, req: { coin: 's', ts: 'n', side: 's', px: 'n', qty: 'n', quote: 'n' } }, // side = the side liquidated (long | short)
  'ref.mark': { keep: 20000, req: { ts: 'n', coins: 'o' } }, // {coin: {mark, index, funding, nextTs}}
  'ref.oi': { keep: 20000, req: { ts: 'n', coins: 'o' } }, // {coin: {oi (base), oiQ}}
  // ── universe and data health
  'uni.list': { keep: 1000, req: { ts: 'n', coins: 'a', added: 'a', removed: 'a', stale: 'b', source: 's' } },
  'guard.status': { keep: 20000, req: { ts: 'n', coins: 'o' } }, // {coin: {tradable, refOk, reasons[]}}
  // ── analysis and strategies
  'feat.bar': { keep: 100000, req: { coin: 's', tf: 'n', t: 'n', bar: 'o', f: 'o', src: 's' } }, // closed bar + features (src: binance | blofin)
  'regime.state': { keep: 5000, req: { ts: 'n', coins: 'o' } }, // {coin: {bias, state, er, volPct, session, warm}}
  'event.window': { keep: 2000, req: { ts: 'n', windows: 'a' } }, // [{start, end, title, impact}] no-new-risk windows
  'idea': { keep: 50000, req: { id: 's', strategy: 's', coin: 's', side: 'n', entry: 'o', stop: 'n', timeStopMin: 'n', t: 'n', mode: 's', riskPct: 'n' } },
  'shadow.trade': { keep: 50000, req: { id: 's', strategy: 's', coin: 's', side: 'n', entryT: 'n', exitT: 'n', netBps: 'n', r: 'n', reason: 's' } },
  'shadow.end': { keep: 50000, req: { id: 's', strategy: 's', coin: 's', outcome: 's' } }, // an idea that never filled
  // ── sleeves: portfolios with their own capital share (src/sleeve/). Unsigned: they ask, the risk agent decides.
  'sleeve.target': { keep: 20000, req: { sleeve: 's', ts: 'n', mode: 's', weights: 'o', capitalShare: 'n', sigma: '?o' } }, // weights: {coin: fraction of the sleeve's capital}, sigma: {coin: daily vol}, every hour
  'portfolio.target': { keep: 20000, req: { ts: 'n', book: 'o', dial: 'n', reasons: 'a' } }, // the shadow portfolio core's book (USD per coin), every hour
  'portfolio.state': { keep: 20000, req: { ts: 'n', mode: 's', equity: 'n', holdings: 'o', legs: 'a' } }, // its simulated book after the hour
  'sleeve.state': { keep: 20000, req: { sleeve: 's', ts: 'n', mode: 's', equity: 'n', holdings: 'o', legs: 'a' } }, // the shadow book after the hour's legs
  // ── decisions, orders, positions, accounts
  'intent': { keep: 50000, req: { id: 's', coin: 's', side: 'n', entry: 'o', stop: 'n', riskPct: 'n', qty: 'n', strategies: 'a' } },
  'risk.decision': { keep: 50000, req: { id: 's', coin: 's', verdict: 's', qty: 'n', reasons: 'a' } },
  'risk.state': { keep: 20000, req: { ts: 'n', mode: 's', budgetScale: 'n', reasons: 'a' } },
  'order': { keep: 50000, req: { id: 's', coin: 's', side: 'n', qty: 'n', entry: 'o', stop: 'n', timeStopMin: 'n', strategies: 'a', owner: '?s', reduceOnly: '?b' } }, // owner: a sleeve ('sleeve:trend'); timeStopMin 0 = none
  'stop.move': { keep: 50000, req: { coin: 's', stop: 'n', owner: '?s' } }, // risk agent → trader: move a position's stop, only toward the price
  'order.end': { keep: 50000, req: { id: 's', coin: 's', outcome: 's' } }, // an order that ended without a position
  'exec.fill': { keep: 100000, req: { orderId: 's', coin: 's', side: 'n', qty: 'n', px: 'n', feeUsd: 'n', kind: 's', role: 's', ts: 'n' } },
  'exec.cost': { keep: 100000, req: { orderId: 's', coin: 's', role: 's', decPx: 'n', px: 'n', costBps: 'n', ts: 'n' } }, // implementation shortfall (exec/cost_tracker.js)
  'positions': { keep: 20000, req: { ts: 'n', open: 'a', working: 'a' } },
  'trade.closed': { keep: 50000, req: { orderId: 's', coin: 's', side: 'n', qty: 'n', entry: 'n', exit: 'n', netUsd: 'n', r: 'n', reason: 's', strategies: 'a' } },
  'account': { keep: 50000, req: { ts: 'n', equity: 'n', cash: 'n', upl: 'n', peak: 'n', dayStart: 'n', mode: 's' } },
  // ── system
  'sys.heartbeat': { keep: 50000, req: { agent: 's', pid: 'n', status: 's', startedAt: 'n', metrics: 'o' } },
  'sys.log': { keep: 50000, req: { agent: 's', level: 's', msg: 's' } },
  'sys.dead': { keep: 10000, req: { agent: 's', type: 's', id: 's', error: 's' } }, // a message a handler failed on
  'sys.command': { keep: 5000, req: { cmd: 's', by: 's' } }, // pause | resume | flatten | strategy-mode …
  'sys.alert': { keep: 5000, req: { text: 's' } }, // for Ibrahim (the Herald sends it on)
};

const KIND = { s: 'string', n: 'number', a: 'array', o: 'object', b: 'boolean' };
function kindOf(v) { return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v; }

function register(type, spec) {
  if (TYPES[type] && JSON.stringify(TYPES[type]) !== JSON.stringify(spec)) throw new Error(`message type ${type} already registered differently`);
  TYPES[type] = spec;
}
function check(type, data) {
  const t = TYPES[type];
  if (!t) throw new Error(`unknown message type ${type}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${type}: data must be an object`);
  for (const [k, kind] of Object.entries(t.req)) {
    const opt = kind[0] === '?', want = KIND[opt ? kind.slice(1) : kind], v = data[k];
    if (v === undefined) { if (opt) continue; throw new Error(`${type}: missing field ${k}`); }
    if (kindOf(v) !== want) throw new Error(`${type}: field ${k} is ${kindOf(v)}, expected ${want}`);
    if (want === 'number' && !Number.isFinite(v)) throw new Error(`${type}: field ${k} is not finite`);
  }
  return true;
}
const keep = (type) => (TYPES[type] ? TYPES[type].keep : 10000);
// expand 'md.*' style patterns to registered types
function expand(patterns) {
  const out = new Set();
  for (const p of [].concat(patterns)) {
    if (p.endsWith('*')) { const pre = p.slice(0, -1); for (const k of Object.keys(TYPES)) if (k.startsWith(pre)) out.add(k); }
    else { if (!TYPES[p]) throw new Error(`unknown message type ${p}`); out.add(p); }
  }
  return [...out];
}
const matches = (pattern, type) => (pattern.endsWith('*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type);

module.exports = { TYPES, register, check, keep, expand, matches };
