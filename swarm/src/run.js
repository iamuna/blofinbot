#!/usr/bin/env node
/* Start swarm agents.
 *
 *   node swarm/src/run.js --group market                      # one process per group in production (systemd)
 *   node swarm/src/run.js --agents universe,blofin-feed --bus memory --data-dir /tmp/sw --minutes 5
 *
 * Options: --config FILE (default swarm/config/swarm.json; SWARM_CONFIG), --bus redis|memory, --redis URL,
 *          --data-dir DIR (SWARM_DATA_DIR), --minutes N (stop after N minutes), --log-samples.
 * SIGINT/SIGTERM stop the agents in reverse order, flush the recorder and close the bus.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { createBus } = require('./core/bus');
const { makeLogger } = require('./core/agent');

const REGISTRY = {
  universe: () => require('./market/universe').UniverseAgent,
  'blofin-feed': () => require('./market/blofin_feed').BlofinFeed,
  'binance-feed': () => require('./market/binance_feed').BinanceFeed,
  guard: () => require('./market/data_guard').DataGuard,
  recorder: () => require('./market/recorder').Recorder,
};

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  return a;
}
function loadConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const local = file.replace(/\.json$/, '.local.json'); // machine-specific overrides, not in git
  if (fs.existsSync(local)) deepMerge(cfg, JSON.parse(fs.readFileSync(local, 'utf8')));
  return cfg;
}
function deepMerge(a, b) { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') deepMerge(a[k], v); else a[k] = v; } return a; }

async function main() {
  const A = args(process.argv.slice(2));
  const cfgFile = path.resolve(A.config || process.env.SWARM_CONFIG || path.join(__dirname, '..', 'config', 'swarm.json'));
  const cfg = loadConfig(cfgFile);
  if (A['log-samples']) cfg.blofin.logSamples = true;
  const names = A.agents ? String(A.agents).split(',') : A.group ? cfg.groups[A.group] : null;
  if (!names || !names.length) throw new Error('give --agents a,b or --group NAME');
  for (const n of names) if (!REGISTRY[n]) throw new Error(`unknown agent ${n} (known: ${Object.keys(REGISTRY).join(', ')})`);
  const dataDir = path.resolve(A['data-dir'] || process.env.SWARM_DATA_DIR || cfg.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const busKind = A.bus || process.env.SWARM_BUS || cfg.bus.kind;
  const log = makeLogger('runner');
  const bus = await createBus({ kind: busKind, url: A.redis || process.env.SWARM_REDIS || cfg.bus.url, prefix: cfg.bus.prefix });
  const ctx = { bus, cfg, dataDir };
  const agents = [];
  for (const n of names) { const C = REGISTRY[n](); const a = new C(ctx, { name: n }); await a.start(); agents.push(a); }
  log.info(`running ${names.join(', ')} on the ${busKind} bus, data in ${dataDir}`);
  let stopping = false;
  const stop = async (why) => {
    if (stopping) return; stopping = true;
    log.info(`stopping (${why})`);
    for (const a of agents.slice().reverse()) { try { await a.stop(); } catch (e) { log.error(`stop ${a.name}`, e); } }
    if (bus.drain) await bus.drain().catch(() => {});
    await bus.close();
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('unhandledRejection', (e) => log.error('unhandled rejection', e));
  if (A.minutes) setTimeout(() => stop(`${A.minutes} minutes done`), +A.minutes * 60000);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { REGISTRY, loadConfig, deepMerge };
