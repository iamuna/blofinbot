/* Plugin loader: reads each strategy plugin's source, runs the plugin check on it (src/factory/plugin_check.js)
 * and only then require()s it — a plugin's top-level code runs at require time, so the check must come first.
 * A plugin that fails is not loaded; its name and problems are kept in `rejected` (the brain reports them).
 * This file is protected (src/tools/update_gate.js): agents may add plugins, not change how they are loaded.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { checkPlugin, checkShape } = require('../factory/plugin_check');

const NAME = /^[a-z0-9_]+$/;
function loadPlugin(file) {
  const base = path.basename(file, '.js');
  if (!NAME.test(base) || base === 'kit' || base === 'loader' || base === 'index') return { error: `${base}: not a plugin file name` };
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { return { error: `${base}: ${e.message}` }; }
  const c = checkPlugin(src);
  if (!c.ok) return { error: `${base}: ${c.problems.join('; ')}` };
  const mod = require(file);
  const shape = checkShape(mod);
  if (shape.length) return { error: `${base}: ${shape.join('; ')}` };
  return { plugin: mod };
}
function loadPlugins(names, dir = __dirname) {
  const all = [], rejected = [];
  for (const n of names) { const r = loadPlugin(path.join(dir, `${n}.js`)); if (r.plugin) all.push(r.plugin); else rejected.push(r.error); }
  return { all, byName: Object.fromEntries(all.map((s) => [s.name, s])), rejected, load: (n) => loadPlugin(path.join(dir, `${n}.js`)) };
}

module.exports = { loadPlugins, loadPlugin };
