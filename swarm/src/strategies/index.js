'use strict';
// Every strategy plugin the swarm knows. The agent manager adds, edits or retires entries here (through git).
const all = [
  require('./intraday_trend'),
  require('./trend_pullback'),
  require('./session_drive'),
  require('./overshoot_fade'),
  require('./leader_follow'),
  require('./crowd_squeeze'),
];
const byName = Object.fromEntries(all.map((s) => [s.name, s]));
module.exports = { all, byName };
