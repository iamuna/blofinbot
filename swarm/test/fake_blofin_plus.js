'use strict';
// The demo broker's fake BloFin (test/fake_exchange.js) plus what the swarm's demo trader also uses:
// exchange-side stop-loss orders (order-tpsl, cancel-tpsl, orders-tpsl-pending) that trigger when the market moves
// through them, and close-position. Private calls are signed and checked like the real API.
const crypto = require('crypto');
const { createFakeExchange } = require('./fake_exchange');
const { sign } = require('../src/exec/blofin/client');

function createFakePlus(o = {}) {
  const cfg = Object.assign({ key: 'k', secret: 's', pass: 'p' }, o);
  const base = createFakeExchange(cfg);
  const tpsl = {}; let nextId = 9000; const calls = []; const faults = [];
  const ok = (data) => ({ status: 200, body: { code: '0', msg: '', data } });
  async function signed(method, p, body) {
    const ts = String(Date.now()), nonce = crypto.randomUUID(), b = body ? JSON.stringify(body) : '';
    return base.fetchImpl('https://demo-trading-openapi.blofin.com' + p, { method, headers: { 'ACCESS-KEY': cfg.key, 'ACCESS-PASSPHRASE': cfg.pass, 'ACCESS-TIMESTAMP': ts, 'ACCESS-NONCE': nonce, 'ACCESS-SIGN': sign(cfg.secret, p, method, ts, nonce, b) }, body: b || undefined });
  }
  function checkSig(u, init) {
    const url = new URL(u), rp = url.pathname + url.search, h = init.headers || {};
    return h['ACCESS-KEY'] === cfg.key && sign(cfg.secret, rp, init.method || 'GET', h['ACCESS-TIMESTAMP'], h['ACCESS-NONCE'], init.body || '') === h['ACCESS-SIGN'];
  }
  const resp = (r) => ({ status: r.status, ok: r.status < 400, json: async () => JSON.parse(JSON.stringify(r.body)) });
  async function fetchImpl(u, init) {
    const url = new URL(u), method = init.method || 'GET', p = url.pathname, body = init.body ? JSON.parse(init.body) : null;
    calls.push(`${method} ${p}`);
    const fi = faults.findIndex((f) => f.k === `${method} ${p}`), f = fi >= 0 ? faults.splice(fi, 1)[0] : null;
    if (f && f.mode === 'drop-before') throw new TypeError('fetch failed (injected, before)');
    let r = null;
    if (['/api/v1/trade/order-tpsl', '/api/v1/trade/cancel-tpsl', '/api/v1/trade/orders-tpsl-pending', '/api/v1/trade/close-position'].includes(p)) {
      if (!checkSig(u, init)) return resp({ status: 401, body: { code: '152409', msg: 'signature mismatch', data: [] } });
      if (p === '/api/v1/trade/order-tpsl') { const id = String(nextId++); tpsl[id] = Object.assign({ tpslId: id }, body); r = ok([{ tpslId: id, clientOrderId: body.clientOrderId, code: '0', msg: '' }]); }
      else if (p === '/api/v1/trade/cancel-tpsl') { for (const x of body) delete tpsl[x.tpslId]; r = ok(body.map((x) => ({ tpslId: x.tpslId, code: '0' }))); }
      else if (p === '/api/v1/trade/orders-tpsl-pending') r = ok(Object.values(tpsl));
      else if (p === '/api/v1/trade/close-position') { const pos = base.pos[body.instId]; if (pos) await signed('POST', '/api/v1/trade/order', { instId: body.instId, marginMode: 'cross', positionSide: 'net', side: pos.contracts > 0 ? 'sell' : 'buy', orderType: 'market', size: String(Math.abs(pos.contracts)), reduceOnly: 'true', clientOrderId: body.clientOrderId }); r = ok([{ instId: body.instId }]); }
    }
    const out = r ? resp(r) : await base.fetchImpl(u, init);
    if (f && f.mode === 'drop-after') throw new TypeError('fetch failed (injected, after)');
    return out;
  }
  return Object.assign({}, base, {
    fetchImpl, tpsl, calls,
    inject(k, mode) { faults.push({ k, mode }); },
    // move the market; resting limits fill (maker) and stop-losses the range crosses trigger as market orders
    async market(instId, last, lo, hi) {
      base.market(instId, last, lo, hi);
      const low = lo == null ? last : lo, high = hi == null ? last : hi;
      for (const x of Object.values(tpsl)) {
        if (x.instId !== instId || !x.slTriggerPrice) continue;
        const trig = +x.slTriggerPrice, pos = base.pos[instId];
        if ((x.side === 'sell' && low <= trig) || (x.side === 'buy' && high >= trig)) {
          delete tpsl[x.tpslId];
          if (pos) await signed('POST', '/api/v1/trade/order', { instId, marginMode: 'cross', positionSide: 'net', side: x.side, orderType: 'market', size: String(Math.min(+x.size, Math.abs(pos.contracts))), reduceOnly: 'true', clientOrderId: `${x.clientOrderId}x` });
        }
      }
    },
  });
}

module.exports = { createFakePlus };
