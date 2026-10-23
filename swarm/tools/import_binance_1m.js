#!/usr/bin/env node
/* Import a Binance 1-minute kline file (the 1-minute bot's BTCUSD_1m_Binance.zip: Binance SPOT BTCUSDT, 2017-08-17 →
 * 2025-10-11, 4,278,671 bars) into the swarm dataset layout, so backtest/run.js, research/event_study.js and the tuner
 * can run on it:
 *   <out>/<COIN>/1m-YYYY-MM.csv.gz   t,o,h,l,c,v,q,n,bq    (q quote volume, bq taker-buy quote volume)
 *   <out>/<COIN>/funding.csv.gz      header only (spot has no funding)
 *   <out>/manifest.json              months, rows, first/last bar, every gap
 *
 *   node swarm/tools/import_binance_1m.js --in BTCUSD_1m_Binance.zip --out data/btc-spot --coin BTC [--from 2017-09-01]
 *
 * Input: a .zip holding one CSV (read as a stream, never unpacked to disk), a .csv or a .csv.gz; with or without the
 * header row. Timestamps in seconds, milliseconds, microseconds or "YYYY-MM-DD HH:MM:SS" UTC (btc_bot/ingest.py
 * parse_time_ms). Rules carried over from the 1-minute bot (its HANDOFF and LESSONS docs):
 *   - missing minutes are NOT invented: they are listed in the manifest as gaps (the ZIP has 35 of them), and the
 *     feature code already treats a missing boundary minute as a partial bar;
 *   - a duplicated minute keeps the last row; rows are sorted within each month;
 *   - an open time off the minute is snapped down to it and counted (`realigned`): Binance's spot archive has ~20 h
 *     of BTC rows 14.789 s late after the February 2018 outage, which would otherwise read as gaps and odd bars;
 *   - this is SPOT data: no funding, a different venue from BloFin perpetuals. Use it for long-range questions
 *     (does a slow strategy hold up in 2018–2019, an era the 5-year sweep never saw?), not as proof of BloFin fills.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), readline = require('readline');

const MIN = 60000;
function parseTimeMs(v) {
  const s = String(v).trim();
  if (!s) throw new Error('empty timestamp');
  if (/^\d+$/.test(s)) { const n = Number(s); return n > 1e15 ? Math.floor(n / 1000) : n > 1e12 ? n : n * 1000; }
  const t = Date.parse(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  if (!Number.isFinite(t)) throw new Error(`bad timestamp ${s}`);
  return t;
}
// one Binance kline row → [t,o,h,l,c,v,q,n,bq]
function convRow(r) {
  if (r.length < 11) throw new Error(`bad kline row: ${r.join(',')}`);
  return [parseTimeMs(r[0]), +r[1], +r[2], +r[3], +r[4], +r[5], +r[7], Math.round(+r[8]), +r[10]];
}

// the first .csv entry of a zip, from its central directory (sizes there are always filled in; zip64 understood):
// {method, start (offset of the data), size (compressed bytes)}
function zipEntry(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const len = fs.fstatSync(fd).size, tailN = Math.min(len, 65557), tail = Buffer.alloc(tailN);
    fs.readSync(fd, tail, 0, tailN, len - tailN);
    let eo = -1; for (let k = tailN - 22; k >= 0; k--) if (tail.readUInt32LE(k) === 0x06054b50) { eo = k; break; }
    if (eo < 0) throw new Error(`${file}: not a zip file`);
    let cdOff = tail.readUInt32LE(eo + 16), cdSize = tail.readUInt32LE(eo + 12);
    if (cdOff === 0xffffffff && eo >= 20 && tail.readUInt32LE(eo - 20) === 0x07064b50) { // zip64 end locator
      const z = Buffer.alloc(56); fs.readSync(fd, z, 0, 56, Number(tail.readBigUInt64LE(eo - 12)));
      cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
      const method = cd.readUInt16LE(p + 10), nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const name = cd.toString('utf8', p + 46, p + 46 + nl);
      let size = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), local = cd.readUInt32LE(p + 42);
      for (let x = p + 46 + nl; x + 4 <= p + 46 + nl + xl; ) { // zip64 extra field: the 0xFFFFFFFF fields, in order
        const id = cd.readUInt16LE(x), sz = cd.readUInt16LE(x + 2); let q = x + 4;
        if (id === 1) { if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; } if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8; } if (local === 0xffffffff) local = Number(cd.readBigUInt64LE(q)); }
        x += 4 + sz;
      }
      if (/\.csv$/i.test(name)) {
        const h = Buffer.alloc(30); fs.readSync(fd, h, 0, 30, local);
        if (h.readUInt32LE(0) !== 0x04034b50) throw new Error(`${file}: bad local header for ${name}`);
        return { name, method, size, start: local + 30 + h.readUInt16LE(26) + h.readUInt16LE(28) };
      }
      p += 46 + nl + xl + cl;
    }
    throw new Error(`${file}: no .csv inside`);
  } finally { fs.closeSync(fd); }
}

// a readable stream of the file's text: zip (its CSV, stored or deflated), gzip or plain
function openText(file) {
  if (/\.zip$/i.test(file)) {
    const e = zipEntry(file), raw = fs.createReadStream(file, { start: e.start, end: e.start + e.size - 1 });
    if (e.method === 0) return raw; // stored
    if (e.method === 8) return raw.pipe(zlib.createInflateRaw()); // deflated
    throw new Error(`${file}: zip method ${e.method} not supported; unzip it first`);
  }
  const s = fs.createReadStream(file);
  return /\.gz$/i.test(file) ? s.pipe(zlib.createGunzip()) : s;
}

async function importFile(o) {
  const coin = o.coin || 'BTC', dir = path.join(o.out, coin), from = o.from || 0;
  fs.mkdirSync(dir, { recursive: true });
  const fmt = (a) => a.map((x) => (Number.isInteger(x) ? x : +x.toPrecision(10))).join(',');
  const months = [], gaps = [];
  let cur = null, curM = null, rows = 0, dups = 0, first = null, last = null, bad = 0, realigned = 0;
  const flush = () => {
    if (!cur) return;
    const list = [...cur.values()].sort((a, b) => a[0] - b[0]);
    fs.writeFileSync(path.join(dir, `1m-${curM}.csv.gz`), zlib.gzipSync('t,o,h,l,c,v,q,n,bq\n' + list.map(fmt).join('\n') + '\n', { level: 9 }));
    for (const r of list) { if (last != null && r[0] - last > MIN) gaps.push({ after: last, next: r[0], missingMinutes: (r[0] - last) / MIN - 1 }); if (first == null) first = r[0]; last = r[0]; }
    months.push(curM); rows += list.length; cur = null;
  };
  const rl = readline.createInterface({ input: openText(o.in), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || !/^\d/.test(line)) continue; // header or blank
    let r; try { r = convRow(line.split(',')); } catch (e) { bad++; continue; }
    if (r[0] % MIN) { r[0] -= r[0] % MIN; realigned++; }
    if (r[0] < from) continue;
    const m = new Date(r[0]).toISOString().slice(0, 7);
    if (m !== curM) {
      if (curM && m < curM) throw new Error(`rows go back from ${curM} to ${m}: sort the file by time first`);
      flush(); curM = m; cur = new Map();
    }
    if (cur.has(r[0])) dups++;
    cur.set(r[0], r);
  }
  flush();
  fs.writeFileSync(path.join(dir, 'funding.csv.gz'), zlib.gzipSync('t,rate\n'));
  const iso = (t) => (t == null ? null : new Date(t).toISOString());
  const info = { status: rows ? 'ok' : 'empty', source: o.source || `binance klines from ${path.basename(o.in)}`, venue: o.venue || 'binance-spot', rows1m: rows, first: iso(first), last: iso(last), duplicates: dups, realigned, unreadableRows: bad,
    gaps: gaps.map((g) => ({ after: iso(g.after), next: iso(g.next), missingMinutes: g.missingMinutes })), missingMinutes: gaps.reduce((a, g) => a + g.missingMinutes, 0), missing: [] };
  const manFile = path.join(o.out, 'manifest.json');
  const man = fs.existsSync(manFile) ? JSON.parse(fs.readFileSync(manFile, 'utf8')) : { months: [], currentMonthDays: [], coins: {} };
  man.generated = new Date().toISOString(); man.months = [...new Set(man.months.concat(months))].sort(); man.coins[coin] = info;
  man.note = 'Imported with swarm/tools/import_binance_1m.js. Spot data: no funding, not BloFin; gaps are listed, never filled.';
  fs.writeFileSync(manFile, JSON.stringify(man, null, 1));
  return info;
}

if (require.main === module) {
  const A = {}, argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) A[argv[i].slice(2)] = argv[++i];
  if (!A.in || !A.out) { console.error('usage: import_binance_1m.js --in <file.zip|.csv|.csv.gz> --out <dir> [--coin BTC] [--from YYYY-MM-DD]'); process.exit(2); }
  importFile({ in: path.resolve(A.in), out: path.resolve(A.out), coin: A.coin, from: A.from ? Date.parse(A.from) : 0 })
    .then((x) => { const g = x.gaps; console.log(`${x.rows1m} bars ${x.first} → ${x.last}; ${g.length} gaps (${x.missingMinutes} minutes missing), ${x.duplicates} duplicates, ${x.realigned} realigned to the minute, ${x.unreadableRows} unreadable rows`); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { importFile, parseTimeMs, convRow };
