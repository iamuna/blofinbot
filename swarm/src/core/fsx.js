'use strict';
const fs = require('fs'), path = require('path');

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function readJSON(file, dflt = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return dflt; }
}
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const utcHour = (ms) => new Date(ms).toISOString().slice(11, 13);

module.exports = { writeAtomic, readJSON, utcDay, utcHour };
