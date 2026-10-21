/* Herald: the swarm's line to Ibrahim, over Telegram.
 *
 * Sends: risk-mode changes, errors (at most one per text per 10 minutes), agents going down (watchdog), an hourly
 * digest when anything traded, and a daily summary at 21:00 Amsterdam time.
 * Takes commands only from Ibrahim's chat: /status · /pause · /resume · /flatten · /mode <strategy> <off|shadow|trade>
 * and publishes them as sys.command (by: ibrahim). Only the Herald may publish resume — the risk agent and the
 * trader ignore a resume from anyone else.
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
    try { await this.api('sendMessage', { chat_id: this.chat, text: text.slice(0, 4000), disable_web_page_preview: true }); } catch (e) { this.count('sendErrors'); this.log.warn(e.message); }
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
  shadowText() {
    const day = this.now() - 86400000, by = {};
    for (const t of this.shadow) {
      const b = (by[t.s] = by[t.s] || { n: 0, w: 0, r: 0, n24: 0, r24: 0 });
      b.n++; b.r += t.r; if (t.r > 0) b.w++;
      if (t.x >= day) { b.n24++; b.r24 += t.r; }
    }
    const names = Object.keys(by).sort((a, b) => by[b].r - by[a].r);
    if (!names.length) return ['  no shadow trades yet'];
    const sg = (x) => (x >= 0 ? '+' : '') + x.toFixed(1);
    return names.map((k) => { const b = by[k]; return '  ' + k + ': ' + b.n + ' trades · win ' + Math.round(100 * b.w / b.n) + '% · ' + sg(b.r) + ' R (24h: ' + b.n24 + ', ' + sg(b.r24) + ' R)'; });
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
    L.push('', '🧠 Strategies (mode · results)');
    const names = [...new Set([...Object.keys(modes || {}), ...Object.keys(a.byStrategy || {})])].sort();
    if (!names.length) L.push('  none loaded');
    for (const k of names) { const st = (a.byStrategy || {})[k]; L.push('  ' + k + ': ' + ((modes || {})[k] || 'off') + ' · ' + (st ? st.trades + ' trades, ' + Number(st.sumR).toFixed(1) + ' R, ' + usd(st.netUsd) : 'no trades yet')); }
    L.push('', '👻 Shadow results (all time, best first)', ...this.shadowText());
    L.push('', '🌐 Market data');
    L.push('Universe ' + (u && u.coins ? u.coins.length : '?') + ' coins (' + ((u && u.source) || '?') + ', updated ' + ago(u && u.ts) + ')');
    const nt = Object.entries((g && g.coins) || {}).filter(([, v]) => v && !v.tradable).map(([k, v]) => k + ' (' + (v.reasons || []).join(', ') + ')');
    L.push('Not tradable now: ' + (nt.length ? nt.join('; ') : 'none'));
    L.push('BloFin feed: ' + (feed.sockets || '?') + ' sockets, last message ' + (feed.lastMsgAgeMs != null ? feed.lastMsgAgeMs + ' ms' : '—') + ', ' + (feed.msgs || 0) + ' msgs, ' + (feed.trades || 0) + ' trades');
    L.push('Binance feed: ' + (bf.sockets || '?') + ' sockets' + (bf.msgs ? ', ' + bf.msgs + ' msgs' : ''));
    L.push('', '🖥 PC');
    if (wd.memTotalMb) L.push('RAM ' + (wd.memTotalMb - wd.memFreeMb) + ' of ' + wd.memTotalMb + ' MB used, ' + wd.memFreeMb + ' MB free · swarm process ' + (wd.rssMb != null ? wd.rssMb + ' MB' : '?'));
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
    if (cmd === '/mode' && args.length === 2 && ['off', 'shadow', 'trade'].includes(args[1])) { await send('strategy-mode', { strategy: args[0], mode: args[1] }); return this.say(`${args[0]} → ${args[1]} (takes effect within a minute)`); }
    return this.say('Commands: /status /pause /resume /flatten /mode <strategy> <off|shadow|trade>');
  }
}

module.exports = { Herald };
