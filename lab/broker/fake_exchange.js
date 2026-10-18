/* In-process fake of the BloFin REST endpoints the demo broker uses — for offline tests only.
 * It checks every private request's signature, keeps a one-way (net) account with cross margin, fills
 * resting orders when the test moves the market through them, and can inject failures:
 *   inject('POST /api/v1/trade/order', 'drop-before' | 'drop-after' | 'http502-after')
 * 'drop-after' processes the request and then loses the answer — the case that must not create duplicates.
 */
'use strict';
const { sign } = require('./blofin.js');
const { decimals } = require('./quant.js');

function createFakeExchange(o) {
  const cfg = Object.assign({ key: 'k', secret: 's', pass: 'p', equity: 100000, maker: 0.0002, taker: 0.0006, postOnlyCross: 'reject' }, o || {});
  const inst = {}; // instId → {contractValue, lotSize, minSize, tickSize, maxLimitSize, maxMarketSize}
  const book = {}; // instId → {bid, ask, last}
  const pos = {}; // instId → {contracts, avg}
  const orders = {}; // orderId → order
  let keyInfo = { apiKey: cfg.key, apiName: 'blofinbot-demo', readOnly: '0', permissions: 'read,trade', ips: [] };
  let cash = cfg.equity, nextId = 1000, positionMode = 'net_mode', marginMode = 'cross';
  const faults = []; const log = []; let beforeOrder = null;

  const ok = (data) => ({ status: 200, body: { code: '0', msg: '', data } });
  const err = (code, msg, status) => ({ status: status || 200, body: { code: String(code), msg, data: [] } });
  const view = (x) => Object.assign({}, x, { size: String(x.size), filledSize: String(x.filledSize), price: x.price == null ? '' : String(x.price), averagePrice: String(x.averagePrice || 0), fee: String(-x.fee) });
  const equity = () => { let e = cash; for (const id in pos) e += pos[id].contracts * inst[id].contractValue * (book[id].last - pos[id].avg); return e; };

  function applyFill(o, contracts, price, feeRate) {
    if (contracts <= 0) return;
    const s = o.side === 'buy' ? 1 : -1, cv = inst[o.instId].contractValue;
    const p = pos[o.instId] || (pos[o.instId] = { contracts: 0, avg: 0 });
    const q = s * contracts;
    if (p.contracts === 0 || Math.sign(p.contracts) === s) { p.avg = (p.avg * Math.abs(p.contracts) + price * contracts) / (Math.abs(p.contracts) + contracts); p.contracts += q; }
    else {
      const close = Math.min(contracts, Math.abs(p.contracts));
      cash += close * cv * (price - p.avg) * Math.sign(p.contracts);
      p.contracts += s * close;
      const rest = contracts - close;
      if (Math.abs(p.contracts) < 1e-12) { p.contracts = 0; p.avg = 0; }
      if (rest > 1e-12) { p.contracts = s * rest; p.avg = price; }
    }
    if (p.contracts === 0) delete pos[o.instId];
    const fee = contracts * cv * price * feeRate;
    cash -= fee;
    o.averagePrice = (o.averagePrice * o.filledSize + price * contracts) / (o.filledSize + contracts);
    o.filledSize += contracts; o.fee += fee;
    o.state = o.filledSize + 1e-12 >= o.size ? 'filled' : 'partially_filled';
  }

  function placeOrder(b) {
    const I = inst[b.instId];
    if (!I) return err(152002, 'instrument does not exist');
    if (positionMode !== 'net_mode' || b.positionSide !== 'net') return err(152011, 'position side mismatch');
    if (b.clientOrderId && Object.values(orders).some((x) => x.clientOrderId === b.clientOrderId)) return ok([{ orderId: null, clientOrderId: b.clientOrderId, code: '152015', msg: 'duplicate clientOrderId' }]);
    const size = +b.size;
    if (!(size > 0) || Math.abs(size / I.lotSize - Math.round(size / I.lotSize)) > 1e-9 || size + 1e-12 < I.minSize) return ok([{ orderId: null, code: '152004', msg: 'invalid size' }]);
    const bk = book[b.instId];
    const p = pos[b.instId] ? pos[b.instId].contracts : 0;
    if (b.reduceOnly === 'true' && (p === 0 || Math.sign(p) === (b.side === 'buy' ? 1 : -1) || size > Math.abs(p) + 1e-12)) return ok([{ orderId: null, code: '152020', msg: 'reduce-only order would increase the position' }]);
    const o = { orderId: String(nextId++), clientOrderId: b.clientOrderId || '', instId: b.instId, side: b.side, orderType: b.orderType, positionSide: 'net', marginMode: b.marginMode, size, price: b.price == null ? null : +b.price, reduceOnly: b.reduceOnly === 'true', state: 'live', filledSize: 0, averagePrice: 0, fee: 0, createTime: String(Date.now()) };
    if (o.orderType !== 'market') {
      const t = I.tickSize;
      if (Math.abs(o.price / t - Math.round(o.price / t)) > 1e-6) return ok([{ orderId: null, code: '152005', msg: 'invalid price' }]);
    }
    orders[o.orderId] = o;
    if (o.orderType === 'market') applyFill(o, size, b.side === 'buy' ? bk.ask : bk.bid, cfg.taker);
    else {
      const crosses = b.side === 'buy' ? o.price >= bk.ask : o.price <= bk.bid;
      if (crosses && o.orderType === 'post_only') {
        if (cfg.postOnlyCross === 'reject') { delete orders[o.orderId]; return ok([{ orderId: null, clientOrderId: o.clientOrderId, code: '152016', msg: 'post only order would take liquidity' }]); }
        o.state = 'canceled';
      } else if (crosses) applyFill(o, size, b.side === 'buy' ? bk.ask : bk.bid, cfg.taker);
    }
    return ok([{ orderId: o.orderId, clientOrderId: o.clientOrderId, code: '0', msg: '' }]);
  }

  function route(method, url, body) {
    const p = url.pathname, q = Object.fromEntries(url.searchParams.entries());
    if (method === 'GET' && p === '/api/v1/market/instruments') return ok(Object.entries(inst).map(([instId, I]) => ({ instId, contractValue: String(I.contractValue), lotSize: String(I.lotSize), minSize: String(I.minSize), tickSize: String(I.tickSize), maxLimitSize: String(I.maxLimitSize || 1e9), maxMarketSize: String(I.maxMarketSize || 1e9), state: 'live' })));
    if (method === 'GET' && p === '/api/v1/market/tickers') return ok(Object.entries(book).map(([instId, b]) => ({ instId, last: String(b.last), bidPrice: String(b.bid), askPrice: String(b.ask) })));
    if (method === 'GET' && p === '/api/v1/user/query-apikey') return ok(keyInfo);
    if (method === 'GET' && p === '/api/v1/account/balance') return ok({ ts: String(Date.now()), totalEquity: String(equity()), details: [{ currency: 'USDT', equity: String(equity()), available: String(equity()) }] });
    if (method === 'GET' && p === '/api/v1/account/positions') return ok(Object.entries(pos).map(([instId, x]) => ({ positionId: instId + '-net', instId, marginMode, positionSide: 'net', positions: String(x.contracts), availablePositions: String(Math.abs(x.contracts)), averagePrice: String(x.avg), markPrice: String(book[instId].last), unrealizedPnl: String(x.contracts * inst[instId].contractValue * (book[instId].last - x.avg)) })));
    if (method === 'GET' && p === '/api/v1/account/position-mode') return ok({ positionMode });
    if (method === 'GET' && p === '/api/v1/account/margin-mode') return ok({ marginMode });
    if (method === 'POST' && p === '/api/v1/account/set-position-mode') { if (Object.keys(pos).length) return err(152013, 'positions open'); positionMode = body.positionMode; return ok({ positionMode }); }
    if (method === 'POST' && p === '/api/v1/account/set-margin-mode') { marginMode = body.marginMode; return ok({ marginMode }); }
    if (method === 'POST' && p === '/api/v1/account/set-leverage') return ok({ instId: body.instId, leverage: body.leverage, marginMode: body.marginMode });
    if (method === 'POST' && p === '/api/v1/trade/order') { if (beforeOrder) beforeOrder(body); return placeOrder(body); }
    if (method === 'POST' && p === '/api/v1/trade/cancel-order') {
      const x = orders[body.orderId];
      if (!x || !(x.state === 'live' || x.state === 'partially_filled')) return ok([{ orderId: body.orderId, code: '152403', msg: 'order does not exist or is already final' }]);
      x.state = x.filledSize > 0 ? 'partially_canceled' : 'canceled';
      return ok([{ orderId: x.orderId, clientOrderId: x.clientOrderId, code: '0', msg: '' }]);
    }
    if (method === 'GET' && p === '/api/v1/trade/orders-pending') return ok(Object.values(orders).filter((x) => x.state === 'live' || x.state === 'partially_filled').map(view));
    if (method === 'GET' && p === '/api/v1/trade/order-detail') {
      const x = q.orderId ? orders[q.orderId] : Object.values(orders).find((y) => y.clientOrderId === q.clientOrderId);
      if (!x) return err(152402, 'order does not exist');
      return ok(view(x));
    }
    if (method === 'GET' && p === '/api/v1/trade/orders-history') return ok(Object.values(orders).filter((x) => x.instId === q.instId && !(x.state === 'live' || x.state === 'partially_filled')).map(view));
    return err(404, 'unknown path ' + p, 404);
  }

  async function fetchImpl(u, init) {
    const url = new URL(u), method = init.method || 'GET', rp = url.pathname + url.search, body = init.body ? JSON.parse(init.body) : null;
    const h = init.headers || {};
    if (!rp.startsWith('/api/v1/market/')) {
      if (h['ACCESS-KEY'] !== cfg.key || h['ACCESS-PASSPHRASE'] !== cfg.pass) return resp(err(152401, 'invalid key', 401));
      const want = sign(cfg.secret, rp, method, h['ACCESS-TIMESTAMP'], h['ACCESS-NONCE'], init.body || '');
      if (want !== h['ACCESS-SIGN']) return resp(err(152409, 'signature mismatch', 401));
    }
    const k = `${method} ${url.pathname}`;
    log.push({ k, body });
    const fi = faults.findIndex((f) => f.k === k);
    const f = fi >= 0 ? faults.splice(fi, 1)[0] : null;
    if (f && f.mode === 'drop-before') throw new TypeError('fetch failed (injected, before)');
    const r = route(method, url, body);
    if (f && f.mode === 'drop-after') throw new TypeError('fetch failed (injected, after)');
    if (f && f.mode === 'http502-after') return resp({ status: 502, body: null });
    return resp(r);
  }
  function resp(r) { return { status: r.status, ok: r.status < 400, json: async () => { if (r.body == null) throw new SyntaxError('bad gateway html'); return JSON.parse(JSON.stringify(r.body)); } }; }

  return {
    fetchImpl, log, orders, pos, inst, book,
    addInstrument(instId, I, price) { inst[instId] = I; book[instId] = { bid: price * (1 - 1e-4), ask: price * (1 + 1e-4), last: price }; },
    // move the market: resting orders the new range trades through are filled at their price (maker)
    market(instId, last, lo, hi) {
      const I = inst[instId], t = I.tickSize, r = (x) => +(Math.round(x / t) * t).toFixed(decimals(t));
      book[instId] = { bid: r(last * (1 - 1e-4)), ask: r(last * (1 + 1e-4)), last };
      const low = lo == null ? last : lo, high = hi == null ? last : hi;
      for (const o of Object.values(orders)) {
        if (o.instId !== instId || !(o.state === 'live' || o.state === 'partially_filled')) continue;
        if ((o.side === 'buy' && low < o.price) || (o.side === 'sell' && high > o.price)) applyFill(o, o.size - o.filledSize, o.price, cfg.maker);
      }
    },
    partialFill(orderId, contracts) { const o = orders[orderId]; applyFill(o, contracts, o.price, cfg.maker); },
    inject(k, mode) { faults.push({ k, mode }); },
    setPositionMode(m) { positionMode = m; },
    setKeyInfo(k) { keyInfo = Object.assign({}, keyInfo, k); },
    onOrder(fn) { beforeOrder = fn; },
    equity, cash: () => cash,
  };
}

module.exports = { createFakeExchange };
