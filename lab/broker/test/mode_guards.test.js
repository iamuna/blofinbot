/* The bot's mode guards fire before any network access. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const BOT = path.join(__dirname, '..', '..', 'mtfbot.js');

function run(args, env) {
  const e = Object.assign({}, process.env, env || {});
  for (const k of ['BLOFIN_MODE', 'BLOFIN_API_KEY', 'BLOFIN_API_SECRET', 'BLOFIN_PASSPHRASE', 'GITHUB_ACTIONS']) if (!(env && k in env)) delete e[k];
  return cp.spawnSync(process.execPath, [BOT, 'run', ...args, '--minutes', '0'], { env: e, encoding: 'utf8', timeout: 20000 });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mode-guard-'));
const out = (r) => r.stdout + r.stderr;

test('live and unknown modes are refused', () => {
  for (const m of ['live', 'real']) {
    const r = run(['--state-dir', tmp(), '--broker', m]);
    assert.notEqual(r.status, 0); assert.match(out(r), /not supported by this build/);
  }
  const r = run(['--state-dir', tmp()], { BLOFIN_MODE: 'live' });
  assert.match(out(r), /not supported by this build/);
});

test('demo never runs on GitHub Actions', () => {
  const r = run(['--state-dir', tmp(), '--broker', 'demo'], { GITHUB_ACTIONS: 'true', BLOFIN_API_KEY: 'a', BLOFIN_API_SECRET: 'b', BLOFIN_PASSPHRASE: 'c' });
  assert.notEqual(r.status, 0); assert.match(out(r), /never runs on GitHub Actions/);
});

test('demo needs keys in the environment', () => {
  const r = run(['--state-dir', tmp(), '--broker', 'demo']);
  assert.notEqual(r.status, 0); assert.match(out(r), /needs BLOFIN_API_KEY/);
});

test('paper and demo never share a state dir', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify({ version: 1, cash: 10000 })); // an old paper state (no mode field)
  const r = run(['--state-dir', d, '--broker', 'demo'], { BLOFIN_API_KEY: 'a', BLOFIN_API_SECRET: 'b', BLOFIN_PASSPHRASE: 'c' });
  assert.notEqual(r.status, 0); assert.match(out(r), /belongs to a paper run/);
  const d2 = tmp();
  fs.writeFileSync(path.join(d2, 'state.json'), JSON.stringify({ version: 1, mode: 'demo' }));
  const r2 = run(['--state-dir', d2]);
  assert.notEqual(r2.status, 0); assert.match(out(r2), /belongs to a demo run/);
});
