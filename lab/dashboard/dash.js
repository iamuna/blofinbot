(function () {
  'use strict';
  const E = window.Engine;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const px = (x) => (x == null || !isFinite(x) ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: x >= 1000 ? 1 : 2 }));
  const money = (x) => (x == null || !isFinite(x) ? '—' : (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (x, d = 2) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d) + '%');
  const rr = (x) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + 'R');
  const cls = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
  const iso = (t) => new Date(t * 1000).toISOString();
  const utc = (t) => iso(t).slice(5, 16).replace('T', ' ');
  const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? Math.round(s) + 's ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 172800 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
  const tfLabel = (m) => (m >= 60 ? m / 60 + 'h' : m + 'm');
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const S = { state: null, journal: null, candles: null, live: null, liveAt: 0, tf: 'h1', ov: { ema: true, bb: true, sr: true, fib: false, trades: true } };

  // ───────────────────────── chart
  class Chart {
    constructor(cv, legend) {
      this.cv = cv; this.ctx = cv.getContext('2d'); this.legend = legend;
      this.bars = null; this.end = 0; this.count = 120; this.hover = -1; this.hy = -1; this.follow = true;
      const ro = new ResizeObserver(() => this.resize()); ro.observe(cv.parentElement);
      let drag = null;
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, end: this.end }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect();
        if (drag) { const bw = this.plotW / this.count; this.end = drag.end - (e.clientX - drag.x) / bw; this.follow = false; this.clampView(); }
        this.hover = this.idxAt(e.clientX - r.left); this.hy = e.clientY - r.top; this.draw();
      });
      cv.addEventListener('pointerup', () => { drag = null; });
      cv.addEventListener('pointerleave', () => { this.hover = -1; this.draw(); });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect(), i = this.idxAt(e.clientX - r.left);
        const f = e.deltaY > 0 ? 1.15 : 1 / 1.15, nc = Math.max(20, Math.min(this.bars ? this.bars.t.length + 10 : 500, this.count * f));
        if (i >= 0) this.end = i + (this.end - i) * (nc / this.count);
        this.count = nc; this.follow = this.end >= (this.bars ? this.bars.t.length : 0); this.clampView(); this.draw();
      }, { passive: false });
      cv.addEventListener('dblclick', () => { this.reset(); });
    }
    reset() { this.follow = true; this.count = Math.min(120, this.bars ? this.bars.t.length : 120); this.end = (this.bars ? this.bars.t.length : 0) + 2; this.draw(); }
    clampView() { const n = this.bars ? this.bars.t.length : 0; this.end = Math.max(this.count * 0.3, Math.min(n + this.count * 0.4, this.end)); }
    resize() { const r = this.cv.parentElement.getBoundingClientRect(), d = window.devicePixelRatio || 1; this.W = r.width; this.H = r.height; this.cv.width = r.width * d; this.cv.height = r.height * d; this.ctx.setTransform(d, 0, 0, d, 0, 0); this.draw(); }
    get plotW() { return (this.W || 600) - 70; }
    idxAt(x) { const bw = this.plotW / this.count; const i = Math.round(this.end - (this.plotW - x) / bw - 0.5); return this.bars && i >= 0 && i < this.bars.t.length && x < this.plotW ? i : -1; }
    set(bars, extras, keepView) { const was = this.bars ? this.bars.t.length : 0; this.bars = bars; this.ex = extras || {}; if (!keepView || !was) this.reset(); else { if (this.follow) this.end = bars.t.length + 2; this.draw(); } }
    draw() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
    }
    paint() {
      const c = this.ctx, W = this.W, H = this.H, B = this.bars;
      if (!W || !H) return;
      const col = { ink: css('--ink'), ink2: css('--ink-2'), ink3: css('--ink-3'), grid: css('--grid'), rule: css('--rule'), up: css('--up'), down: css('--down'), panel: css('--panel'), bot: css('--bot'), accent: css('--accent'), ma21: css('--ma21'), ma37: css('--ma37'), ma50: css('--ma50'), bb: css('--bb'), fib: css('--fib'), sr: css('--sr') };
      c.clearRect(0, 0, W, H);
      if (!B || !B.t.length) { c.fillStyle = col.ink3; c.font = '13px ' + css('--f-display'); c.fillText('Waiting for candles from the bot…', 16, 40); return; }
      const pw = this.plotW, top = 26, timeH = 22, ph = H - top - timeH, bw = pw / this.count, n = B.t.length;
      const i0 = Math.max(0, Math.floor(this.end - this.count) - 1), i1 = Math.min(n - 1, Math.ceil(this.end));
      const xOf = (i) => pw - (this.end - i - 0.5) * bw;
      let lo = Infinity, hi = -Infinity;
      for (let i = i0; i <= i1; i++) { if (B.l[i] < lo) lo = B.l[i]; if (B.h[i] > hi) hi = B.h[i]; }
      const ex = this.ex || {};
      for (const L of ex.lines || []) if (L.keep) { lo = Math.min(lo, L.price); hi = Math.max(hi, L.price); }
      if (!isFinite(lo)) return;
      const pad = (hi - lo) * 0.08 || hi * 0.001; lo -= pad; hi += pad;
      const yOf = (p) => top + ((hi - p) / (hi - lo)) * ph;
      // grid + price axis
      const step = niceStep((hi - lo) / Math.max(3, Math.floor(ph / 60)));
      c.font = '10.5px ' + css('--f-mono'); c.textBaseline = 'middle';
      for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
        const y = Math.round(yOf(p)) + 0.5;
        c.strokeStyle = col.grid; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y); c.lineTo(pw, y); c.stroke();
        c.fillStyle = col.ink3; c.fillText(px(p), pw + 6, y);
      }
      // time axis
      const span = B.t.length > 1 ? B.t[1] - B.t[0] : 60, every = Math.max(1, Math.ceil(90 / bw));
      c.textBaseline = 'alphabetic';
      for (let i = i0; i <= i1; i++) {
        if (i % every) continue;
        const x = xOf(i); if (x < 20 || x > pw - 20) continue;
        const d = new Date(B.t[i] * 1000);
        const lab = span >= 3600 && d.getUTCHours() === 0 ? d.toISOString().slice(5, 10) : d.toISOString().slice(11, 16);
        c.fillStyle = col.ink3; c.fillText(lab, x - 14, H - 6);
        c.strokeStyle = col.grid; c.beginPath(); c.moveTo(Math.round(x) + 0.5, top); c.lineTo(Math.round(x) + 0.5, top + ph); c.stroke();
      }
      c.strokeStyle = col.rule; c.beginPath(); c.moveTo(pw + 0.5, 0); c.lineTo(pw + 0.5, H); c.moveTo(0, top + ph + 0.5); c.lineTo(pw, top + ph + 0.5); c.stroke();
      c.save(); c.beginPath(); c.rect(0, 0, pw, top + ph); c.clip();
      // volume
      let vmax = 0; for (let i = i0; i <= i1; i++) vmax = Math.max(vmax, B.v[i] || 0);
      if (vmax > 0) for (let i = i0; i <= i1; i++) {
        const vh = (B.v[i] / vmax) * ph * 0.16, x = xOf(i);
        c.fillStyle = B.c[i] >= B.o[i] ? col.up : col.down; c.globalAlpha = 0.16; c.fillRect(x - bw * 0.35, top + ph - vh, Math.max(1, bw * 0.7), vh); c.globalAlpha = 1;
      }
      // Bollinger band fill + lines
      if (ex.bb) {
        c.fillStyle = col.bb; c.globalAlpha = 0.06; c.beginPath(); let st = false;
        for (let i = i0; i <= i1; i++) { if (isNaN(ex.bb.up[i])) continue; const x = xOf(i), y = yOf(ex.bb.up[i]); if (!st) { c.moveTo(x, y); st = true; } else c.lineTo(x, y); }
        for (let i = i1; i >= i0; i--) { if (isNaN(ex.bb.lo[i])) continue; c.lineTo(xOf(i), yOf(ex.bb.lo[i])); }
        c.fill(); c.globalAlpha = 1;
        line(c, ex.bb.up, i0, i1, xOf, yOf, col.bb, 1, [3, 3]); line(c, ex.bb.lo, i0, i1, xOf, yOf, col.bb, 1, [3, 3]);
      }
      for (const m of ex.mas || []) line(c, m.arr, i0, i1, xOf, yOf, css(m.color), 1.4);
      // candles
      const bwid = Math.max(1, bw * 0.68);
      for (let i = i0; i <= i1; i++) {
        const x = xOf(i), up = B.c[i] >= B.o[i];
        c.strokeStyle = c.fillStyle = up ? col.up : col.down;
        c.beginPath(); c.moveTo(Math.round(x) + 0.5, yOf(B.h[i])); c.lineTo(Math.round(x) + 0.5, yOf(B.l[i])); c.stroke();
        const y1 = yOf(Math.max(B.o[i], B.c[i])), y2 = yOf(Math.min(B.o[i], B.c[i]));
        c.fillRect(x - bwid / 2, y1, bwid, Math.max(1, y2 - y1));
      }
      // horizontal levels
      c.font = '10.5px ' + css('--f-mono');
      for (const L of ex.lines || []) {
        const y = Math.round(yOf(L.price)) + 0.5; if (y < top || y > top + ph) continue;
        const x0 = L.from != null ? Math.max(0, xOf(L.from)) : 0;
        const lc = css(L.color) || L.color; c.strokeStyle = lc; c.lineWidth = L.w || 1; c.setLineDash(L.dash || []); c.beginPath(); c.moveTo(x0, y); c.lineTo(pw, y); c.stroke(); c.setLineDash([]);
        if (L.label) { c.fillStyle = lc; c.textBaseline = 'bottom'; c.fillText(L.label, Math.max(x0 + 4, 4), y - 2); }
      }
      // trade markers
      for (const m of ex.markers || []) {
        if (m.i < i0 || m.i > i1) continue;
        const x = xOf(m.i);
        if (m.kind === 'entry') {
          const y = m.dir > 0 ? yOf(B.l[m.i]) + 10 : yOf(B.h[m.i]) - 10;
          c.fillStyle = col.accent; c.beginPath();
          if (m.dir > 0) { c.moveTo(x, y - 6); c.lineTo(x - 5, y + 3); c.lineTo(x + 5, y + 3); } else { c.moveTo(x, y + 6); c.lineTo(x - 5, y - 3); c.lineTo(x + 5, y - 3); }
          c.fill();
        } else {
          const y = yOf(m.price);
          c.fillStyle = m.R > 0 ? col.up : col.down; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
          c.font = '600 10px ' + css('--f-mono'); c.textBaseline = 'bottom'; c.fillText(rr(m.R), x + 6, y - 3);
          if (m.ei != null && m.ei >= i0) { c.strokeStyle = m.R > 0 ? col.up : col.down; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(xOf(m.ei), yOf(m.ep)); c.lineTo(x, y); c.stroke(); c.setLineDash([]); }
        }
      }
      c.restore();
      // last price tag
      const last = ex.livePrice || B.c[n - 1], ly = yOf(last);
      if (ly > top && ly < top + ph) {
        c.fillStyle = last >= B.o[n - 1] ? col.up : col.down; c.fillRect(pw + 1, ly - 9, 69, 18);
        c.fillStyle = col.panel; c.textBaseline = 'middle'; c.font = '600 10.5px ' + css('--f-mono'); c.fillText(px(last), pw + 5, ly);
      }
      // crosshair + legend
      const hi_ = this.hover >= 0 ? this.hover : n - 1;
      if (this.hover >= 0) {
        const x = Math.round(xOf(this.hover)) + 0.5; c.strokeStyle = col.ink3; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, top); c.lineTo(x, top + ph); c.stroke();
        if (this.hy > top && this.hy < top + ph) { c.beginPath(); c.moveTo(0, this.hy + 0.5); c.lineTo(pw, this.hy + 0.5); c.stroke(); const p = hi - ((this.hy - top) / ph) * (hi - lo); c.setLineDash([]); c.fillStyle = col.ink; c.fillRect(pw + 1, this.hy - 9, 69, 18); c.fillStyle = col.panel; c.textBaseline = 'middle'; c.fillText(px(p), pw + 5, this.hy); }
        c.setLineDash([]);
      }
      const ch = B.c[hi_] - B.o[hi_];
      this.legend.innerHTML = `<span>${esc(utc(B.t[hi_]))} UTC</span><span>O <b>${px(B.o[hi_])}</b></span><span>H <b>${px(B.h[hi_])}</b></span><span>L <b>${px(B.l[hi_])}</b></span><span>C <b class="${cls(ch)}">${px(B.c[hi_])}</b></span>` + (ex.mas || []).map((m) => `<span style="color:var(${m.color})">${m.name} ${px(m.arr[hi_])}</span>`).join('');
    }
  }
  function line(c, arr, i0, i1, xOf, yOf, color, w, dash) {
    c.strokeStyle = color; c.lineWidth = w; c.setLineDash(dash || []); c.beginPath(); let st = false;
    for (let i = i0; i <= i1; i++) { const v = arr[i]; if (isNaN(v)) { st = false; continue; } const x = xOf(i), y = yOf(v); if (!st) { c.moveTo(x, y); st = true; } else c.lineTo(x, y); }
    c.stroke(); c.setLineDash([]); c.lineWidth = 1;
  }
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }

  const chart = new Chart($('#chart'), $('#legend'));

  // ───────────────────────── chart data assembly
  function seriesFor(tf) {
    const C = S.candles; if (!C || !C[tf]) return null;
    const src = C[tf], b = { t: src.t.slice(), o: src.o.slice(), h: src.h.slice(), l: src.l.slice(), c: src.c.slice(), v: (src.v || src.t.map(() => 0)).slice() };
    return b;
  }
  const TF = { m1: 60, h1: 3600, h4: 14400 };
  function renderChart(keepView) {
    const b = seriesFor(S.tf);
    if (!b) { chart.set({ t: [], o: [], h: [], l: [], c: [], v: [] }, {}, false); return; }
    const D = E.datasetFromArrays({ t: Float64Array.from(b.t), o: Float64Array.from(b.o), h: Float64Array.from(b.h), l: Float64Array.from(b.l), c: Float64Array.from(b.c), v: Float64Array.from(b.v) }, {});
    const ex = { mas: [], lines: [], markers: [] };
    if (S.ov.ema) ex.mas = [21, 37, 50].map((nn, k) => ({ name: 'EMA' + nn, arr: E.ma(D, 'EMA', nn), color: ['--ma21', '--ma37', '--ma50'][k] }));
    if (S.ov.bb) { const bb = E.bb(D, 20, 2.5); ex.bb = { up: bb.up, lo: bb.lo }; }
    if ((S.ov.sr || S.ov.fib) && D.n > 40) {
      const st = E.structureAt(D, D.n - 1, S.tf === 'm1' ? 8 : 5);
      if (S.ov.sr) for (const L of st.levels.slice(0, 5)) ex.lines.push({ price: L.price, color: '--sr', dash: [5, 4], label: (L.price < D.c[D.n - 1] ? 'S ' : 'R ') + px(L.price) + (L.touches > 1 ? ' ×' + L.touches : '') });
      if (S.ov.fib && st.fib) for (const f of st.fib.levels) ex.lines.push({ price: f.price, from: st.fib.to.i, color: '--fib', dash: [2, 3], label: 'Fib ' + f.f });
    }
    const span = TF[S.tf], bi = (t) => { const bt = Math.floor(t / span) * span; let lo = 0, hi = D.n - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D.t[m] <= bt) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
    if (S.ov.trades && S.journal) for (const tr of S.journal.trades || []) {
      const ei = bi(tr.et), xi = bi(tr.xt); if (xi < 0) continue;
      if (ei >= 0) ex.markers.push({ kind: 'entry', i: ei, dir: tr.dir });
      ex.markers.push({ kind: 'exit', i: xi, price: tr.xp, R: tr.R, ei: ei >= 0 ? ei : null, ep: tr.ep });
    }
    const pos = S.state && S.state.position;
    if (pos) {
      const ei = bi(pos.et);
      if (ei >= 0) ex.markers.push({ kind: 'entry', i: ei, dir: pos.dir });
      ex.lines.push({ price: pos.ep, from: ei >= 0 ? ei : null, color: '--ink-2', w: 1, label: 'entry ' + px(pos.ep), keep: true });
      ex.lines.push({ price: pos.stop, from: ei >= 0 ? ei : null, color: '--down', w: 1.5, label: 'stop ' + px(pos.stop), keep: true });
      ex.lines.push({ price: pos.tp, from: ei >= 0 ? ei : null, color: '--up', w: 1.5, label: 'target ' + px(pos.tp), keep: true });
    }
    if (S.live) ex.livePrice = S.live.price;
    chart.set(b, ex, keepView);
    $('#chartH').textContent = 'BTC-USDT · ' + ({ m1: '1 minute', h1: '1 hour', h4: '4 hours' }[S.tf]) + (S.candles && S.candles.venue ? ' · ' + S.candles.venue : '');
  }

  // ───────────────────────── panels
  function tile(label, value, sub, c) { return `<div class="tile"><span>${esc(label)}</span><b class="${c || ''}">${value}</b><small>${sub || '&nbsp;'}</small></div>`; }
  function renderTiles() {
    const st = S.state && S.state.stats;
    if (!st) { $('#tiles').innerHTML = ['Equity', 'Net P&L', 'Today', 'Trades', 'Win rate', 'Profit factor', 'Avg trade', 'Max drawdown'].map((l) => tile(l, '—')).join(''); return; }
    const pos = S.state.position, livePx = S.live ? S.live.price : null;
    const unreal = pos && livePx ? pos.dir * pos.qty * (livePx - pos.ep) : st.unrealized || 0;
    const eq = (st.equity - (st.unrealized || 0)) + unreal, eq0 = S.state.cfg ? S.state.cfg.equity : 10000;
    const n = st.trades;
    $('#tiles').innerHTML =
      tile('Equity', money(eq), pos ? 'incl. ' + money(unreal) + ' open' : 'start ' + money(eq0)) +
      tile('Net P&L', pct((eq / eq0 - 1) * 100), money(eq - eq0), cls(eq - eq0)) +
      tile('Today', money(st.todayPnl), 'closed trades, UTC day', cls(st.todayPnl)) +
      tile('Trades', String(n), n ? (st.rejectsTotal ? st.rejectsTotal + ' signals skipped' : 'closed') : 'none closed yet') +
      tile('Win rate', n ? (st.winRate * 100).toFixed(0) + '%' : '—', n ? '' : 'needs trades') +
      tile('Profit factor', n ? (st.pf >= 99 ? '∞' : st.pf.toFixed(2)) : '—', 'gross win ÷ gross loss', n ? (st.pf >= 1 ? 'pos' : 'neg') : '') +
      tile('Avg trade', n ? rr(st.expR) : '—', 'in risk units', cls(st.expR)) +
      tile('Max drawdown', pct(-st.maxDD), 'from equity peak', st.maxDD > 0 ? 'neg' : '');
  }
  function evRow(m, k) { return m ? `<div><span>${k}</span><span class="${cls(m.expR)}">${rr(m.expR)}</span> · PF ${m.pf >= 99 ? '∞' : m.pf.toFixed(2)}<br><small class="dim">${m.n} trades</small></div>` : ''; }
  function renderChamp() {
    const s = S.state; if (!s || !s.champion) return;
    const ch = s.champion, ev = ch.evidence || {};
    $('#champPill').innerHTML = `<span class="pill ${ch.status === 'gated' ? 'up' : 'bot'}">${ch.status === 'gated' ? 'passed gate · full risk' : 'probation · half risk'}</span>`;
    const ev4 = ev.minuteManaged4y && ev.minuteManaged4y.full;
    $('#champ').innerHTML = `<div class="champ-name">${esc(ch.name)}</div>
      <p class="desc">${esc(ch.description || '')}</p>
      <div class="kv">${evRow(ev.train, 'Train')}${evRow(ev.val, 'Validation')}${evRow(ev.unseenYearTest || ev.test, ev.unseenYearTest ? 'Unseen year' : 'Test')}</div>
      ${ev4 ? `<div class="kv"><div><span>4 years</span><span class="pos">${rr(ev4.expR)}</span> · PF ${ev4.pf.toFixed(2)}<br><small class="dim">${ev4.n} trades</small></div><div><span>Quarters up</span>${ev.minuteManaged4y.positive} of ${ev.minuteManaged4y.of}</div><div><span>Max DD</span>${ev4.maxDD.toFixed(1)}%</div></div>` : ''}
      ${ch.lastCheck ? `<div class="kv"><div><span>Venue check</span>${ch.lastCheck.gate ? '<span class="pos">passes</span>' : '<span class="dim">not yet</span>'}</div><div><span>Val</span>${ch.lastCheck.val ? ch.lastCheck.val.n + ' tr ' + rr(ch.lastCheck.val.expR) : '—'}</div><div><span>Test</span>${ch.lastCheck.test ? ch.lastCheck.test.n + ' tr ' + rr(ch.lastCheck.test.expR) : '—'}</div></div>` : ''}
      <div class="dim" style="font-size:11.5px">Signals on ${tfLabel(ch.tf)} candles · since ${esc(utc(ch.since))} UTC · source: ${esc(ch.source || '')} · risk ${s.cfg ? s.cfg.risk.riskPct : '—'}% per trade</div>`;
  }
  function renderPos() {
    const s = S.state; const p = s && s.position;
    if (!p) { $('#posPill').className = 'pill'; $('#posPill').textContent = 'Flat'; $('#pos').innerHTML = `<p class="desc">No open position. ${s && s.paused ? 'Paused by the supervisor.' : 'Watching every minute for the next signal.'}</p>`; $('#pos').parentElement.classList.remove('long', 'short'); return; }
    const last = S.live ? S.live.price : s.stats && s.stats.price, rNow = last ? ((last - p.ep) * p.dir) / p.d : null, upnl = last ? p.dir * p.qty * (last - p.ep) : null;
    $('#posPill').className = 'pill ' + (p.dir > 0 ? 'up' : 'down'); $('#posPill').textContent = p.dir > 0 ? 'LONG' : 'SHORT';
    const card = $('#pos').parentElement; card.classList.add('poscard'); card.classList.toggle('long', p.dir > 0); card.classList.toggle('short', p.dir < 0);
    $('#pos').innerHTML = `<div class="kv"><div><span>Entry</span>${px(p.ep)}</div><div><span>Stop</span>${px(p.stop)}</div><div><span>Target</span>${px(p.tp)}</div>
      <div><span>Now</span><span class="${cls(rNow)}">${rr(rNow)}</span></div><div><span>Open P&L</span><span class="${cls(upnl)}">${money(upnl)}</span></div><div><span>Size</span>${p.qty.toFixed(4)} BTC</div></div>
      <div class="dim" style="font-size:11.5px">Opened ${esc(utc(p.et))} UTC · risk ${money(p.risk)} · ${p.be ? 'stop at breakeven' : 'initial stop'}${p.stop !== p.stop0 && !p.be ? ' (trailed)' : ''}</div>`;
  }
  function renderThink() {
    const th = S.state && S.state.thinking;
    if (!th) { $('#think').innerHTML = '<div class="empty">The bot writes what it sees after each minute.</div>'; return; }
    $('#thinkAt').textContent = 'last candle ' + utc(th.t) + ' UTC';
    const ck = (th.checks || []).map((x) => `<tr><td>${esc(x.label)} <span class="dim" style="font-size:10.5px">${x.role}</span></td><td class="${x.L ? 'yes' : 'no'}">${x.L ? '✓' : '·'}</td><td class="${x.S ? 'yes' : 'no'}">${x.S ? '✓' : '·'}</td></tr>`).join('');
    $('#think').innerHTML = `<div class="decision">${esc(th.decision)}</div>
      ${ck ? `<table class="checks"><thead><tr><th>Rule (closed ${tfLabel(th.tf)} bar)</th><th>Long</th><th>Short</th></tr></thead><tbody>${ck}</tbody></table>` : ''}
      <div class="read">${(th.read || []).map((r) => `<div><b>${esc(r.k)}</b><span class="${r.tone === 'up' ? 'pos' : r.tone === 'down' ? 'neg' : ''}">${esc(r.v)}</span></div>`).join('')}</div>`;
  }
  function renderLog() {
    const evs = (S.journal && S.journal.events) || [];
    $('#logCount').textContent = evs.length ? evs.length + ' latest' : '';
    $('#log').innerHTML = evs.length ? evs.slice().reverse().map((e) => `<div><time>${esc(utc(e.t))}</time><span class="t-${esc(e.type)} ${e.type === 'exit' ? (e.R > 0 ? 'w' : 'l') : ''}">${esc(e.text)}</span></div>`).join('') : '<div class="empty" style="display:block">No events yet.</div>';
  }
  function renderTrades() {
    const tr = ((S.journal && S.journal.trades) || []).slice().reverse();
    $('#trades').innerHTML = `<thead><tr><th>Closed (UTC)</th><th class="l">Side</th><th>Entry</th><th>Exit</th><th class="l">Reason</th><th>R</th><th>P&L</th></tr></thead><tbody>` +
      (tr.length ? tr.map((t) => `<tr><td>${esc(utc(t.xt))}</td><td class="l">${t.dir > 0 ? 'Long' : 'Short'}</td><td>${px(t.ep)}</td><td>${px(t.xp)}</td><td class="l">${esc(t.reason)}</td><td class="${cls(t.R)}">${rr(t.R)}</td><td class="${cls(t.pnl)}">${money(t.pnl)}</td></tr>`).join('') : `<tr><td colspan="7" class="l dim" style="font-family:inherit">No closed trades yet. A 1h strategy trades a few times a week at most.</td></tr>`) + '</tbody>';
  }
  function renderLb() {
    const s = S.state; const rows = (s && s.leaderboard) || [];
    const lt = s && s.thinks && s.thinks[s.thinks.length - 1];
    $('#lbNote').textContent = lt ? 'last ' + utc(lt.t) + ' UTC' : '';
    $('#lb').innerHTML = `<thead><tr><th class="l">Challenger</th><th>Val</th><th>Test</th><th class="l">Gate</th></tr></thead><tbody>` +
      (rows.length ? rows.slice(0, 8).map((r) => `<tr><td class="l" style="font-family:inherit;white-space:normal;min-width:180px">${esc(r.name)} · ${tfLabel(r.tf)}</td><td class="${cls(r.val && r.val.expR)}">${r.val ? rr(r.val.expR) + ' /' + r.val.n : '—'}</td><td class="${cls(r.test && r.test.expR)}">${r.test ? rr(r.test.expR) + ' /' + r.test.n : '—'}</td><td class="l">${r.gate && r.gate.pass ? '<span class="pill up">pass</span>' : '<span class="pill">fail</span>'}</td></tr>`).join('') : '<tr><td colspan="4" class="l dim" style="font-family:inherit">The first re-think runs within the hour.</td></tr>') +
      '</tbody>' + (lt ? `<tfoot><tr><td colspan="4" class="l" style="font-family:inherit;white-space:normal;color:var(--ink-2)">${esc(lt.verdict)}</td></tr></tfoot>` : '');
  }
  function renderEquity() {
    const cv = $('#equity'), ctx = cv.getContext('2d'), r = cv.parentElement.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    cv.width = r.width * d; cv.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0);
    const W = r.width, H = r.height, pts = ((S.journal && S.journal.equity) || []).slice();
    ctx.clearRect(0, 0, W, H);
    const eq0 = S.state && S.state.cfg ? S.state.cfg.equity : 10000;
    if (pts.length < 2) { ctx.fillStyle = css('--ink-3'); ctx.font = '12.5px ' + css('--f-display'); ctx.fillText('The curve fills in as the bot runs.', 12, 24); $('#eqNote').textContent = ''; return; }
    let lo = eq0, hi = eq0; for (const p of pts) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    const pad = (hi - lo) * 0.15 || 10; lo -= pad; hi += pad;
    const L = 8, R = W - 62, T = 10, Bm = H - 20, t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (R - L), y = (v) => T + ((hi - v) / (hi - lo)) * (Bm - T);
    ctx.strokeStyle = css('--rule'); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(L, y(eq0)); ctx.lineTo(R, y(eq0)); ctx.stroke(); ctx.setLineDash([]);
    const last = pts[pts.length - 1][1], c = last >= eq0 ? css('--up') : css('--down');
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(x(p[0]), y(p[1])) : ctx.moveTo(x(p[0]), y(p[1])))); ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.lineTo(x(t1), Bm); ctx.lineTo(x(t0), Bm); ctx.closePath(); ctx.fillStyle = c; ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x(t1), y(last), 3, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
    ctx.font = '10.5px ' + css('--f-mono'); ctx.fillStyle = css('--ink-3'); ctx.textBaseline = 'middle';
    ctx.fillText(money(hi - pad).replace('.00', ''), R + 6, y(hi - pad)); ctx.fillText(money(lo + pad).replace('.00', ''), R + 6, y(lo + pad));
    ctx.fillText(utc(t0).slice(0, 5), L, H - 8); ctx.fillText(utc(t1).slice(0, 5), R - 34, H - 8);
    $('#eqNote').textContent = money(last) + ' · ' + pct((last / eq0 - 1) * 100);
  }
  function renderHeader() {
    const s = S.state;
    if (s) {
      $('#sub').textContent = `${s.venue || 'feed pending'} · synced ${s.syncedAt ? ago(s.syncedAt) : '—'} · bot heartbeat ${s.updatedAt ? ago(s.updatedAt) : '—'}`;
      const stale = s.updatedAt && Date.now() / 1000 - s.updatedAt > 3 * 3600;
      const b = $('#banner');
      const msgs = [];
      if (s.paused) msgs.push('Paused by the supervisor: no new entries.');
      if (stale) msgs.push(`This view was last refreshed from the bot ${ago(s.updatedAt)}; trades after that appear on the next hourly sync.`);
      if (s.errors && s.errors.length) { const e = s.errors[s.errors.length - 1]; if (Date.now() / 1000 - e.t < 3600) msgs.push('Recent bot error: ' + e.msg); }
      b.hidden = !msgs.length; b.className = 'banner' + (s.paused || (s.errors && s.errors.length) ? ' warn' : ''); b.textContent = msgs.join(' ');
    }
    const L = S.live;
    const synced = s && s.stats ? s.stats.price : null;
    $('#px').textContent = L ? px(L.price) : synced ? px(synced) : '—';
    $('#liveDot').className = 'livedot' + (L && Date.now() - S.liveAt < 150000 ? ' on' : '');
    $('#pxNote').lastChild.textContent = L ? `live · Crypto.com perp · ${new Date(S.liveAt).toISOString().slice(11, 16)} UTC` : (S.liveErr || (synced ? 'last synced price' : 'waiting for price'));
  }
  function renderAll(keepView) { renderHeader(); renderTiles(); renderChamp(); renderPos(); renderThink(); renderLog(); renderTrades(); renderLb(); renderEquity(); renderChart(keepView); }

  // ───────────────────────── controls
  $('#tfSeg').innerHTML = [['m1', '1m'], ['h1', '1h'], ['h4', '4h']].map(([k, l]) => `<button id="tf-${k}" aria-pressed="${k === S.tf}">${l}</button>`).join('');
  $('#tfSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.tf = b.id.slice(3); for (const x of $('#tfSeg').children) x.setAttribute('aria-pressed', String(x === b)); renderChart(false); });
  const OV = [['ema', 'EMA 21·37·50', '--ma37'], ['bb', 'Bollinger 2.5σ', '--bb'], ['sr', 'Support / resistance', '--sr'], ['fib', 'Fibonacci', '--fib'], ['trades', 'Trades', '--accent']];
  $('#chips').innerHTML = OV.map(([k, l, c]) => `<button class="chip" id="ov-${k}" aria-pressed="${S.ov[k]}"><i style="color:var(${c})"></i>${l}</button>`).join('');
  $('#chips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const k = b.id.slice(3); S.ov[k] = !S.ov[k]; b.setAttribute('aria-pressed', String(S.ov[k])); renderChart(true); });
  window.addEventListener('resize', () => renderEquity());
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { chart.draw(); renderEquity(); }); } catch (e) { /* older browsers */ }
  new MutationObserver(() => { chart.draw(); renderEquity(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  setInterval(() => { renderHeader(); }, 30000);

  renderAll(false);

  // ───────────────────────── data: bot state from the artifact database (synced hourly by the supervisor)
  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use('db') : null;
    if (!db) { $('#champ').innerHTML = '<div class="empty">Open this page in claude.ai to see the bot\'s synced state.</div>'; return; }
    const on = (id, key) => db.doc('bot/' + id).onSnapshot((snap) => { S[key] = snap.exists ? snap.data() : null; renderAll(true); }, () => {});
    on('state', 'state'); on('journal', 'journal'); on('candles', 'candles');
  })();

  // ───────────────────────── live price from the viewer's Crypto.com connector
  (async () => {
    const mcp = window.claude && window.claude.use ? await window.claude.use('mcp') : null;
    if (!mcp) { S.liveErr = 'live price needs claude.ai'; renderHeader(); return; }
    mcp.watchTool('Crypto.com', 'get_candlestick', { instrument_name: 'BTCUSD-PERP', timeframe: '1m' }, (ev) => {
      if (ev.type === 'data') {
        const p = ev.result && ev.result.payload, rows = (p && (p.data || (p.result && p.result.data))) || [];
        if (!rows.length) return;
        const newest = rows.reduce((a, r) => (Date.parse(r.timestamp || 0) > Date.parse(a.timestamp || 0) ? r : a), rows[0]);
        const price = +(newest.close ?? newest.c);
        if (isFinite(price) && price > 0) { S.live = { price }; S.liveAt = ev.result.cache ? ev.result.cache.storedAt : Date.now(); S.liveErr = null; renderHeader(); renderTiles(); renderPos(); chart.ex && (chart.ex.livePrice = price); chart.draw(); }
      } else {
        const code = ev.error && ev.error.code;
        if (['needs_reauth', 'server_not_connected', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'selection_required'].includes(code)) S.live = null;
        S.liveErr = code === 'needs_reauth' ? 'Reconnect Crypto.com in Settings → Connectors for a live price'
          : code === 'server_not_connected' ? 'Add the Crypto.com connector for a live price'
          : code === 'not_in_manifest' || code === 'approval_required' ? 'Allow Crypto.com for this page to see a live price'
          : 'Live price unavailable right now; showing the last synced price';
        renderHeader();
      }
    }, { refetchInterval: 60000 });
  })();
})();
