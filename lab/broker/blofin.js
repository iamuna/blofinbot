/* Signed BloFin REST client for the DEMO broker.
 *
 * - Only the demo host is allowed in this build. LIVE needs a deliberate code change (see docs/DEMO_TRADING.md).
 * - Signing (BloFin docs, checked 2026-10-18 against BloFin's own blofin-mcp and blofin-sdk-python):
 *     prehash = requestPath(with query) + METHOD + timestamp(ms) + nonce + body(JSON, POST only)
 *     sign    = base64( hex( HMAC_SHA256(secret, prehash) ) )
 *   headers ACCESS-KEY, ACCESS-SIGN, ACCESS-TIMESTAMP, ACCESS-NONCE, ACCESS-PASSPHRASE.
 * - GET requests are retried (idempotent). POST requests are NEVER retried: a network failure after sending
 *   leaves the outcome unknown, and the caller must reconcile (AGENTS.md: no blind retry).
 * - Secrets are kept in closures, never on the object, never in error messages or logs.
 */
'use strict';
const crypto = require('crypto');

const HOSTS = { demo: 'https://demo-trading-openapi.blofin.com' };
const PUBLIC_HOST = 'https://openapi.blofin.com'; // market data is the same; demo host serves it too

class BloFinError extends Error {
  // kind: 'network' (no usable response — for a POST the outcome is UNKNOWN), 'http', 'api' (code != 0), 'parse'
  constructor(kind, message, extra) { super(message); this.name = 'BloFinError'; this.kind = kind; Object.assign(this, extra || {}); }
}

function sign(secret, requestPath, method, timestamp, nonce, body) {
  const prehash = requestPath + method + timestamp + nonce + (body || '');
  const hex = crypto.createHmac('sha256', secret).update(prehash).digest('hex');
  return Buffer.from(hex).toString('base64');
}

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? '?' + s : '';
}

function createClient(opts) {
  const mode = opts.mode;
  if (mode !== 'demo') throw new Error(`BloFin mode "${mode}" is not enabled in this build (demo only)`);
  const base = opts.baseUrl || HOSTS.demo;
  if (!opts.allowCustomHost && base !== HOSTS.demo) throw new Error('refusing a non-demo BloFin host');
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || 10000;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const nowMs = opts.nowMs || (() => Date.now());
  // credentials: captured here, not stored on the returned object
  const key = opts.apiKey, secret = opts.secret, pass = opts.passphrase;
  if (!key || !secret || !pass) throw new Error('BloFin demo credentials missing (BLOFIN_API_KEY / BLOFIN_API_SECRET / BLOFIN_PASSPHRASE)');
  // simple pacing: trading endpoints 30 req / 10 s per user, everything 500 req / min per IP
  let lastAny = 0, lastTrade = 0;
  async function pace(trade) {
    const gapAny = 130, gapTrade = 360;
    for (;;) {
      const t = nowMs(), wait = Math.max(lastAny + gapAny - t, trade ? lastTrade + gapTrade - t : 0);
      if (wait <= 0) break;
      await sleep(wait);
    }
    lastAny = nowMs(); if (trade) lastTrade = lastAny;
  }

  async function once(method, requestPath, bodyStr, priv) {
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'blofinbot-demo/1.0' };
    if (priv) {
      const ts = String(nowMs()), nonce = crypto.randomUUID();
      headers['ACCESS-KEY'] = key; headers['ACCESS-SIGN'] = sign(secret, requestPath, method, ts, nonce, bodyStr);
      headers['ACCESS-TIMESTAMP'] = ts; headers['ACCESS-NONCE'] = nonce; headers['ACCESS-PASSPHRASE'] = pass;
    }
    let r;
    try {
      r = await fetchImpl(base + requestPath, { method, headers, body: bodyStr || undefined, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new BloFinError('network', `${method} ${requestPath.split('?')[0]}: ${e && e.name === 'TimeoutError' ? 'timeout' : (e && e.message) || 'network error'}`);
    }
    let j;
    try { j = await r.json(); } catch (e) { throw new BloFinError(r.status >= 500 ? 'network' : 'parse', `${method} ${requestPath.split('?')[0]}: HTTP ${r.status}, non-JSON body`, { status: r.status }); }
    if (r.status === 429 || r.status >= 500) throw new BloFinError('http', `${method} ${requestPath.split('?')[0]}: HTTP ${r.status}`, { status: r.status, retryable: true, code: j && j.code });
    if (r.status >= 400) throw new BloFinError('http', `${method} ${requestPath.split('?')[0]}: HTTP ${r.status} ${j && j.msg ? j.msg : ''}`, { status: r.status, code: j && j.code });
    if (!j || String(j.code) !== '0') throw new BloFinError('api', `${method} ${requestPath.split('?')[0]}: BloFin code ${j && j.code} ${j && j.msg ? j.msg : ''}`.trim(), { code: j && String(j.code), data: j && j.data });
    return j.data;
  }

  async function get(path, params, priv, trade) {
    const rp = path + query(params);
    let last;
    for (let a = 0; a < 3; a++) {
      await pace(trade);
      try { return await once('GET', rp, '', priv); } catch (e) {
        last = e;
        if (!(e.kind === 'network' || e.retryable)) throw e;
        await sleep(700 * (a + 1));
      }
    }
    throw last;
  }
  async function post(path, body) {
    await pace(true);
    return once('POST', path, JSON.stringify(body), true); // never retried
  }

  return {
    mode, base,
    // public
    instruments: () => get('/api/v1/market/instruments', {}, false),
    tickers: () => get('/api/v1/market/tickers', {}, false),
    // account
    apiKeyInfo: () => get('/api/v1/user/query-apikey', {}, true),
    balance: () => get('/api/v1/account/balance', {}, true),
    positions: () => get('/api/v1/account/positions', {}, true),
    positionMode: () => get('/api/v1/account/position-mode', {}, true),
    marginMode: () => get('/api/v1/account/margin-mode', {}, true),
    setPositionMode: (positionMode) => post('/api/v1/account/set-position-mode', { positionMode }),
    setMarginMode: (marginMode) => post('/api/v1/account/set-margin-mode', { marginMode }),
    setLeverage: (instId, leverage, marginMode) => post('/api/v1/account/set-leverage', { instId, leverage: String(leverage), marginMode, positionSide: 'net' }),
    // trading
    placeOrder: (o) => post('/api/v1/trade/order', o),
    cancelOrder: (instId, orderId) => post('/api/v1/trade/cancel-order', { instId, orderId: String(orderId) }),
    pendingOrders: (after) => get('/api/v1/trade/orders-pending', { limit: 100, after }, true, true),
    orderDetail: (instId, ids) => get('/api/v1/trade/order-detail', Object.assign({ instId }, ids), true, true),
    orderHistory: (instId) => get('/api/v1/trade/orders-history', { instId, limit: 100 }, true, true),
    // exchange-side take-profit / stop-loss for a position (prices as strings; order price '-1' = market)
    placeTpsl: (o) => post('/api/v1/trade/order-tpsl', o),
    cancelTpsl: (list) => post('/api/v1/trade/cancel-tpsl', list),
    pendingTpsl: (instId) => get('/api/v1/trade/orders-tpsl-pending', instId ? { instId, limit: 100 } : { limit: 100 }, true, true),
    closePosition: (instId, marginMode, clientOrderId) => post('/api/v1/trade/close-position', { instId, marginMode, positionSide: 'net', clientOrderId }),
  };
}

module.exports = { createClient, sign, query, BloFinError, HOSTS, PUBLIC_HOST };
