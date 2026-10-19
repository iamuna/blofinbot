/* Event calendar: no-new-risk windows around scheduled market-moving news.
 * Source: the weekly economic calendar feed used by Forex Factory (high-impact US releases: CPI, FOMC, jobs …),
 * refreshed hourly, plus manual windows from config (events.manual: [{start, end, title}] in ISO time).
 * Window = 5 minutes before to 10 minutes after each event. Publishes event.window and kv 'events'.
 * If the feed fails, the last good list is kept (saved under <dataDir>/state/events.json).
 */
'use strict';
const path = require('path');
const { Agent } = require('../core/agent');
const net = require('../core/net');
const { writeAtomic, readJSON } = require('../core/fsx');

class EventCalendar extends Agent {
  static agentName = 'events';
  async onStart() {
    this.E = Object.assign({ url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', countries: ['USD'], impact: ['High'], beforeMin: 5, afterMin: 10, refreshMin: 60, manual: [] }, this.cfg.events || {});
    this.http = this.ctx.http || net;
    this.file = path.join(this.ctx.dataDir, 'state', 'events.json');
    this.list = readJSON(this.file, { feed: [] });
    await this.refresh();
    this.every(this.E.refreshMin * 60000, () => this.refresh());
  }
  async refresh() {
    try {
      const rows = await this.http.getJSON(this.E.url, { retries: 2 });
      const feed = [];
      for (const r of rows || []) {
        if (!this.E.countries.includes(r.country) || !this.E.impact.includes(r.impact)) continue;
        const t = Date.parse(r.date); if (!Number.isFinite(t)) continue;
        feed.push({ t, title: `${r.country} ${r.title}`, impact: r.impact });
      }
      this.list = { feed, fetched: this.now() };
      writeAtomic(this.file, JSON.stringify(this.list));
      this.setStatus('ok');
    } catch (e) { this.setStatus('degraded', `calendar feed: ${e.message} (keeping ${this.list.feed.length} saved events)`); }
    const B = this.E.beforeMin * 60000, A = this.E.afterMin * 60000;
    const windows = this.list.feed.map((x) => ({ start: x.t - B, end: x.t + A, title: x.title, impact: x.impact }))
      .concat((this.E.manual || []).map((x) => ({ start: Date.parse(x.start), end: Date.parse(x.end), title: x.title || 'manual', impact: 'manual' })))
      .filter((w) => w.end > this.now() - 3600000).sort((a, b) => a.start - b.start);
    this.gauge('windows', windows.length);
    await this.bus.kv.set('events', { ts: this.now(), windows });
    await this.publish('event.window', { ts: this.now(), windows });
  }
}

module.exports = { EventCalendar };
