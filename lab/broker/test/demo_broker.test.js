/* Offline tests for the BloFin demo broker (no network): node --test lab/broker/test/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { createClient, sign } = require('../blofin.js');
const Q = require('../quant.js');
const { DemoBroker } = require('../demo.js');
const { createFakeExchange } = require('../fake_exchange.js');

const SECRET = 'test-secret-9f8e7d6c5b4a', KEY = 'test-key-1a2b3c', PASS = 'test-pass-zz9';
const BTC = { contractValue: 0.001, lotSize: 0.1, minSize: 0.1, tickSize: 0.1 };
const ETH = { contractValue: 0.01, lotSize: 1, minSize: 1, tickSize: 0.01 };

function setup(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-broker-'));
  const ex = createFakeExchange(Object.assign({ key: KEY, secret: SECRET, pass: PASS }, opts));
  ex.addInstrument('BTC-USDT', BTC, 60000);
  ex.addInstrument('ETH-USDT', ETH, 3000);
  const clock = { t: 1760800000, ms: 1760800000000 };
  const client = createClient({ mode: 'demo', apiKey: KEY, secret: SECRET, passphrase: PASS, fetchImpl: ex.fetchImpl, sleep: async (ms) => { clock.ms += ms; }, nowMs: () => clock.ms });
  const events = [];
  const mk = () => new DemoBroker({ client, dir, now: () => clock.t, log: (type, text) => events.push(`${type}: ${text}`), coins: [{ coin: 'BTC', instId: 'BTC-USDT' }, { coin: 'ETH', instId: 'ETH-USDT' }] });
  const b = mk();
  const minute = async (n = 1) => { for (let i = 0; i < n; i++) { clock.t += 60; clock.ms += 60000; await b.tick(); } };
  return { dir, ex, clock, client, b, mk, events, minute };
}
const orderPosts = (ex) => ex.log.filter((r) => r.k === 'POST /api/v1/trade/order');
const journal = (dir) => fs.readFileSync(path.join(dir, 'broker-journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('signature follows the BloFin recipe (path+method+ts+nonce+body → HMAC-SHA256 hex → base64)', () => {
  const pathq = '/api/v1/trade/order', ts = '1597026383085', nonce = 'abc-123', body = '{"instId":"BTC-USDT"}';
  const hex = crypto.createHmac('sha256', SECRET).update(pathq + 'POST' + ts + nonce + body).digest('hex');
  assert.equal(sign(SECRET, pathq, 'POST', ts, nonce, body), Buffer.from(hex, 'utf8').toString('base64'));
  // GET: query string is part of the signed path, no body
  const hex2 = crypto.createHmac('sha256', SECRET).update('/api/v1/account/positions?instId=BTC-USDT' + 'GET' + ts + nonce).digest('hex');
  assert.equal(sign(SECRET, '/api/v1/account/positions?instId=BTC-USDT', 'GET', ts, nonce, ''), Buffer.from(hex2).toString('base64'));
});

test('client refuses live mode and non-demo hosts; credentials are required', () => {
  assert.throws(() => createClient({ mode: 'live', apiKey: KEY, secret: SECRET, passphrase: PASS }), /not enabled/);
  assert.throws(() => createClient({ mode: 'demo', baseUrl: 'https://openapi.blofin.com', apiKey: KEY, secret: SECRET, passphrase: PASS }), /non-demo/);
  assert.throws(() => createClient({ mode: 'demo' }), /credentials missing/);
  const c = createClient({ mode: 'demo', apiKey: KEY, secret: SECRET, passphrase: PASS });
  assert.ok(!JSON.stringify(c).includes(SECRET) && !Object.values(c).includes(SECRET));
});

test('quantization: contracts round toward zero to the lot, prices never cross by rounding', () => {
  assert.equal(Q.toContracts(0.05, BTC), 50);
  assert.equal(Q.toContracts(-0.00019, BTC), -0.1);
  assert.equal(Q.toContracts(0.0003, BTC), 0.3);
  assert.equal(Q.toContracts(0.00009, BTC), 0);
  assert.equal(Q.sizeString(50.04, BTC), '50.0');
  assert.equal(Q.sizeString(0.3, BTC), '0.3'); // 0.3/0.1 must not become 2.9999
  assert.equal(Q.sizeString(0.05, BTC), null);
  assert.equal(Q.sizeString(5, Object.assign({}, BTC, { maxLimitSize: 2 })), '2.0');
  assert.equal(Q.passivePrice(60000.07, 'buy', BTC), '60000.0');
  assert.equal(Q.passivePrice(60000.01, 'sell', BTC), '60000.1');
  assert.equal(Q.passivePrice(2999.996, 'buy', ETH), '2999.99');
});

test('happy path: intent is journaled before the send, post-only at the bid, fill, goal reached', async () => {
  const s = setup();
  s.ex.onOrder((body) => {
    const j = journal(s.dir).filter((x) => x.clientOrderId === body.clientOrderId).map((x) => x.state);
    assert.deepEqual(j, ['INTENT_PERSISTED', 'SUBMITTING'], 'intent must be on disk before the exchange sees it');
  });
  await s.b.tick(); // init
  assert.ok(s.b.ready, s.b.reason);
  s.b.setGoal('BTC', 'BTC-USDT', 0.05, 'test target');
  await s.minute();
  const posts = orderPosts(s.ex);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.orderType, 'post_only');
  assert.equal(posts[0].body.side, 'buy');
  assert.equal(posts[0].body.size, '50.0');
  assert.equal(+posts[0].body.price, s.ex.book['BTC-USDT'].bid);
  assert.equal(posts[0].body.positionSide, 'net');
  s.ex.market('BTC-USDT', 59950, 59940, 60010); // trades through the bid
  await s.minute();
  const f = s.b.drainFills();
  assert.equal(f.length, 1);
  assert.ok(Math.abs(f[0].qty - 0.05) < 1e-12);
  await s.minute(); // positions now show 50 contracts → goal reached
  assert.equal(s.b.goal('BTC'), null);
  await s.minute(3);
  assert.equal(orderPosts(s.ex).length, 1, 'no further orders once at target');
  assert.ok(Math.abs(s.b.positionsBase().BTC.qty - 0.05) < 1e-12);
});

test('chase: re-post when the bid moves away, market order after 30 minutes', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('ETH', 'ETH-USDT', 2, 'chase test'); // 200 contracts
  await s.minute();
  s.ex.market('ETH-USDT', 3010, 3001, 3012); // up and away, never through our bid
  await s.minute();
  const posts = orderPosts(s.ex);
  assert.equal(posts.length, 2, 'cancel + re-post');
  assert.equal(+posts[1].body.price, s.ex.book['ETH-USDT'].bid);
  assert.equal(Object.values(s.ex.orders).filter((o) => o.state === 'live').length, 1, 'only one order rests at a time');
  // drift up every minute until the chase window closes
  for (let i = 0; i < 30; i++) { s.ex.market('ETH-USDT', 3010 + 2 * (i + 1), 3010 + 2 * i + 1, 3012 + 2 * (i + 1)); await s.minute(); }
  const last = orderPosts(s.ex).at(-1).body;
  assert.equal(last.orderType, 'market');
  await s.minute(2);
  assert.ok(Math.abs(s.b.positionsBase().ETH.qty - 2) < 1e-9);
  assert.equal(s.b.goal('ETH'), null);
});

test('answer lost after the order was accepted → SUBMIT_UNKNOWN → found by clientOrderId, no duplicate', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('BTC', 'BTC-USDT', 0.02, 'lost answer');
  s.ex.inject('POST /api/v1/trade/order', 'drop-after');
  await s.minute();
  const it = Object.values(s.b.S.intents).find((x) => x.coin === 'BTC');
  assert.equal(it.state, 'SUBMIT_UNKNOWN');
  await s.minute();
  assert.equal(it.state, 'ACCEPTED');
  assert.ok(it.orderId);
  assert.equal(Object.keys(s.ex.orders).length, 1, 'exactly one order on the exchange');
  assert.equal(orderPosts(s.ex).length, 1);
});

test('send failed before reaching the exchange → no new order for 2 minutes, then NOT_FOUND and a fresh id', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('BTC', 'BTC-USDT', 0.02, 'never arrived');
  s.ex.inject('POST /api/v1/trade/order', 'drop-before');
  await s.minute();
  const first = Object.values(s.b.S.intents).find((x) => x.coin === 'BTC');
  assert.equal(first.state, 'SUBMIT_UNKNOWN');
  await s.minute(); // 1 minute later: still unknown, nothing sent
  assert.equal(orderPosts(s.ex).length, 1);
  await s.minute(); // 2 minutes: proven absent → new order
  assert.equal(first.state, 'NOT_FOUND');
  const posts = orderPosts(s.ex);
  assert.equal(posts.length, 2);
  assert.notEqual(posts[0].body.clientOrderId, posts[1].body.clientOrderId);
  assert.equal(Object.keys(s.ex.orders).length, 1);
});

test('HTTP 502 after the send is treated as unknown, not as a rejection', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('ETH', 'ETH-USDT', -1, 'gateway error');
  s.ex.inject('POST /api/v1/trade/order', 'http502-after');
  await s.minute();
  const it = Object.values(s.b.S.intents).find((x) => x.coin === 'ETH');
  assert.equal(it.state, 'SUBMIT_UNKNOWN');
  await s.minute();
  assert.equal(it.state, 'ACCEPTED');
  assert.equal(Object.keys(s.ex.orders).length, 1);
});

test('restart while an order was being sent: the new process reconciles instead of resending', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('BTC', 'BTC-USDT', 0.03, 'crash test');
  // simulate a crash after the order reached the exchange but before the answer was recorded
  const realPlace = s.client.placeOrder;
  s.client.placeOrder = async (o) => { await realPlace(o); throw Object.assign(new Error('process killed'), { crash: true }); };
  const origTransition = s.b.transition.bind(s.b);
  s.b.transition = (it, st, why, extra) => { if (st === 'REJECTED_EXCHANGE' || st === 'SUBMIT_UNKNOWN') throw new Error('crash'); return origTransition(it, st, why, extra); };
  await s.minute().catch(() => {});
  s.client.placeOrder = realPlace;
  const onDisk = JSON.parse(fs.readFileSync(path.join(s.dir, 'broker.json'), 'utf8'));
  assert.equal(Object.values(onDisk.intents).find((x) => x.coin === 'BTC').state, 'SUBMITTING');
  const b2 = s.mk(); // new process, same state dir
  assert.equal(Object.values(b2.S.intents).find((x) => x.coin === 'BTC').state, 'SUBMIT_UNKNOWN');
  s.clock.t += 60; await b2.tick();
  assert.equal(Object.values(b2.S.intents).find((x) => x.coin === 'BTC').state, 'ACCEPTED');
  s.clock.t += 60; await b2.tick();
  assert.equal(Object.keys(s.ex.orders).length, 1, 'no duplicate after restart');
});

test('startup cancels untracked bot orders, leaves manual orders alone', async () => {
  const s = setup();
  // an order with the bot prefix that no state knows (state lost), and a manual order
  await s.client.placeOrder({ instId: 'BTC-USDT', marginMode: 'cross', positionSide: 'net', side: 'buy', orderType: 'limit', price: '50000.0', size: '1.0', clientOrderId: 'mtfold123' });
  await s.client.placeOrder({ instId: 'ETH-USDT', marginMode: 'cross', positionSide: 'net', side: 'buy', orderType: 'limit', price: '2000.00', size: '1', clientOrderId: 'manual1' });
  await s.b.tick();
  const byCid = Object.fromEntries(Object.values(s.ex.orders).map((o) => [o.clientOrderId, o.state]));
  assert.equal(byCid.mtfold123, 'canceled');
  assert.equal(byCid.manual1, 'live');
  assert.ok(s.events.some((e) => /Manual order/.test(e)));
});

test('partial fill then re-post: replacement size is exactly what is still missing', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('BTC', 'BTC-USDT', 0.05, 'partial');
  await s.minute();
  const o = Object.values(s.ex.orders)[0];
  s.ex.partialFill(o.orderId, 20); // 20 of 50 contracts
  await s.minute(); // broker sees 20 filled at snapshot; bid unchanged → keeps resting
  s.ex.partialFill(o.orderId, 5); // 5 more after the snapshot
  s.ex.market('BTC-USDT', 60100, 60050, 60110); // moved away → cancel + re-post
  await s.minute();
  const posts = orderPosts(s.ex);
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.size, '25.0', '50 − 20 − 5 (filled after the snapshot) = 25');
});

test('a smaller goal cancels a resting order that would overshoot', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('BTC', 'BTC-USDT', 0.05, 'first'); // 50 contracts
  await s.minute();
  s.b.setGoal('BTC', 'BTC-USDT', 0.03, 'smaller'); // 30
  await s.minute();
  const posts = orderPosts(s.ex);
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.size, '30.0');
  assert.equal(Object.values(s.ex.orders).filter((o) => o.state === 'live').length, 1);
  s.b.setGoal('BTC', 'BTC-USDT', 0.04, 'bigger'); // a bigger goal keeps the resting order; the rest follows after it fills
  await s.minute();
  assert.equal(orderPosts(s.ex).length, 2);
  s.ex.market('BTC-USDT', 59900, 59800, 60000);
  await s.minute(2); // fill seen, then the missing 10 contracts are posted
  assert.equal(orderPosts(s.ex).at(-1).body.size, '10.0');
  s.ex.market('BTC-USDT', 59800, 59700, 59900);
  await s.minute(2);
  assert.ok(Math.abs(s.b.positionsBase().BTC.qty - 0.04) < 1e-9);
});

test('reduce-only when shrinking a position, plain order when flipping it', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('ETH', 'ETH-USDT', 1, 'open'); // 100 contracts
  s.clock.t += 31 * 60; await s.b.tick(); // chase window long over → market
  await s.minute();
  assert.equal(s.b.positionsBase().ETH.qty, 1);
  s.b.setGoal('ETH', 'ETH-USDT', 0.4, 'trim');
  await s.minute();
  let last = orderPosts(s.ex).at(-1).body;
  assert.equal(last.side, 'sell'); assert.equal(last.size, '60'); assert.equal(last.reduceOnly, 'true');
  s.ex.market('ETH-USDT', 3010, 2995, 3012);
  await s.minute(2);
  assert.ok(Math.abs(s.b.positionsBase().ETH.qty - 0.4) < 1e-9);
  s.b.setGoal('ETH', 'ETH-USDT', -0.3, 'flip');
  await s.minute();
  last = orderPosts(s.ex).at(-1).body;
  assert.equal(last.side, 'sell'); assert.equal(last.size, '70'); assert.equal(last.reduceOnly, undefined);
});

test('local risk backstop: one coin above 60% of equity is refused without an order', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('BTC', 'BTC-USDT', 1.2, 'too big'); // 72k on 100k equity
  await s.minute();
  assert.equal(orderPosts(s.ex).length, 0);
  assert.ok(Object.values(s.b.S.intents).some((x) => x.state === 'REJECTED_LOCAL'));
});

test('gross cap counts resting and unresolved orders on other coins', async () => {
  const s = setup({ equity: 20000 });
  await s.b.tick();
  s.b.maxCoinWeight = 10; s.b.grossCap = 1.0;
  s.b.setGoal('BTC', 'BTC-USDT', 0.25, 'big 1'); // 15k resting
  await s.minute();
  s.b.setGoal('ETH', 'ETH-USDT', 3, 'big 2'); // 9k more → 24k > 20k
  await s.minute();
  assert.equal(orderPosts(s.ex).length, 1);
  assert.ok(s.events.some((e) => /gross exposure/.test(e)));
});

test('post-only rejections retry with fresh ids and back off after three', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('BTC', 'BTC-USDT', 0.01, 'crossing');
  s.ex.onOrder(() => { const bk = s.ex.book['BTC-USDT']; s.ex.book['BTC-USDT'] = { bid: bk.bid - 100, ask: bk.bid - 90, last: bk.bid - 95 }; });
  await s.minute(3);
  assert.equal(orderPosts(s.ex).length, 3);
  assert.equal(new Set(orderPosts(s.ex).map((p) => p.body.clientOrderId)).size, 3);
  await s.minute(5);
  assert.equal(orderPosts(s.ex).length, 3, 'paused for 15 minutes after three rejections');
  assert.ok(s.events.some((e) => /3 rejections/.test(e)));
});

test('one-way mode is set only when the account is flat; otherwise the broker stays disarmed', async () => {
  const s = setup();
  s.ex.setPositionMode('long_short_mode');
  await s.b.tick();
  assert.ok(s.b.ready);
  const s2 = setup();
  s2.ex.setPositionMode('net_mode');
  await s2.client.placeOrder({ instId: 'BTC-USDT', marginMode: 'cross', positionSide: 'net', side: 'buy', orderType: 'market', size: '1.0', clientOrderId: 'manualpos' });
  s2.ex.setPositionMode('long_short_mode');
  await s2.b.tick();
  assert.equal(s2.b.ready, false);
  assert.match(s2.b.reason, /net/);
  s2.b.setGoal('ETH', 'ETH-USDT', 1, 'should not trade');
  await s2.minute(2);
  assert.equal(orderPosts(s2.ex).length, 1, 'only the manual order');
});

test('a key that can transfer or withdraw, or is read-only, keeps the broker disarmed', async () => {
  const s = setup();
  s.ex.setKeyInfo({ permissions: 'read,trade,transfer' });
  await s.b.tick();
  assert.equal(s.b.ready, false);
  assert.match(s.b.reason, /money-moving/);
  const s2 = setup();
  s2.ex.setKeyInfo({ readOnly: '1', permissions: 'read' });
  await s2.b.tick();
  assert.equal(s2.b.ready, false);
  assert.match(s2.b.reason, /read-only/);
  s2.b.setGoal('BTC', 'BTC-USDT', 0.01, 'x');
  await s2.minute(2);
  assert.equal(orderPosts(s2.ex).length, 0);
});

test('secrets never reach the state, journal or events', async () => {
  const s = setup();
  await s.b.tick();
  s.b.setGoal('BTC', 'BTC-USDT', 0.02, 'secrets');
  s.ex.inject('POST /api/v1/trade/order', 'drop-after');
  await s.minute(3);
  const blob = fs.readFileSync(path.join(s.dir, 'broker.json'), 'utf8') + fs.readFileSync(path.join(s.dir, 'broker-journal.jsonl'), 'utf8') + s.events.join('\n');
  for (const x of [SECRET, KEY, PASS]) assert.ok(!blob.includes(x), 'leaked ' + x);
});
