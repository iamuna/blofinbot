#!/usr/bin/env node
/* Update gate: may the home PC install new swarm code on its own, or does Ibrahim have to approve it?
 *
 *   node swarm/src/tools/update_gate.js --repo /opt/swarm --old <sha> --new <sha> [--account paper|demo|live] [--json]
 *   prints "auto: …" or "approval: <reasons>" (exit 0 either way; exit 2 on errors)
 *
 * The updater runs this from the code that is ALREADY installed, against the new commit, so a commit cannot
 * loosen the rules it is judged by. Installed without approval (after every offline test passes, run as `nobody`):
 *   - strategy plugins (swarm/src/strategies/*.js, not kit.js) that pass the plugin check — pure functions of the
 *     bars, no require/process/network/files (src/factory/plugin_check.js);
 *   - strategies/index.js when only names in its PLUGINS list changed;
 *   - config/swarm.json when only the `strategies` section changed, no strategy is switched to "trade", and the
 *     account is not live;
 *   - factory candidates (data, used in CI only), docs.
 * Everything else — tests (they are code the updater runs on the PC, unscreened), risk limits, the
 * risk/coordinator/trader/accountant code, the guardian, the Herald, the bus, the feeds, the installer and this
 * gate — waits until Ibrahim approves it on the PC (`sudo swarm-approve`, approve.ps1 on Windows).
 * Paths outside swarm/ (the trend bot, workflows) are not part of the swarm and are ignored here.
 */
'use strict';
const cp = require('child_process');
const { checkPlugin } = require('../factory/plugin_check');

function git(repo, args) { return cp.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); }
function show(repo, sha, file) { try { return git(repo, ['show', `${sha}:${file}`]); } catch (e) { return null; } }

// not swarm/test/: a test file is any code at all, and the updater runs every test before it installs
const AUTO_ANY = [/^swarm\/factory\/candidates\/[^/]+\.json$/, /^swarm\/factory\/[^/]+\.md$/, /^swarm\/docs\/[^/]+\.md$/, /^swarm\/[^/]+\.md$/];
const PLUGIN = /^swarm\/src\/strategies\/([a-z0-9_]+)\.js$/;

function judgeIndex(oldSrc, newSrc) {
  const norm = (s) => (s || '').split('\n').filter((l) => !/^\s*'[a-z0-9_]+',?\s*$/.test(l)).join('\n').trim();
  return norm(oldSrc) === norm(newSrc);
}
function judgeConfig(oldSrc, newSrc, account) {
  let a, b;
  try { a = JSON.parse(oldSrc || '{}'); b = JSON.parse(newSrc || '{}'); } catch (e) { return ['config/swarm.json is not valid JSON']; }
  const why = [];
  if (account === 'live') why.push('config change on a live account');
  const sa = a.strategies || {}, sb = b.strategies || {};
  const ra = Object.assign({}, a), rb = Object.assign({}, b); delete ra.strategies; delete rb.strategies;
  if (JSON.stringify(ra) !== JSON.stringify(rb)) why.push(`config sections other than strategies changed (${Object.keys(Object.assign({}, ra, rb)).filter((k) => JSON.stringify(ra[k]) !== JSON.stringify(rb[k])).join(', ')})`);
  for (const [k, v] of Object.entries(sb)) if (v && v.mode === 'trade' && !(sa[k] && sa[k].mode === 'trade')) why.push(`strategy ${k} set to trade`);
  return why;
}

function gate({ repo, oldSha, newSha, account = 'paper' }) {
  const files = git(repo, ['diff', '--name-only', oldSha, newSha]).split('\n').filter(Boolean);
  const reasons = [], auto = [];
  for (const f of files) {
    if (!f.startsWith('swarm/')) continue;
    if (AUTO_ANY.some((re) => re.test(f))) { auto.push(f); continue; }
    const pm = f.match(PLUGIN);
    if (pm && pm[1] !== 'kit' && pm[1] !== 'loader') {
      const src = show(repo, newSha, f);
      if (pm[1] === 'index') { if (judgeIndex(show(repo, oldSha, f), src)) auto.push(f); else reasons.push(`${f}: more than the PLUGINS names changed`); continue; }
      if (src == null) { auto.push(f); continue; } // a plugin removed (the tests catch a dangling require)
      const c = checkPlugin(src);
      if (c.ok) auto.push(f); else reasons.push(`${f} fails the plugin check: ${c.problems.join(', ')}`);
      continue;
    }
    if (f === 'swarm/config/swarm.json') {
      const why = judgeConfig(show(repo, oldSha, f), show(repo, newSha, f), account);
      if (why.length) reasons.push(...why); else auto.push(f);
      continue;
    }
    reasons.push(/^swarm\/test\//.test(f) ? `${f}: tests run on the PC, so they need your OK` : `${f} is protected`);
  }
  return { verdict: reasons.length ? 'approval' : 'auto', reasons, auto, files };
}

function main() {
  const A = {}, v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) A[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true;
  try {
    const r = gate({ repo: A.repo || '.', oldSha: A.old, newSha: A.new, account: A.account || 'paper' });
    if (A.json) console.log(JSON.stringify(r, null, 1));
    else console.log(r.verdict === 'auto' ? `auto: ${r.auto.length} file(s), all in the self-service area` : `approval: ${r.reasons.slice(0, 8).join('; ')}${r.reasons.length > 8 ? `; and ${r.reasons.length - 8} more` : ''}`);
  } catch (e) { console.log(`approval: the gate could not judge this update (${e.message.split('\n')[0]})`); process.exitCode = 2; }
}
if (require.main === module) main();
module.exports = { gate, judgeConfig, judgeIndex };
