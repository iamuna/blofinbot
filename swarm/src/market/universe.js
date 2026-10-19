/* Universe agent: which coins the swarm trades.
 *
 * Rule (Ibrahim, 2026-10-19: "minimum ~$20M a day, you decide"):
 *   a BloFin USDT linear perpetual (crypto only) whose Binance USD-M perpetual averaged ≥ $20M a day over the last
 *   7 complete UTC days, and whose BloFin spread is ≤ 5 bps. A coin already in the list stays until its average
 *   falls below $14M or its spread passes 10 bps (hysteresis, so weekend dips don't churn the list).
 * Volume comes from Binance (the market's main venue): the Binance API first, Binance's public daily archive if
 * the API is unreachable (e.g. a US server), and the last saved list if both fail. Spread is BloFin's own, from
 * the data guard's 1-hour median when it has one, else a ticker snapshot.
 * Publishes uni.list (and kv 'universe') at start and every hour; saves it to <dataDir>/state/universe.json.
 */
'use strict';
const path = require('path'), fs = require('fs');
const { Agent } = require('../core/agent');
const net = require('../core/net');
const { writeAtomic, readJSON, utcDay } = require('../core/fsx');

const DAY = 86400000;
const pow10 = (x) => Math.pow(10, Math.round(Math.log10(x)));

class UniverseAgent extends Agent {
  static agentName = 'universe';
  async onStart() {
    this.U = this.cfg.universe; this.B = this.cfg.blofin; this.N = this.cfg.binance;
    this.http = this.ctx.http || net;
    this.file = path.join(this.ctx.dataDir, 'state', 'universe.json');
    this.cacheDir = path.join(this.ctx.dataDir, 'cache', 'binance-1d');
    this.current = readJSON(this.file);
    if (this.current) {
      await this.bus.kv.set('universe', this.current);
      await this.publish('uni.list', Object.assign({}, this.current, { ts: this.now(), added: [], removed: [], stale: true, source: `saved list from ${new Date(this.current.ts).toISOString()} (restart)` }));
    }
    await this.tryRefresh();
    this.every((this.U.refreshMin || 60) * 60000, () => this.tryRefresh());
    // no list or a stale one: try again sooner (every minute without a list, every 10 minutes when stale)
    this.every(60000, () => {
      const age = this.now() - (this.lastTry || 0);
      if (!this.current ? age >= 55000 : this.current.stale && age >= 10 * 60000 - 5000) return this.tryRefresh();
    });
  }
  async tryRefresh() {
    this.lastTry = this.now();
    try { return await this.refresh(); } catch (e) { this.error('refresh', e); this.setStatus('degraded', `refresh failed: ${e.message}`); return null; }
  }

  async blofin(p) {
    const j = await this.http.getJSON(this.B.rest + p);
    if (String(j.code) !== '0') throw new Error(`BloFin ${p}: code ${j.code} ${j.msg || ''}`);
    return j.data;
  }

  async refresh() {
    const U = this.U, ex = new Set(U.exclude || []);
    const [instRows, tickRows] = [await this.blofin('/api/v1/market/instruments'), await this.blofin('/api/v1/market/tickers')];
    const tick = {};
    for (const t of tickRows || []) {
      const last = +t.last, bid = +t.bidPrice, ask = +t.askPrice;
      tick[t.instId] = { last, bid, ask, volQ: (+t.volCurrency24h || 0) * last, spreadBps: bid > 0 && ask > 0 ? ((ask - bid) / ((ask + bid) / 2)) * 1e4 : null };
    }
    const inst = {};
    for (const r of instRows || []) {
      if (!/-USDT$/.test(r.instId) || (r.state && r.state !== 'live') || (r.contractType && r.contractType !== 'linear')) continue;
      const coin = r.baseCurrency || r.instId.slice(0, -5);
      if (ex.has(coin) || !tick[r.instId] || !(tick[r.instId].last > 0)) continue;
      inst[coin] = { coin, instId: r.instId, ct: +r.contractValue, lot: +r.lotSize, min: +r.minSize, tick: +r.tickSize, maxLev: +r.maxLeverage || null, maxMkt: +r.maxMarketSize || null, maxLmt: +r.maxLimitSize || null };
    }
    const guard = await this.bus.kv.get('guard').catch(() => null);
    const medSpread = guard && guard.ts > this.now() - 2 * 3600000 && guard.spreads ? guard.spreads : {};
    const prev = new Set(((this.current && this.current.coins) || []).map((c) => c.coin));

    let vols = null, source = '', problem = '';
    try { vols = await this.volumesFromApi(inst, tick, prev); source = 'binance api'; }
    catch (e1) {
      problem = `Binance API: ${e1.message}`;
      try { vols = await this.volumesFromArchive(inst, tick, prev); source = 'binance archive (API unreachable)'; }
      catch (e2) { problem += `; archive: ${e2.message}`; }
    }
    let coins, stale = false;
    if (vols) {
      coins = [];
      for (const coin of Object.keys(inst)) {
        const v = vols[coin]; if (!v) continue;
        const sp = medSpread[coin] != null ? medSpread[coin] : tick[inst[coin].instId].spreadBps;
        const enter = v.avg >= U.enterVolQ && sp != null && sp <= U.enterSpreadBps;
        const stay = prev.has(coin) && v.avg >= U.exitVolQ && sp != null && sp <= U.exitSpreadBps;
        if (enter || stay) coins.push(Object.assign({}, inst[coin], { binance: { symbol: v.symbol, scale: v.scale }, vol7d: Math.round(v.avg), days: v.days, spreadBps: +sp.toFixed(2), blofinVolQ: Math.round(tick[inst[coin].instId].volQ) }));
      }
      coins.sort((a, b) => b.vol7d - a.vol7d);
      coins = coins.slice(0, U.maxCoins || 80);
      if (!coins.length) { stale = true; source += ' gave no coins'; coins = null; }
    }
    if (!coins) {
      stale = true;
      if (this.current && this.current.coins.length) { coins = this.current.coins.filter((c) => inst[c.coin]).map((c) => Object.assign({}, c, inst[c.coin])); source = `kept previous list (${problem || source})`; }
      else { coins = (U.fallback || []).filter((c) => inst[c]).map((c) => Object.assign({}, inst[c], { binance: null, vol7d: null })); source = `fallback list from config (${problem || source})`; }
    }
    const names = new Set(coins.map((c) => c.coin));
    const added = coins.map((c) => c.coin).filter((c) => !prev.has(c)), removed = [...prev].filter((c) => !names.has(c));
    const list = { ts: this.now(), coins, added, removed, stale, source, rule: { enterVolQ: U.enterVolQ, exitVolQ: U.exitVolQ, days: U.days, enterSpreadBps: U.enterSpreadBps, exitSpreadBps: U.exitSpreadBps } };
    this.current = list;
    writeAtomic(this.file, JSON.stringify(list, null, 1));
    await this.bus.kv.set('universe', list);
    await this.publish('uni.list', list);
    this.gauge('coins', coins.length); this.gauge('source', source);
    this.setStatus(stale ? 'degraded' : 'ok', stale ? source : '');
    this.log.info(`universe: ${coins.length} coins (${source})${added.length ? ' +' + added.join(',') : ''}${removed.length ? ' -' + removed.join(',') : ''}`);
    return list;
  }

  // Binance symbol for a BloFin coin, checked by price (PEPE on BloFin = 1000PEPEUSDT / 1000 on Binance)
  static symbolCandidates(coin) {
    const out = [`${coin}USDT`, `1000${coin}USDT`, `1000000${coin}USDT`];
    if (/^1000/.test(coin)) out.push(`${coin.replace(/^1000+/, '')}USDT`);
    return out;
  }
  // power-of-ten ratio between the two venues' prices; tol = allowed deviation (3% live, 25% vs yesterday's close)
  static scaleFor(binPrice, blofinPrice, tol = 0.03) {
    if (!(binPrice > 0) || !(blofinPrice > 0)) return null;
    const r = binPrice / blofinPrice, s = pow10(r);
    return Math.abs(r / s - 1) < tol ? s : null;
  }

  async volumesFromApi(inst, tick, prev) {
    const N = this.N, U = this.U;
    const info = await this.http.getJSON(`${N.rest}/fapi/v1/exchangeInfo`, { retries: 1 });
    // crypto only: Binance tags stock and commodity perpetuals with another underlyingType than COIN
    const live = new Set((info.symbols || []).filter((s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && (!s.underlyingType || s.underlyingType === 'COIN')).map((s) => s.symbol));
    const t24 = {};
    for (const t of await this.http.getJSON(`${N.rest}/fapi/v1/ticker/24hr`, { retries: 1 })) t24[t.symbol] = { last: +t.lastPrice, qv: +t.quoteVolume };
    const out = {}, today0 = Math.floor(this.now() / DAY) * DAY;
    for (const coin of Object.keys(inst)) {
      const bl = tick[inst[coin].instId].last;
      let symbol = null, scale = null;
      for (const s of UniverseAgent.symbolCandidates(coin)) { if (!live.has(s) || !t24[s]) continue; const k = UniverseAgent.scaleFor(t24[s].last, bl); if (k) { symbol = s; scale = k; break; } }
      if (!symbol) continue;
      if (t24[symbol].qv < (U.prefilterVolQ || 0) && !prev.has(coin)) continue;
      const rows = await this.http.getJSON(`${N.rest}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${(U.days || 7) + 1}`, { retries: 2 });
      const done = rows.filter((r) => +r[0] < today0).slice(-(U.days || 7)); // complete UTC days only
      if (done.length < Math.min(5, U.days || 7)) continue;
      out[coin] = { symbol, scale, avg: done.reduce((a, r) => a + +r[7], 0) / done.length, days: done.length };
      if (this.ctx.paceMs !== 0) await net.sleep(this.ctx.paceMs || 60);
    }
    return out;
  }

  // Binance public archive (data.binance.vision): one zip per symbol per day, cached on disk
  async archiveDay(symbol, day) {
    const f = path.join(this.cacheDir, `${symbol}-${day}.json`);
    const c = readJSON(f); if (c) return c;
    const buf = await this.http.getBuffer(`${this.N.archive}/${symbol}/1d/${symbol}-1d-${day}.zip`);
    let rec;
    if (!buf) rec = { missing: true };
    else {
      const line = net.unzipFirst(buf).toString('utf8').split('\n').find((l) => /^\d/.test(l));
      const r = line.split(',');
      rec = { close: +r[4], qv: +r[7] };
    }
    // a missing file for yesterday may just not be published yet: cache only final answers
    if (!rec.missing || day < utcDay(this.now() - 2 * DAY)) { fs.mkdirSync(this.cacheDir, { recursive: true }); writeAtomic(f, JSON.stringify(rec)); }
    return rec;
  }
  async volumesFromArchive(inst, tick, prev) {
    const U = this.U, days = U.days || 7, out = {};
    const list = Object.keys(inst).filter((c) => prev.has(c) || (U.fallback || []).includes(c) || tick[inst[c].instId].volQ >= (U.archivePrefilterBlofinVolQ || 0));
    let reached = 0, failures = 0;
    const day = async (symbol, d) => {
      for (let a = 0; ; a++) {
        try { return await this.archiveDay(symbol, d); }
        catch (e) { if (a >= 2) { if (++failures > 5) throw e; return { missing: true, error: true }; } await net.sleep(500 * (a + 1)); }
      }
    };
    for (const coin of list) {
      const bl = tick[inst[coin].instId].last;
      for (const symbol of UniverseAgent.symbolCandidates(coin)) {
        const recs = [];
        for (let k = 1; k <= days + 1 && recs.length < days; k++) {
          const r = await day(symbol, utcDay(this.now() - k * DAY));
          if (!r.error) reached++;
          if (!r.missing) recs.push(r);
          else if (k === 2 && !recs.length) break; // two recent days missing: not on Binance under this name
        }
        if (recs.length < Math.min(5, days)) continue;
        const scale = UniverseAgent.scaleFor(recs[0].close, bl, 0.25);
        if (!scale) continue;
        out[coin] = { symbol, scale, avg: recs.reduce((a, r) => a + r.qv, 0) / recs.length, days: recs.length };
        break;
      }
    }
    if (!reached || !Object.keys(out).length) throw new Error('no archive data');
    return out;
  }
}

module.exports = { UniverseAgent };
