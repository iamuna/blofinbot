'use strict';
// Every strategy plugin the swarm knows, by file name. The agent manager adds or retires names here (through git);
// nothing else in this file may change without Ibrahim's approval. Each plugin must pass the plugin check before
// it is loaded (loader.js).
const PLUGINS = [
  'intraday_trend',
  'trend_pullback',
  'session_drive',
  'overshoot_fade',
  'leader_follow',
  'crowd_squeeze',
  'noise_breakout',
  'dip_reversal',
  'squeeze_ride',
  'rsi_macd',
  'harmonic',
  'ma_21_200',
  'krown_jewel',
  'wyckoff_spring',
  'candles',
  'funding_fade',
  'donchian_trend',
  'oi_flush',
  'pivot_matrix',
  'adaptive_score',
];
module.exports = require('./loader').loadPlugins(PLUGINS);
