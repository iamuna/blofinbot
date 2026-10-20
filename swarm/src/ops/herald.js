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

class Herald extends Agent {
  static agentName = 'herald';
  async onStart() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || (this.cfg.herald || {}).token; this.chat = String(process.env.TELEGRAM_CHAT_ID || (this.cfg.herald || {}).chatId || '');
    this.fetch = this.ctx.fetch || fetch; this.sent = new Map(); this.offset = 0; this.hourTrades = []; this.lastDaily = '';
    if (!this.token || !this.chat) this.setStatus('degraded', 'no Telegram token/chat id: messages are only logged');
    this.subscribe('risk.state', (m) => this.onRisk(m.data));
    this.subscribe('sys.log', (m) => { if (m.data.level === 'error') this.say(`⚠️ ${m.data.agent}: ${m.data.msg}`, `err:${m.data.agent}:${m.data.msg}`, 600000); });
    this.subscribe('sys.alert', (m) => this.say(`🚨 ${m.data.text}`, `alert:${m.data.key || m.data.text}`, m.data.everyMs || 600000));
    this.subscribe('trade.closed', (m) => this.hourTrades.push(m.data));
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
  async statusText() {
    const a = (await this.bus.kv.get('account')) || {}, p = (await this.bus.kv.get('positions')) || { open: [] };
    const L = [`Account (${a.mode || '?'}): $${a.equity} (${a.equity0 ? (((a.equity / a.equity0) - 1) * 100).toFixed(2) : '?'}% since start), today ${a.dayPnlPct != null ? (a.dayPnlPct * 100).toFixed(2) : '?'}%, drawdown ${a.dd != null ? (a.dd * 100).toFixed(1) : '?'}%`];
    L.push(`${p.open.length} open: ${p.open.map((x) => `${x.side > 0 ? '+' : '−'}${x.coin}`).join(' ') || 'none'} · open risk ${a.openRiskPct != null ? (a.openRiskPct * 100).toFixed(2) : '?'}% · ${a.trades || 0} trades, win rate ${a.winRate != null ? (a.winRate * 100).toFixed(0) + '%' : '—'}`);
    for (const [k, v] of Object.entries(a.byStrategy || {})) L.push(`  ${k}: ${v.trades} trades, ${v.sumR.toFixed(1)} R, $${v.netUsd.toFixed(2)}`);
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
