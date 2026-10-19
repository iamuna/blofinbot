#!/usr/bin/env node
/* Build the swarm's backtest dataset from Binance's public archive (data.binance.vision). Runs on a GitHub runner.
 *
 *   node swarm/tools/build_dataset.js <outDir> [--months 6] [--coins BTC,ETH,...]
 *
 * Per coin (BloFin name; prices converted to BloFin units, sizes to base units):
 *   <coin>/1m-YYYY-MM.csv.gz   t,o,h,l,c,v,q,n,bq      1-minute bars, q = quote volume, bq = taker-buy quote volume
 *   <coin>/oi-YYYY-MM.csv.gz   t,oi,oiQ,lsTop,lsAll,takerLS   5-minute open interest and positioning (Binance "metrics")
 *   <coin>/funding.csv.gz      t,rate
 * plus manifest.json (rows, first/last bar, missing days). Every archive is checked against its .CHECKSUM.
 * Complete months come from monthly files, the current month from daily files. Missing data stays missing.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { getBuffer, unzipFirst, sleep } = require('../src/core/net');

const BASE = 'https://data.binance.vision/data/futures/um';
const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) A[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
const OUT = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : 'swarm-data');
const MONTHS = +(A.months || process.env.MONTHS || 6);
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'swarm.json'), 'utf8'));
const COINS = (A.coins || process.env.COINS || cfg.universe.fallback.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const ym = (d) => d.toISOString().slice(0, 7), ymd = (d) => d.toISOString().slice(0, 10);
async function fetchZip(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const body = await getBuffer(url, { timeoutMs: 120000 });
      if (!body) return null;
      const chk = await getBuffer(url + '.CHECKSUM', { timeoutMs: 30000 }).catch(() => null);
      if (chk && chk.toString().split(/\s+/)[0].toLowerCase() !== crypto.createHash('sha256').update(body).digest('hex')) throw new Error('checksum mismatch ' + url);
      return unzipFirst(body).toString('utf8');
    } catch (e) { if (a === 3) throw e; await sleep(2000 * (a + 1)); }
  }
}
const rows = (csv) => csv.split('\n').filter((l) => /^\d/.test(l)).map((l) => l.split(','));

async function symbolFor(coin, probeMonth) {
  for (const [s, scale] of [[`${coin}USDT`, 1], [`1000${coin}USDT`, 1000], [`1000000${coin}USDT`, 1e6]]) {
    const url = `${BASE}/monthly/klines/${s}/1d/${s}-1d-${probeMonth}.zip`;
    const r = await getBuffer(url, { timeoutMs: 30000 }).catch(() => null);
    if (r) return { symbol: s, scale };
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const now = new Date(), firstOfThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const months = []; for (let k = MONTHS; k >= 1; k--) months.push(ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1))));
  const days = []; for (let d = new Date(firstOfThis); d < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); d = new Date(d.getTime() + 86400000)) days.push(ymd(d));
  const probe = months[months.length - 1];
  const manifest = { generated: now.toISOString(), months, currentMonthDays: days, coins: {} };
  const queue = COINS.slice();
  const worker = async () => { for (let coin; (coin = queue.shift()); ) await buildCoin(coin).catch((e) => { manifest.coins[coin] = { status: 'error', error: e.message }; console.log(coin, 'ERROR', e.message); }); };
  await Promise.all(Array.from({ length: +(A.parallel || 4) }, worker));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const ok = Object.values(manifest.coins).filter((c) => c.status === 'ok').length;
  console.log(`done: ${ok}/${COINS.length} coins`);
  if (!ok) process.exit(1);

  async function buildCoin(coin) {
    const t0 = Date.now();
    const sym = await symbolFor(coin, probe);
    if (!sym) { manifest.coins[coin] = { status: 'not on Binance futures' }; console.log(coin, 'not found'); return; }
    const { symbol, scale } = sym, dir = path.join(OUT, coin), info = { symbol, scale, rows1m: 0, rowsOI: 0, missing: [] };
    fs.mkdirSync(dir, { recursive: true });
    const conv1m = (r) => [+r[0], +r[1] / scale, +r[2] / scale, +r[3] / scale, +r[4] / scale, +r[5] * scale, +r[7], +r[8], +r[10]];
    const fmt = (a) => a.map((x) => (typeof x === 'number' && !Number.isInteger(x) ? +x.toPrecision(10) : x)).join(',');
    const write = (file, header, list) => fs.writeFileSync(path.join(dir, file), zlib.gzipSync(header + '\n' + list.map(fmt).join('\n') + '\n', { level: 9 }));
    // 1-minute klines
    const byMonth = {};
    for (const m of months) { const csv = await fetchZip(`${BASE}/monthly/klines/${symbol}/1m/${symbol}-1m-${m}.zip`); if (csv) byMonth[m] = rows(csv).map(conv1m); else info.missing.push('1m ' + m); }
    for (const d of days) { const csv = await fetchZip(`${BASE}/daily/klines/${symbol}/1m/${symbol}-1m-${d}.zip`); const m = d.slice(0, 7); if (csv) (byMonth[m] = byMonth[m] || []).push(...rows(csv).map(conv1m)); else info.missing.push('1m ' + d); }
    for (const [m, list] of Object.entries(byMonth)) { list.sort((a, b) => a[0] - b[0]); write(`1m-${m}.csv.gz`, 't,o,h,l,c,v,q,n,bq', list); info.rows1m += list.length; if (!info.first || list[0][0] < info.first) info.first = list[0][0]; info.last = Math.max(info.last || 0, list[list.length - 1][0]); }
    // 5-minute metrics (open interest, long/short ratios), daily files
    const oi = {};
    const allDays = []; for (let d = new Date(Date.UTC(+months[0].slice(0, 4), +months[0].slice(5) - 1, 1)); ymd(d) < ymd(now); d = new Date(d.getTime() + 86400000)) allDays.push(ymd(d));
    for (const d of allDays) {
      const csv = await fetchZip(`${BASE}/daily/metrics/${symbol}/${symbol}-metrics-${d}.zip`).catch(() => null);
      if (!csv) { info.missing.push('metrics ' + d); continue; }
      for (const r of rows(csv.replace(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/gm, (x) => Date.parse(x.replace(' ', 'T') + 'Z')))) {
        // create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio
        const t = +r[0], m = ymd(new Date(t)).slice(0, 7);
        (oi[m] = oi[m] || []).push([t, +r[2] * scale, +r[3], +r[5], +r[6], +r[7]]);
      }
    }
    for (const [m, list] of Object.entries(oi)) { list.sort((a, b) => a[0] - b[0]); write(`oi-${m}.csv.gz`, 't,oi,oiQ,lsTop,lsAll,takerLS', list); info.rowsOI += list.length; }
    // funding
    const fund = [];
    for (const m of months) { const csv = await fetchZip(`${BASE}/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${m}.zip`).catch(() => null); if (csv) for (const r of rows(csv)) fund.push([+r[0], +r[2]]); }
    fund.sort((a, b) => a[0] - b[0]); write('funding.csv.gz', 't,rate', fund);
    info.status = 'ok'; info.seconds = Math.round((Date.now() - t0) / 1000);
    manifest.coins[coin] = info;
    console.log(`${coin} (${symbol} ÷${scale}): ${info.rows1m} 1m bars, ${info.rowsOI} OI rows, ${fund.length} funding, ${info.missing.length} missing, ${info.seconds}s`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
