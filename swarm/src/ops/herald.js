/* Herald: the swarm's line to Ibrahim, over Telegram.
 *
 * Sends: risk-mode changes, errors (at most one per text per 10 minutes), agents going down (watchdog), an hourly
 * digest when anything traded, and a daily summary at 21:00 Amsterdam time.
 * Takes commands only from Ibrahim's chat: /status · /pause · /resume · /flatten · /mode <strategy> <off|shadow|trade>
 * and publishes them as sys.command (by: ibrahim). Only the Herald may publish resume — the risk agent and the
 * trader ignore a resume from anyone else. /mode only takes a strategy that exists (configured, or reported by the
 * brain); `/mode <name> off` on a listed name that does not exist removes it (strategy-forget).
 * Secrets: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from the environment (/etc/swarm/secrets.env). Without them
 * the Herald only logs what it would have sent.
 */
'use strict';
const { Agent } = require('../core/agent');
const net = require('../core/net');
const fs = require('fs'), path = require('path');

class Herald extends Agent {
  static agentName = 'herald';
  async onStart() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || (this.cfg.herald || {}).token; this.chat = String(process.env.TELEGRAM_CHAT_ID || (this.cfg.herald || {}).chatId || '');
    this.fetch = this.ctx.fetch || fetch; this.sent = new Map(); this.offset = 0; this.hourTrades = []; this.lastDaily = '';
    if (!this.token || !this.chat) this.setStatus('degraded', 'no Telegram token/chat id: messages are only logged');
    this.hb = {}; this.risk = null;
    this.subscribe('sys.heartbeat', (m) => { this.hb[m.data.agent] = Object.assign({ at: m.ts }, m.data); });
    this.subscribe('risk.state', (m) => { this.risk = m.data; this.onRisk(m.data); });
    this.subscribe('sys.log', (m) => { if (m.data.level === 'error') this.say(`⚠️ ${m.data.agent}: ${m.data.msg}`, `err:${m.data.agent}:${m.data.msg}`, 600000); });
    this.subscribe('sys.alert', (m) => this.say(`🚨 ${m.data.text}`, `alert:${m.data.key || m.data.text}`, m.data.everyMs || 600000));
    this.subscribe('trade.closed', (m) => this.hourTrades.push(m.data));
    this.shadow = []; this.loadShadow();
    this.subscribe('shadow.trade', (m) => this.addShadow(m.data));
    this.every(3600000, () => this.digest());
    this.every(60000, () => this.daily());
    if (this.token && this.chat) this.poll();
  }
  async onStop() { this.stopped = true; }

  async api(method, body) {
    const r = await this.fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 15000) });
    const j = await r.json();
    if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`);
    return j.result;
  }
  async say(text, key, everyMs = 0) {
    const t = this.now();
    if (key && everyMs && this.sent.has(key) && t - this.sent.get(key) < everyMs) return;
    if (key) this.sent.set(key, t);
    this.count('messages');
    if (!this.token || !this.chat) { this.log.info(`(not sent) ${text}`); return; }
    const parts = []; let cur = '';
    for (const line of String(text).split('\n')) { const l = line.slice(0, 3900); if (cur && cur.length + l.length + 1 > 3900) { parts.push(cur); cur = ''; } cur += (cur ? '\n' : '') + l; }
    if (cur || !parts.length) parts.push(cur);
    for (const part of parts) { try { await this.api('sendMessage', { chat_id: this.chat, text: part, disable_web_page_preview: true }); } catch (e) { this.count('sendErrors'); this.log.warn(e.message); } }
  }

  onRisk(r) {
    if (r.mode === this.riskMode) return;
    const prev = this.riskMode; this.riskMode = r.mode;
    if (prev === undefined && r.mode === 'normal') return;
    this.say(`Risk mode ${prev || '?'} → ${r.mode}${r.reasons.length ? ': ' + r.reasons.join('; ') : ''}${r.mode === 'halt' ? '\nTrading is stopped. Reply /resume when you have looked at it.' : ''}`);
  }
  // shadow results: the log state-sync keeps (survives restarts), then live shadow.trade messages
  loadShadow() {
    const file = this.ctx.dataDir && path.join(this.ctx.dataDir, 'state-repo', 'shadow.jsonl');
    if (!file || !fs.existsSync(file)) return;
    try { for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line.trim()) { try { this.addShadow(JSON.parse(line)); } catch (e) { /* bad line */ } } } catch (e) { this.log.warn('shadow log: ' + e.message); }
  }
  addShadow(t) {
    if (!t || !t.strategy || !isFinite(t.r)) return;
    if (t.id) { this.shadowIds = this.shadowIds || new Set(); if (this.shadowIds.has(t.id)) return; this.shadowIds.add(t.id); }
    this.shadow.push({ s: t.strategy, r: +t.r, x: t.exitT || 0 });
  }
  // per strategy: shadow trades, wins, total and average R, best and worst trade, last 24 h
  shadowStats() {
    const day = this.now() - 86400000, by = {};
    for (const t of this.shadow) {
      const b = (by[t.s] = by[t.s] || { n: 0, w: 0, r: 0, best: -Infinity, worst: Infinity, n24: 0, r24: 0 });
      b.n++; b.r += t.r; if (t.r > 0) b.w++; b.best = Math.max(b.best, t.r); b.worst = Math.min(b.worst, t.r);
      if (t.x >= day) { b.n24++; b.r24 += t.r; }
    }
    return by;
  }
  async statusText() {
    const kv = (k) => this.bus.kv.get(k).catch(() => null);
    const [a0, p0, u, g, modes] = await Promise.all([kv('account'), kv('positions'), kv('universe'), kv('guard'), kv('strategyModes')]);
    const a = a0 || {}, p = p0 || { open: [], working: [] }, r = this.risk || {}, hb = this.hb || {};
    const now = this.now(), agents = Object.values(hb), bad = agents.filter((x) => x.status !== 'ok');
    const wd = (hb.watchdog || {}).metrics || {}, feed = (hb['blofin-feed'] || {}).metrics || {}, bf = (hb['binance-feed'] || {}).metrics || {};
    const pct = (x, d = 2) => (x != null && isFinite(x) ? (x * 100).toFixed(d) + '%' : '—');
    const usd = (x) => (x != null && isFinite(x) ? (x < 0 ? '−$' : '$') + Math.abs(x).toFixed(2) : '—');
    const ago = (t) => { if (!t) return '—'; const s = Math.round((now - t) / 1000); return s < 90 ? s + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : (s / 3600).toFixed(1) + ' h ago'; };
    const L = [];
    L.push('📊 Swarm status · ' + new Date(now).toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam' }));
    L.push('Mode ' + (a.mode || 'paper').toUpperCase() + ' · risk ' + (r.mode || this.riskMode || '?') + (r.budgetScale != null && r.budgetScale !== 1 ? ' (budget ×' + r.budgetScale + ')' : '') + (p.paused ? ' · PAUSED' : ''));
    if (r.reasons && r.reasons.length) L.push('Risk reasons: ' + r.reasons.join('; '));
    if (hb.herald && hb.herald.startedAt) L.push('Running for ' + ago(hb.herald.startedAt).replace(' ago', ''));
    L.push('', '💰 Account');
    L.push('Equity ' + usd(a.equity) + ' · cash ' + usd(a.cash) + ' · start ' + usd(a.equity0) + (a.equity0 ? ' (' + pct(a.equity / a.equity0 - 1) + ' total)' : ''));
    L.push('Unrealised ' + usd(a.upl) + ' · peak ' + usd(a.peak) + ' · drawdown ' + pct(a.dd, 1));
    L.push('Today ' + pct(a.dayPnlPct) + ' (day start ' + usd(a.dayStart) + ') · open risk ' + pct(a.openRiskPct) + ' · gross ' + usd(a.gross) + (a.grossX != null ? ' (' + a.grossX.toFixed(2) + '×)' : ''));
    L.push('Fees ' + usd(a.fees) + ' · funding ' + usd(a.funding));
    L.push('Closed trades: ' + (a.trades || 0) + ' · win rate ' + pct(a.winRate, 0));
    L.push('', '📂 Positions: ' + p.open.length + ' open · ' + (p.working || []).length + ' working orders');
    for (const x of p.open) L.push('  ' + (x.side > 0 ? 'LONG ' : 'SHORT') + ' ' + x.coin + ' · ' + ((x.strategies || []).join('+') || '?'));
    // strategies: the loaded ones (each reports as strategy:<name>), with shadow and paper results
    const loaded = Object.keys(hb).filter((k) => k.startsWith('strategy:')).map((k) => k.slice(9));
    const sh = this.shadowStats(), bs = a.byStrategy || {}, md = modes || {};
    const sg = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
    const names = [...new Set([...loaded, ...Object.keys(sh), ...Object.keys(bs)])];
    const score = (k) => (sh[k] ? sh[k].r : 0) + (bs[k] ? Number(bs[k].sumR) || 0 : 0);
    const traded = names.filter((k) => sh[k] || bs[k]).sort((x, y) => score(y) - score(x)), quiet = names.filter((k) => !sh[k] && !bs[k]).sort();
    L.push('', '🧠 Strategies: ' + loaded.length + ' running · ' + traded.length + ' with trades (best first)');
    for (const k of traded) {
      const b = sh[k], st = bs[k], on = loaded.includes(k) ? (md[k] || 'shadow') : 'not running';
      L.push('• ' + k + ' (' + on + ')');
      if (b) L.push('   shadow: ' + b.n + ' trades · win ' + Math.round(100 * b.w / b.n) + '% · ' + sg(b.r) + ' R · avg ' + sg(b.r / b.n) + ' R · best ' + sg(b.best) + ' · worst ' + sg(b.worst) + ' · 24h ' + b.n24 + ' (' + sg(b.r24) + ' R)');
      if (st) L.push('   paper: ' + st.trades + ' trades · ' + sg(Number(st.sumR) || 0) + ' R · ' + usd(st.netUsd));
    }
    if (quiet.length) L.push('No trades yet (' + quiet.length + '): ' + quiet.join(', '));
    const ghost = Object.keys(md).filter((k) => !loaded.includes(k) && md[k] !== 'off' && !sh[k] && !bs[k]);
    if (loaded.length && ghost.length) L.push('Listed but not running (no such strategy): ' + ghost.join(', '));
    L.push('', '🌐 Market data');
    L.push('Universe ' + (u && u.coins ? u.coins.length : '?') + ' coins (' + ((u && u.source) || '?') + ', updated ' + ago(u && u.ts) + ')');
    const nt = Object.entries((g && g.coins) || {}).filter(([, v]) => v && !v.tradable).map(([k, v]) => k + ' (' + (v.reasons || []).join(', ') + ')');
    L.push('Not tradable now: ' + (nt.length ? nt.join('; ') : 'none'));
    L.push('BloFin feed: ' + (feed.sockets || '?') + ' sockets, last message ' + (feed.lastMsgAgeMs != null ? feed.lastMsgAgeMs + ' ms' : '—') + ', ' + (feed.msgs || 0) + ' msgs, ' + (feed.trades || 0) + ' trades');
    L.push('Binance feed: ' + (bf.sockets || '?') + ' sockets' + (bf.msgs ? ', ' + bf.msgs + ' msgs' : ''));
    L.push('', '🖥 PC');
    const brainMb = ((hb.brain || {}).metrics || {}).rssMb;
    if (wd.memTotalMb) L.push('RAM ' + (wd.memTotalMb - wd.memFreeMb) + ' of ' + wd.memTotalMb + ' MB used, ' + wd.memFreeMb + ' MB free · swarm process ' + (wd.rssMb != null ? wd.rssMb + ' MB' : '?') + (brainMb != null ? ' · brain ' + brainMb + ' MB' : ''));
    else if (wd.memFreeMb != null) L.push('RAM ' + wd.memFreeMb + ' MB free (the swarm memory figure needs the newest update)');
    else L.push('RAM: no reading yet');
    L.push('Disk free ' + (wd.diskFreePct != null ? wd.diskFreePct + '%' : '—'));
    L.push('', '⚙️ Agents: ' + (agents.length - bad.length) + '/' + agents.length + ' ok' + (bad.length ? ' · ' + bad.map((x) => x.agent + ' ' + x.status + (x.why ? ' (' + x.why + ')' : '')).join('; ') : ''));
    return L.join('\n');
  }
  async digest() {
    const tr = this.hourTrades.splice(0);
    if (!tr.length) return;
    const net = tr.reduce((x, t) => x + t.netUsd, 0), r = tr.reduce((x, t) => x + t.r, 0);
    await this.say(`Last hour: ${tr.length} trades, ${net >= 0 ? '+' : ''}$${net.toFixed(2)} (${r.toFixed(2)} R)\n${tr.slice(-8).map((t) => `${t.side > 0 ? 'L' : 'S'} ${t.coin} ${t.reason} ${t.r.toFixed(2)}R`).join(', ')}`);
  }
  async daily() {
    const d = new Date(this.now()), local = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
    const key = local.toDateString();
    if (local.getHours() !== 21 || this.lastDaily === key) return;
    this.lastDaily = key;
    await this.say(`Daily summary\n${await this.statusText()}`);
  }

  async poll() {
    while (!this.stopped) {
      try {
        const ups = await this.api('getUpdates', { offset: this.offset, timeout: 30, allowed_updates: ['message'] });
        for (const u of ups) {
          this.offset = u.update_id + 1;
          try { await this.onMessage(u.message); } catch (e) { this.error('command', e); await this.say(`That command failed: ${e.message}`); }
        }
      } catch (e) { this.count('pollErrors'); this.log.warn(`Telegram poll: ${e.message}`); await net.sleep(5000); }
    }
  }
  async onMessage(msg) {
    if (!msg || String(msg.chat && msg.chat.id) !== this.chat) return; // only Ibrahim's chat
    const [cmd, ...args] = String(msg.text || '').trim().split(/\s+/);
    const send = (c, extra) => this.publish('sys.command', Object.assign({ cmd: c, by: 'ibrahim' }, extra));
    if (cmd === '/status') return this.say(await this.statusText());
    if (cmd === '/pause') { await send('pause'); return this.say('Paused: working orders cancelled, no new ones. Positions keep their stops. /resume to continue.'); }
    if (cmd === '/resume') { await send('resume'); return this.say('Resumed.'); }
    if (cmd === '/flatten') { await send('flatten', { why: 'Ibrahim' }); await send('pause'); return this.say('Closing everything and pausing. /resume to continue.'); }
    if (cmd === '/mode' && args.length === 2 && ['off', 'shadow', 'trade'].includes(args[1])) {
      const [name, mode] = args, known = this.knownStrategies();
      if (!known.has(name)) {
        // a name that only exists because of an earlier typo: `/mode <it> off` removes it from the list
        const listed = (await this.bus.kv.get('strategyModes').catch(() => null)) || {};
        if (mode === 'off' && listed[name] !== undefined) { await send('strategy-forget', { strategy: name }); return this.say(`${name} removed from the list (there is no such strategy)`); }
        const near = [...known].filter((k) => editDistance(k, name) <= 2).slice(0, 3);
        return this.say(`There is no strategy called ${name}${near.length ? ` - did you mean ${near.join(' or ')}?` : ''} Nothing changed.`);
      }
      await send('strategy-mode', { strategy: name, mode }); return this.say(`${name} → ${mode} (takes effect within a minute)`);
    }
    return this.say('Commands: /status /pause /resume /flatten /mode <strategy> <off|shadow|trade>');
  }
  // configured strategies and variants, and every strategy the brain reports as loaded
  // strategies, plus the sleeves (/mode sleeve:trend trade: the only way a sleeve trades)
  knownStrategies() { return new Set([...Object.keys(this.cfg.strategies || {}), ...Object.keys(this.cfg.sleeves || {}).map((k) => `sleeve:${k}`),...Object.keys(this.hb || {}).filter((k) => k.startsWith('strategy:')).map((k) => k.slice(9))]); }
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

module.exports = { Herald };
