/* Recorder: keeps every market message so strategies can be tested on exactly what the swarm saw.
 *
 * Files: <dataDir>/rec/YYYY-MM-DD/HH/<type>.jsonl (UTC hour of the message), one line per message:
 *   {"ts":…, "type":"md.trade", "src":"blofin-feed", "data":{…}}
 * Hours older than 10 minutes are gzipped (<type>.jsonl.gz; a late line is appended as another gzip member).
 * Days older than keepDays are deleted. Uses a durable subscription, so a restart resumes where it stopped.
 * readRecording() streams a time range back in time order — the backtester replays it through the same agents.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { Agent } = require('../core/agent');
const { utcDay, utcHour } = require('../core/fsx');

class Recorder extends Agent {
  static agentName = 'recorder';
  async onStart() {
    this.R = this.cfg.recorder || {};
    this.dir = path.join(this.ctx.dataDir, 'rec');
    fs.mkdirSync(this.dir, { recursive: true });
    this.buf = new Map(); // file → [lines]
    this.subscribe(this.R.types || ['md.*', 'ref.*', 'uni.list', 'guard.status'], (m) => this.write(m), { durable: true });
    this.every(this.R.flushMs || 1000, () => this.flush());
    this.every(5 * 60000, () => this.compress());
    this.every(6 * 3600000, () => this.housekeep());
  }
  async onStop() { this.flush(); }
  fileFor(ts, type) { return path.join(this.dir, utcDay(ts), utcHour(ts), `${type}.jsonl`); }
  write(m) {
    const f = this.fileFor(m.ts, m.type);
    let b = this.buf.get(f); if (!b) this.buf.set(f, (b = []));
    b.push(JSON.stringify({ ts: m.ts, type: m.type, src: m.src, data: m.data }));
    if (b.length >= 2000) this.flushFile(f);
  }
  flushFile(f) {
    const b = this.buf.get(f); if (!b || !b.length) return;
    this.buf.set(f, []);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const text = b.join('\n') + '\n';
    fs.appendFileSync(f, text);
    this.count('lines', b.length); this.count('bytes', text.length);
  }
  flush() { for (const f of [...this.buf.keys()]) { this.flushFile(f); if (!this.buf.get(f).length) this.buf.delete(f); } }
  // gzip finished hours (older than compressAfterMin)
  compress() {
    const cut = this.now() - (this.R.compressAfterMin || 10) * 60000 - 3600000;
    for (const day of listDirs(this.dir)) for (const hour of listDirs(path.join(this.dir, day))) {
      const hourStart = Date.parse(`${day}T${hour}:00:00Z`);
      if (!(hourStart <= cut)) continue;
      const hd = path.join(this.dir, day, hour);
      for (const f of fs.readdirSync(hd).filter((x) => x.endsWith('.jsonl'))) {
        const p = path.join(hd, f);
        if (this.buf.has(p) && this.buf.get(p).length) this.flushFile(p);
        fs.appendFileSync(p + '.gz', zlib.gzipSync(fs.readFileSync(p)));
        fs.unlinkSync(p);
        this.count('compressed');
      }
    }
  }
  housekeep() {
    const keep = this.R.keepDays || 60, cut = utcDay(this.now() - keep * 86400000);
    for (const day of listDirs(this.dir)) if (day < cut) { fs.rmSync(path.join(this.dir, day), { recursive: true, force: true }); this.log.info(`deleted recording ${day} (older than ${keep} days)`); }
  }
}

function listDirs(d) { try { return fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort(); } catch (e) { return []; } }

// Messages of the given types between fromMs and toMs, in time order, one hour at a time.
async function* readRecording(dataDir, { from = 0, to = Infinity, types = null } = {}) {
  const dir = path.join(dataDir, 'rec');
  const want = (t) => !types || types.some((p) => (p.endsWith('*') ? t.startsWith(p.slice(0, -1)) : p === t));
  for (const day of listDirs(dir)) for (const hour of listDirs(path.join(dir, day))) {
    const h0 = Date.parse(`${day}T${hour}:00:00Z`);
    if (h0 + 3600000 <= from || h0 > to) continue;
    const hd = path.join(dir, day, hour), rows = [];
    for (const f of fs.readdirSync(hd)) {
      const type = f.replace(/\.jsonl(\.gz)?$/, '');
      if (!want(type)) continue;
      let text = fs.readFileSync(path.join(hd, f));
      if (f.endsWith('.gz')) text = zlib.gunzipSync(text);
      for (const line of text.toString('utf8').split('\n')) { if (!line) continue; try { const r = JSON.parse(line); if (r.ts >= from && r.ts <= to) rows.push(r); } catch (e) { /* torn line from a crash */ } }
    }
    rows.sort((a, b) => a.ts - b.ts);
    for (const r of rows) yield r;
  }
}

module.exports = { Recorder, readRecording };
