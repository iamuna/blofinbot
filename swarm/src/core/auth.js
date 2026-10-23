/* Signed messages: the bus messages that move money or change what the swarm may do carry an HMAC signature,
 * made with a key only the trusted agent groups can read (/etc/swarm/bus.key, root:swarm 0640).
 *
 * The brain group — where strategy plugins (code the Claude agents write) run — runs as its own user without that
 * key. It can publish ideas, features and shadow results, but anything it sent as an order, a command, an account
 * or position update would be unsigned, and every agent that holds the key drops unsigned authority messages.
 *
 * Signed types: order, intent, risk.decision, risk.state, sys.command, account, positions, trade.closed.
 * On Windows (one process, in-memory bus) the brain runs in its own locked-down process instead (core/isolate.js),
 * and the bridge never forwards a signed type from it.
 * Without a key (tests, CI, a paper run on a laptop) nothing is signed and nothing is checked; run.js refuses to
 * start a demo or live trader without one.
 */
'use strict';
const crypto = require('crypto'), fs = require('fs');

const SIGNED = new Set(['order', 'intent', 'risk.decision', 'risk.state', 'sys.command', 'account', 'positions', 'trade.closed']);

function payload(m) { return `${m.v}|${m.id}|${m.type}|${m.ts}|${m.src}|${m.trace}|${JSON.stringify(m.data)}`; }
function sign(key, m) { return crypto.createHmac('sha256', key).update(payload(m)).digest('base64url'); }
function verify(key, m) {
  if (!m || typeof m.sig !== 'string') return false;
  const want = Buffer.from(sign(key, m)), got = Buffer.from(m.sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
// key file → Buffer (null when unset, empty or unreadable — e.g. the brain's user)
function loadKey(file) {
  if (!file) return null;
  try { const k = fs.readFileSync(file, 'utf8').trim(); return k.length >= 32 ? Buffer.from(k) : null; } catch (e) { return null; }
}

module.exports = { SIGNED, sign, verify, loadKey, payload };
