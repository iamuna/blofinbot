/* Plugin check: a strategy plugin must be a pure function of the bars and features it is given.
 *
 * Strategy plugins are the code the slow (Claude) agents write and change on their own, and they run inside the
 * brain. So before one is tested, deployed or loaded, its source must show that it cannot reach anything else:
 * no require() except the strategy kit and the indicator library, no process/global/eval/Function/import, no
 * timers, network, files or Buffers, and none of the usual ways around such a list (constructor/prototype chains,
 * strings glued together inside [...], character-code tricks). A plugin can then only return trade ideas, and
 * every idea still passes the fusion, allocator and risk agents.
 *
 * This is a static screen, not a sandbox: it blocks the plain and the well-known escapes. Agent-written plugins
 * are also backtested, reviewed and only ever start in shadow mode.
 *
 *   node swarm/src/factory/plugin_check.js <plugin.js> [...]      exit 1 if any plugin fails
 */
'use strict';
const fs = require('fs'), path = require('path');

const ALLOWED_REQUIRES = new Set(['./kit', '../analysis/ta']);
const FORBIDDEN_WORDS = [
  'process', 'global', 'globalThis', 'eval', 'Function', 'import', 'constructor', 'prototype', '__proto__', '__defineGetter__',
  '__defineSetter__', '__lookupGetter__', 'Reflect', 'Proxy', 'Buffer', 'fetch', 'WebSocket', 'XMLHttpRequest', 'setTimeout',
  'setInterval', 'setImmediate', 'queueMicrotask', 'WebAssembly', 'Atomics', 'SharedArrayBuffer', 'fromCharCode', 'fromCodePoint',
  'atob', 'btoa', 'unescape', 'escape', 'decodeURI', 'decodeURIComponent', 'getPrototypeOf', 'setPrototypeOf', 'defineProperty',
  'getOwnPropertyDescriptor', 'getOwnPropertyNames', 'child_process', 'worker_threads', 'module', 'exports', 'this', 'arguments', 'with',
];

// strip comments and the contents of string literals (keeping the quotes), so words inside them don't count —
// but remember what the strings said, because some checks look at them
function scan(src) {
  let out = '', i = 0;
  const strings = [];
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; } if (c === '`' && src[j] === '$' && src[j + 1] === '{') { s += '${'; } s += src[j]; j++; }
      strings.push({ q: c, s, at: out.length });
      out += c + (c === '`' && s.includes('${') ? '${}' : '') + c; i = j + 1; continue;
    }
    out += c; i++;
  }
  return { code: out, strings };
}

function checkPlugin(src) {
  const problems = [];
  // the module.exports line is the one sanctioned use of `module`/`exports`
  const body = src.replace(/\bmodule\.exports\s*=/, 'const __plugin__ =');
  const { code, strings } = scan(body);
  // require: only the kit and the indicator library, as plain string literals
  const reqRe = /\brequire\s*\(/g;
  let m;
  const reqs = [];
  while ((m = reqRe.exec(code))) reqs.push(m.index);
  for (const at of reqs) {
    const str = strings.find((s) => s.at > at && s.at < at + 20);
    const lit = str && (str.q === "'" || str.q === '"') ? str.s : null;
    if (!lit || !ALLOWED_REQUIRES.has(lit)) problems.push(`require(${lit ? `'${lit}'` : '…'}): only ${[...ALLOWED_REQUIRES].map((x) => `'${x}'`).join(' and ')} are allowed`);
  }
  const code2 = code.replace(/\brequire\s*\(\s*(['"])\1\s*\)/g, ' __req__ ');
  for (const w of FORBIDDEN_WORDS) if (new RegExp(`(^|[^A-Za-z0-9_$.])${w.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`).test(code2) || new RegExp(`\\.${w}(?![A-Za-z0-9_$])`).test(code2)) problems.push(`uses '${w}'`);
  // computed member access built from strings: x['con' + 'structor'], x[`${a}`], x[s] where s is a string variable is
  // allowed only with plain identifiers/numbers inside the brackets
  const brRe = /\[([^\[\]]*)\]/g;
  while ((m = brRe.exec(code2))) {
    const inside = m[1];
    if (/['"`]/.test(inside) && /[+$]/.test(inside)) problems.push(`computed property built from strings: [${inside.trim()}]`);
  }
  // names that hold text built at run time (from string literals, join, String(), concat, toString) must not be used
  // as a property name: const k = 'con' + 'structor'; x[k]
  const textVars = new Set();
  const declRe = /\b([A-Za-z_$][\w$]*)\s*\+?=(?![=>])(?=([^;\n]*))/g;
  while ((m = declRe.exec(code2))) if (/['"`]|\.join\s*\(|\bString\s*\(|\.concat\s*\(|\.toString\s*\(|\.repeat\s*\(|\.slice\s*\(|\.substr/.test(m[2])) textVars.add(m[1]);
  const useRe = /\[\s*([A-Za-z_$][\w$]*)\s*\]/g;
  while ((m = useRe.exec(code2))) if (textVars.has(m[1])) problems.push(`property name taken from text built at run time: [${m[1]}]`);
  for (const s of strings) {
    if (/\b(constructor|prototype|__proto__|process|require|child_process|eval)\b/.test(s.s)) problems.push(`string mentions '${s.s.match(/\b(constructor|prototype|__proto__|process|require|child_process|eval)\b/)[1]}'`);
  }
  if (/\bnew\s+[A-Z]\w*\s*\(/.test(code2) && /\bnew\s+(?!Map\b|Set\b|Array\b|Float64Array\b|Int8Array\b|Int32Array\b|Error\b|Date\b)[A-Z]\w*/.test(code2)) {
    const what = code2.match(/\bnew\s+(?!Map\b|Set\b|Array\b|Float64Array\b|Int8Array\b|Int32Array\b|Error\b|Date\b)([A-Z]\w*)/)[1];
    problems.push(`new ${what}: only Map, Set, arrays, Date and Error may be constructed`);
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

// a plugin's exports must have the shape the kit expects
function checkShape(mod) {
  const p = [];
  if (!mod || typeof mod !== 'object') return ['does not export an object'];
  if (!/^[a-z0-9-]{3,40}$/.test(mod.name || '')) p.push('name: 3–40 lowercase letters, digits or dashes');
  if (!Array.isArray(mod.tfs) || !mod.tfs.length || mod.tfs.some((t) => ![1, 3, 5, 15, 30, 45].includes(t))) p.push('tfs: a list from 1, 3, 5, 15, 30, 45');
  if (typeof mod.onBar !== 'function') p.push('onBar(ev, api) missing');
  if (mod.params && typeof mod.params !== 'object') p.push('params must be an object');
  return p;
}

if (require.main === module) {
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    const r = checkPlugin(fs.readFileSync(f, 'utf8'));
    if (!r.ok) { bad++; console.log(`${path.basename(f)}: ${r.problems.join('; ')}`); } else console.log(`${path.basename(f)}: ok`);
  }
  process.exitCode = bad ? 1 : 0;
}
module.exports = { checkPlugin, checkShape, scan, ALLOWED_REQUIRES };
