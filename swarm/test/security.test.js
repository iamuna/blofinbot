'use strict';
// The rules that keep agent-written code in its lane: the plugin check, the update gate, signed authority
// messages, and the deploy scripts themselves.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { checkPlugin, checkShape } = require('../src/factory/plugin_check');
const { gate } = require('../src/tools/update_gate');
const { MemoryBus } = require('../src/core/bus');
const auth = require('../src/core/auth');
const { Trader } = require('../src/exec/trader');
const { quiet, baseCfg, tmpDir, tap } = require('./helpers');

const ROOT = path.join(__dirname, '..');

test('plugin check: every shipped strategy plugin passes, and has the kit\'s shape', () => {
  const dir = path.join(ROOT, 'src', 'strategies');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && !['kit.js', 'index.js', 'loader.js'].includes(x))) {
    const r = checkPlugin(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(r.ok, `${f}: ${r.problems.join('; ')}`);
    assert.deepStrictEqual(checkShape(require(path.join(dir, f))), [], f);
  }
});

test('plugin check: blocks the ways out of a pure plugin', () => {
  const wrap = (body) => `'use strict';\nmodule.exports = { name: 'x-y', tfs: [5], onBar(ev, api) { ${body} } };\n`;
  const blocked = {
    'require fs': `const fs = require('fs'); return null;`,
    'require relative': `const b = require('../exec/trader'); return null;`,
    process: 'return process.env.BLOFIN_API_KEY;',
    globalThis: 'return globalThis.x;',
    eval: "return eval('1');",
    'Function constructor': "return Function('return 1')();",
    'constructor chain': 'return api.p.constructor.constructor;',
    'glued property name': "return api.p['con' + 'structor'];",
    'property name from text': "const k = ['con', 'structor'].join(''); return api.p[k];",
    'template property': 'return api.p[`${1}`];',
    'char codes': 'return String.fromCharCode(99);',
    timer: 'setTimeout(() => 1, 1); return null;',
    fetch: "fetch('https://example.com'); return null;",
    'dynamic import': "import('fs'); return null;",
    'new Worker': 'return new Worker(1);',
    this: 'return this;',
  };
  for (const [what, body] of Object.entries(blocked)) assert.ok(!checkPlugin(wrap(body)).ok, `${what} should be blocked`);
  const fine = wrap("const { cooldown } = require('./kit'); const m = new Map(); const why = `move ${ev.f.ret}`; const k = ev.coin; return api.p[k] && why ? null : null;");
  assert.ok(checkPlugin(fine).ok, checkPlugin(fine).problems.join('; '));
});

function repo() {
  const dir = tmpDir('gate'), g = (...a) => cp.execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'swarm'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  const commit = (files, msg) => { for (const [f, s] of Object.entries(files)) put(f, s); g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  return { dir, commit };
}

test('loader: a plugin that fails the check is never required (its top-level code never runs)', () => {
  const { loadPlugins } = require('../src/strategies/loader');
  const dir = tmpDir('plug'), mark = path.join(dir, 'ran');
  fs.writeFileSync(path.join(dir, 'evil.js'), `require('fs').writeFileSync(${JSON.stringify(mark)}, 'x');\nmodule.exports = { name: 'evil', tfs: [5], onBar() { return null; } };\n`);
  fs.writeFileSync(path.join(dir, 'good.js'), "module.exports = { name: 'good-one', tfs: [5], onBar() { return null; } };\n");
  const r = loadPlugins(['evil', 'good'], dir);
  assert.deepStrictEqual(r.all.map((p) => p.name), ['good-one']);
  assert.match(r.rejected[0], /^evil: require\('fs'\)/);
  assert.ok(!fs.existsSync(mark), 'the rejected plugin did not run');
  assert.ok(require('../src/strategies').rejected.length === 0, 'every shipped plugin loads');
});

test('update gate: strategy plugins, shadow-mode config, candidates and docs install themselves; tests and the rest wait for Ibrahim', () => {
  const plugin = (body) => `'use strict';\nconst { cooldown } = require('./kit');\nmodule.exports = { name: 'abc', tfs: [5], params: {}, onBar(ev, api) { ${body} } };\n`;
  const cfg = (extra) => JSON.stringify(Object.assign({ trading: { account: 'paper' }, strategies: { a: { enabled: true, mode: 'shadow', params: { x: 1 } } } }, extra), null, 1);
  const index = (names) => `'use strict';\nconst PLUGINS = [\n${names.map((n) => `  '${n}',`).join('\n')}\n];\nmodule.exports = require('./loader').loadPlugins(PLUGINS);\n`;
  const r = repo();
  const c0 = r.commit({ 'swarm/src/strategies/abc.js': plugin('return null;'), 'swarm/src/strategies/index.js': index(['abc']), 'swarm/config/swarm.json': cfg(), 'swarm/config/risk.json': '{"maxOpenRiskPct":0.06}', 'swarm/src/exec/trader.js': '// trader', 'lab/x.js': '1' }, 'base');
  const judge = (c1, c2, account) => gate({ repo: r.dir, oldSha: c1, newSha: c2, account });
  // a new plugin, an index line for it, a candidate, a doc, a shadow-mode config change → auto
  const c1 = r.commit({ 'swarm/src/strategies/def.js': plugin('return ev.f.ret > 0 ? null : null;'), 'swarm/src/strategies/index.js': index(['abc', 'def']), 'swarm/factory/candidates/def.json': '{}', 'swarm/docs/NOTE.md': 'x', 'swarm/config/swarm.json': cfg({ strategies: { a: { enabled: true, mode: 'shadow', params: { x: 2 } }, def: { mode: 'shadow' } } }), 'lab/x.js': '2' }, 'auto');
  assert.strictEqual(judge(c0, c1).verdict, 'auto', JSON.stringify(judge(c0, c1).reasons));
  assert.strictEqual(judge(c0, c1, 'live').verdict, 'approval', 'on a live account every config change waits');
  // a test file is code the updater runs on the PC: it waits, and so does code dropped next to the candidates
  const c1b = r.commit({ 'swarm/test/def.test.js': "require('child_process');", 'swarm/factory/run.js': '//', 'swarm/docs/x.js': '//' }, 'code outside the plugin area');
  assert.deepStrictEqual(judge(c1, c1b).reasons, ['swarm/docs/x.js is protected', 'swarm/factory/run.js is protected', 'swarm/test/def.test.js: tests run on the PC, so they need your OK']);
  // a plugin that reaches outside, risk limits, the trader, other config sections, a strategy switched to trade
  const c2 = r.commit({ 'swarm/src/strategies/def.js': plugin('return process.env.KEY;') }, 'bad plugin');
  assert.match(judge(c1b, c2).reasons.join(), /fails the plugin check/);
  const c3 = r.commit({ 'swarm/config/risk.json': '{"maxOpenRiskPct":0.6}', 'swarm/src/exec/trader.js': '// changed' }, 'protected');
  assert.deepStrictEqual(judge(c2, c3).reasons, ['swarm/config/risk.json is protected', 'swarm/src/exec/trader.js is protected']);
  const c4 = r.commit({ 'swarm/config/swarm.json': cfg({ trading: { account: 'live' } }) }, 'other section');
  assert.match(judge(c3, c4).reasons.join(), /other than strategies changed \(trading\)/);
  const c5 = r.commit({ 'swarm/config/swarm.json': cfg({ strategies: { a: { enabled: true, mode: 'trade' } } }) }, 'to trade');
  assert.match(judge(c4, c5).reasons.join(), /strategy a set to trade/);
  const c6 = r.commit({ 'swarm/src/strategies/index.js': index(['abc']) + 'require("child_process");\n' }, 'index');
  assert.match(judge(c5, c6).reasons.join(), /more than the PLUGINS names/);
  const c7 = r.commit({ 'swarm/src/strategies/loader.js': '// loads anything' }, 'loader');
  assert.deepStrictEqual(judge(c6, c7).reasons, ['swarm/src/strategies/loader.js is protected']);
});

test('signed messages: with the bus key, the trader drops an unsigned order and takes a signed one', async () => {
  const key = Buffer.from('k'.repeat(40)), bus = new MemoryBus({ key }), cfg = baseCfg();
  cfg.trading = Object.assign({}, cfg.trading, { account: 'paper' });
  const t = new Trader({ bus, cfg, dataDir: tmpDir('sig'), busKey: key, heartbeats: false, logSink: quiet });
  await t.start();
  const order = (id) => ({ id, coin: 'ETH', instId: 'ETH-USDT', side: 1, qty: 0.1, entry: { kind: 'maker', px: 2000, waitMin: 5, fallback: 'cancel' }, stop: 1980, target: null, timeStopMin: 30, strategies: [{ name: 's', ideaId: 'i' }] });
  await bus.publish('order', order('forged'), { src: 'risk', key: null }); // what the brain could send: no key
  await bus.drain();
  assert.strictEqual(Object.keys(t.S.orders).length, 0);
  assert.strictEqual(t.metrics.unsignedDropped, 1);
  await bus.publish('order', order('real'), { src: 'risk' });
  await bus.drain();
  assert.deepStrictEqual(Object.keys(t.S.orders), ['real']);
  // a signature does not survive a change to the message
  const m = { v: 1, id: 'x', type: 'order', ts: 1, src: 'risk', trace: 'x', data: { qty: 1 } };
  m.sig = auth.sign(key, m); assert.ok(auth.verify(key, m));
  m.data.qty = 100; assert.ok(!auth.verify(key, m));
  await t.stop();
});

test('deploy scripts: valid bash, and no assignments to bash\'s own variables (GROUPS once broke the installer)', { skip: process.platform === 'win32' && 'bash scripts are for the Linux install' }, () => {
  const special = ['GROUPS', 'RANDOM', 'SECONDS', 'LINENO', 'UID', 'EUID', 'PPID', 'BASHPID']; // bash ignores or rewrites these
  const dir = path.join(ROOT, 'deploy');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sh'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    cp.execFileSync('bash', ['-n', path.join(dir, f)]);
    for (const v of special) assert.ok(!new RegExp(`(^|[;\\s])${v}=`, 'm').test(src.replace(/^\s*#.*$/gm, '')), `${f} assigns ${v}`);
  }
});
