(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const px = (x) => (x == null || !isFinite(x) ? '—' : x >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 1 }) : x >= 1 ? x.toFixed(x >= 100 ? 2 : 4) : x.toPrecision(4));
  const money = (x) => (x == null || !isFinite(x) ? '—' : (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (x, d = 2) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d) + '%');
  const cls = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
  const utc = (t) => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
  const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? Math.round(s) + 's ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 172800 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const S = { state: null, journal: null, candles: null, sel: null, live: null, liveAt: 0, liveErr: null };

  const TFS = [['1m', 'ex'], ['2m', 'ex'], ['3m', 'ex'], ['5m', 'ex'], ['15m', 'ex'], ['30m', 'ex'], ['1h', 'su'], ['2h', 'su'], ['4h', 'su'], ['6h', 'su'], ['12h', 'su'], ['1d', 'st'], ['3d', 'st'], ['1w', 'st'], ['1M', 'st'], ['3M', 'st']];
  const VOTE_TFS = ['1h', '2h', '4h', '6h', '12h', '1d', '3d', '1w', '1M', '3M'];
  function lastClose(tf, t) { // most recent close boundary of a timeframe at or before t (unix s)
    const H = 3600, D = 86400, m = { '1m': 60, '2m': 120, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': H, '2h': 2 * H, '4h': 4 * H, '6h': 6 * H, '12h': 12 * H, '1d': D, '3d': 3 * D };
    if (m[tf]) return Math.floor(t / m[tf]) * m[tf];
    if (tf === '1w') return 4 * D + Math.floor((t - 4 * D) / (7 * D)) * 7 * D;
    const d = new Date(t * 1000), mo = d.getUTCMonth(), y = d.getUTCFullYear();
    return Date.UTC(y, tf === '3M' ? mo - (mo % 3) : mo, 1) / 1000;
  }
  const heat = (v) => (v == null ? '' : v >= 0.67 ? 'v3' : v >= 0.34 ? 'v2' : v > 0.05 ? 'v1' : v <= -0.67 ? 'w3' : v <= -0.34 ? 'w2' : v < -0.05 ? 'w1' : '');

  // ───────── header, tiles, ladder
  function renderHeader() {
    const s = S.state;
    if (s) {
      $('#sub').textContent = `${(s.universe || []).length} BloFin perpetuals · synced ${s.syncedAt ? ago(s.syncedAt) : '—'} · bot heartbeat ${s.updatedAt ? ago(s.updatedAt) : '—'} · risk governor ${s.governor || 'normal'}`;
      const msgs = [];
      if (s.paused) msgs.push('Paused: no new positions.');
      if (s.updatedAt && Date.now() / 1000 - s.updatedAt > 7 * 3600) msgs.push(`Last refresh from the bot was ${ago(s.updatedAt)}; it syncs here every 6 hours.`);
      if (s.errors && s.errors.length) { const e = s.errors[s.errors.length - 1]; if (Date.now() / 1000 - e.t < 3600) msgs.push('Recent bot error: ' + e.msg); }
      const b = $('#banner'); b.hidden = !msgs.length; b.className = 'banner' + (s.paused || (s.errors && s.errors.length) ? ' warn' : ''); b.textContent = msgs.join(' ');
    }
    const btc = s && s.thinking && s.thinking.coins.find((c) => c.coin === 'BTC');
    $('#px').textContent = S.live ? px(S.live) : btc ? px(btc.price) : '—';
    $('#liveDot').className = 'livedot' + (S.live && Date.now() - S.liveAt < 150000 ? ' on' : '');
    $('#pxNote').lastChild.textContent = S.live ? `BTC · live · Crypto.com perp · ${new Date(S.liveAt).toISOString().slice(11, 16)} UTC` : S.liveErr || (btc ? 'BTC · last synced price' : 'BTC · waiting for price');
  }
  function tile(l, v, sub, c) { return `<div class="tile"><span>${esc(l)}</span><b class="${c || ''}">${v}</b><small>${sub || '&nbsp;'}</small></div>`; }
  function renderTiles() {
    const st = S.state && S.state.stats;
    if (!st) { $('#tiles').innerHTML = ['Equity', 'Net P&L', 'Exposure', 'Drawdown', 'Positions', 'Orders working', 'Fees paid', 'Funding'].map((l) => tile(l, '—')).join(''); return; }
    const e0 = S.state.equity0 || 10000;
    $('#tiles').innerHTML = tile('Equity', money(st.equity), 'start ' + money(e0)) + tile('Net P&L', pct(st.netPct), money(st.equity - e0), cls(st.netPct)) +
      tile('Exposure', ((st.gross || 0) * 100).toFixed(0) + '%', 'gross, of equity') + tile('Drawdown', pct(-st.drawdownPct), 'from peak ' + money(st.peak), st.drawdownPct > 0 ? 'neg' : '') +
      tile('Positions', String(st.positions), 'coins held') + tile('Orders working', String(st.openOrders), 'limit at best price') +
      tile('Fees paid', money(st.feesUsd), st.fills + ' fills') + tile('Funding', money(-(st.fundingUsd || 0)), 'received (+) / paid (−)', cls(-(st.fundingUsd || 0)));
  }
  function renderLadder() {
    const th = S.state && S.state.thinking;
    const coins = th ? th.coins : [];
    $('#ladNote').textContent = th ? 'last minute ' + utc(th.t) + ' UTC' : '';
    $('#rungs').innerHTML = TFS.map(([tf, role]) => {
      let val = '', title = '';
      if (VOTE_TFS.includes(tf)) {
        const vs = coins.map((c) => c.votes && c.votes[tf]).filter((v) => v != null);
        const avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
        val = avg == null ? '—' : (avg > 0 ? '+' : '') + avg.toFixed(2); title = 'average vote across coins (−1 short … +1 long)';
      } else if (['1m', '5m', '15m', '30m'].includes(tf)) {
        const vs = coins.map((c) => c.micro && c.micro[tf]).filter((v) => v != null);
        const avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
        val = avg == null ? '—' : (avg > 0 ? '+' : '') + avg.toFixed(0) + ' bp'; title = 'average move over the last 20 candles, informational';
      } else { val = 'orders'; title = 'used for order timing only'; }
      const just = th && th.closed && th.closed.includes(tf);
      return `<div class="rung ${just ? 'just' : ''}" title="${esc(title)}"><b>${tf}</b><small>${esc(val)}</small><small>${th ? utc(lastClose(tf, th.t + 60)).slice(tf.endsWith('m') && tf !== '1M' && tf !== '3M' ? 6 : 0) : '—'}</small></div>`;
    }).join('');
  }

  // ───────── coin matrix
  function bar(target, holding) {
    const max = 6; // % of equity at full bar
    const w = (x) => Math.min(100, (Math.abs(x) / max) * 100);
    const t = target || 0, h = holding || 0;
    const hl = 50 + Math.max(-50, Math.min(50, (h / max) * 50));
    return `<div class="tb" title="target ${t}% · holding ${h}%"><i class="neg-side" style="width:${t < 0 ? w(t) : 0}%;background:var(--down)"></i><i class="pos-side" style="width:${t > 0 ? w(t) : 0}%;background:var(--up)"></i><span class="hold" style="left:calc(${hl}% - 1px)"></span></div>`;
  }
  function renderMatrix() {
    const th = S.state && S.state.thinking;
    if (!th) { $('#matrix').innerHTML = '<tbody><tr><td class="l dim" style="font-family:inherit">Waiting for the bot.</td></tr></tbody>'; return; }
    if (!S.sel || !th.coins.some((c) => c.coin === S.sel)) S.sel = th.coins[0] && th.coins[0].coin;
    const head = `<thead><tr><th class="l">Coin</th><th>Price</th><th class="l">Target ▮ / holding ┃</th><th>Target</th><th>Holding</th>${VOTE_TFS.map((t) => `<th class="heat">${t}</th>`).join('')}<th>Rank</th><th class="l">Status</th></tr></thead>`;
    const body = th.coins.map((c) => {
      const note = !c.order && c.note === 'order working' ? (c.holding ? 'in position' : 'flat') : c.note || '';
      const status = c.windDown ? '<span class="tag bot">winding down</span>' : c.order ? '<span class="tag acc">order working</span>' : `<span class="dim" style="font-family:inherit">${esc(note)}</span>`;
      return `<tr data-coin="${esc(c.coin)}" aria-selected="${c.coin === S.sel}" tabindex="0"><td class="l coin">${esc(c.coin)}</td><td>${px(c.price)}</td><td class="l">${bar(c.target, c.holding)}</td><td class="${cls(c.target)}">${pct(c.target, 1)}</td><td class="${cls(c.holding)}">${pct(c.holding, 1)}</td>` +
        VOTE_TFS.map((t) => { const v = c.votes ? c.votes[t] : null; return `<td class="heat ${heat(v)}" title="${t}: ${v == null ? 'not enough history' : v}">${v == null ? '·' : v === 0 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace(/^0/, '')}</td>`; }).join('') +
        `<td class="${cls(c.xsec)}">${c.xsec == null ? '—' : (c.xsec > 0 ? '+' : '') + c.xsec.toFixed(2)}</td><td class="l">${status}</td></tr>`;
    }).join('');
    $('#matrix').innerHTML = head + '<tbody>' + body + '</tbody>';
  }
  $('#matrix').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-coin]'); if (!tr) return; S.sel = tr.dataset.coin; renderMatrix(); renderCoin(); });
  $('#matrix').addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const tr = e.target.closest('tr[data-coin]'); if (!tr) return; e.preventDefault(); S.sel = tr.dataset.coin; renderMatrix(); renderCoin(); });

  // ───────── selected coin: chart + profile
  function renderCoin() {
    const th = S.state && S.state.thinking; if (!th || !S.sel) return;
    const c = th.coins.find((x) => x.coin === S.sel); if (!c) return;
    const p = c.profile;
    $('#cTag').innerHTML = c.windDown ? '<span class="tag bot">winding down</span>' : c.target > 0 ? '<span class="tag" style="color:var(--up)">long bias</span>' : c.target < 0 ? '<span class="tag" style="color:var(--down)">short bias</span>' : '<span class="tag">flat</span>';
    const micro = c.micro || {};
    const order = c.order ? `<p class="plan"><b>Order working:</b> ${c.order.qty > 0 ? 'buy' : 'sell'} ${Math.abs(c.order.qty).toPrecision(4)} at ${px(c.order.limit)} since ${utc(c.order.since)} UTC (re-posted every minute, market after 30 min).</p>` : '';
    $('#coin').innerHTML = `<div class="coin-h"><b>${esc(c.coin)}</b><span class="mono">${px(c.price)}</span></div>
      <div class="chartwrap"><canvas id="cchart" role="img" aria-label="${esc(c.coin)} hourly candles, last 7 days"></canvas><div class="legend" id="clegend"></div></div>
      <div class="facts"><div><span>Target</span><span class="${cls(c.target)}" style="font:inherit;text-transform:none;letter-spacing:0;color:inherit">${pct(c.target, 2)}</span></div><div><span>Holding</span>${pct(c.holding, 2)}</div><div><span>Cross-coin rank</span>${c.xsec == null ? '—' : c.xsec.toFixed(2)}</div>
      <div><span>1d → 3M vote</span>${c.strategic == null ? '—' : c.strategic}</div><div><span>1h → 12h vote</span>${c.setup == null ? '—' : c.setup}</div><div><span>Volatility (yr)</span>${c.vol == null ? '—' : c.vol + '%'}</div>
      <div><span>Last 20 × 1m</span><span class="${cls(micro['1m'])}" style="font:inherit;text-transform:none;letter-spacing:0">${micro['1m'] == null ? '—' : micro['1m'] + ' bp'}</span></div><div><span>Last 20 × 15m</span><span class="${cls(micro['15m'])}" style="font:inherit;text-transform:none;letter-spacing:0">${micro['15m'] == null ? '—' : micro['15m'] + ' bp'}</span></div><div><span>Last 20 × 30m</span><span class="${cls(micro['30m'])}" style="font:inherit;text-transform:none;letter-spacing:0">${micro['30m'] == null ? '—' : micro['30m'] + ' bp'}</span></div></div>
      ${p ? `<p class="plan"><b>How ${esc(c.coin)} moves:</b> ${(p.vol * 100).toFixed(0)}% annual volatility, ${p.beta}× BTC. Trends at ${esc(p.trends.join(', ') || 'no horizon')}; snaps back at ${esc(p.reverts.join(', ') || 'no horizon')}. Fees are ${(p.feeShare1h * 100).toFixed(0)}% of an hourly candle, so its signals come from <b>${esc(p.minSignal)}</b> and up; 1m–30m frames only time the orders.</p>` : '<p class="plan dim">Profile appears once the coin has 60 days of history.</p>'}
      ${order}`;
    drawCoinChart(c.coin);
  }
  function drawCoinChart(coin) {
    const cv = $('#cchart'); if (!cv) return;
    const d = S.candles && S.candles.coins && S.candles.coins[coin];
    const r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, Hh = r.height; g.clearRect(0, 0, W, Hh);
    if (!d || !d.c.length) { g.fillStyle = css('--ink-3'); g.font = '12.5px ' + css('--f-display'); g.fillText('Candles arrive with the next sync.', 10, 24); return; }
    const n = d.c.length, R = W - 58, T = 22, B = Hh - 18, bw = (R - 6) / n;
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { lo = Math.min(lo, d.l[i]); hi = Math.max(hi, d.h[i]); }
    const fills = ((S.journal && S.journal.fills) || []).filter((f) => f.coin === coin && f.t >= d.t0);
    for (const f of fills) { lo = Math.min(lo, f.price); hi = Math.max(hi, f.price); }
    const pad = (hi - lo) * 0.06 || hi * 0.002; lo -= pad; hi += pad;
    const y = (v) => T + ((hi - v) / (hi - lo)) * (B - T), x = (i) => 6 + i * bw + bw / 2;
    g.font = '10px ' + css('--f-mono'); g.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, yy = Math.round(y(v)) + 0.5; g.strokeStyle = css('--grid'); g.beginPath(); g.moveTo(0, yy); g.lineTo(R, yy); g.stroke(); g.fillStyle = css('--ink-3'); g.fillText(px(v), R + 6, yy); }
    for (let i = 0; i < n; i++) { if (i % 24 === 0) { g.fillStyle = css('--ink-3'); g.fillText(utc(d.t0 + i * 3600).slice(0, 5), x(i) - 12, Hh - 7); } }
    for (let i = 0; i < n; i++) { const up = d.c[i] >= d.o[i]; g.strokeStyle = g.fillStyle = up ? css('--up') : css('--down'); g.beginPath(); g.moveTo(Math.round(x(i)) + 0.5, y(d.h[i])); g.lineTo(Math.round(x(i)) + 0.5, y(d.l[i])); g.stroke(); const a = y(Math.max(d.o[i], d.c[i])), b = y(Math.min(d.o[i], d.c[i])); g.fillRect(x(i) - Math.max(1, bw * 0.35), a, Math.max(1, bw * 0.7), Math.max(1, b - a)); }
    for (const f of fills) { const i = Math.floor((f.t - d.t0) / 3600); if (i < 0 || i >= n) continue; g.fillStyle = f.qty > 0 ? css('--up') : css('--down'); g.beginPath(); const X = x(i), Y = y(f.price); if (f.qty > 0) { g.moveTo(X, Y + 2); g.lineTo(X - 5, Y + 10); g.lineTo(X + 5, Y + 10); } else { g.moveTo(X, Y - 2); g.lineTo(X - 5, Y - 10); g.lineTo(X + 5, Y - 10); } g.fill(); }
    $('#clegend').textContent = `1h candles · last ${Math.round(n / 24)} days · ▲ buys ▼ sells`;
  }

  // ───────── record
  function renderLog() {
    const ev = (S.journal && S.journal.events) || [];
    $('#logCount').textContent = ev.length ? ev.length + ' latest' : '';
    $('#log').innerHTML = ev.length ? ev.slice().reverse().map((e) => `<div><time>${esc(utc(e.t))}</time><span class="t-${esc(e.type)}">${esc(e.text)}</span></div>`).join('') : '<div class="empty" style="display:block">No events yet.</div>';
  }
  function renderFills() {
    const f = ((S.journal && S.journal.fills) || []).slice().reverse();
    $('#fNote').textContent = f.length ? `${f.filter((x) => x.why === 'limit').length} of ${f.length} as limit orders` : '';
    $('#fills').innerHTML = `<thead><tr><th class="l">Time (UTC)</th><th class="l">Coin</th><th class="l">Side</th><th>Size</th><th>Price</th><th>Notional</th><th class="l">Type</th><th>Fee</th></tr></thead><tbody>` +
      (f.length ? f.map((x) => `<tr><td class="l">${esc(utc(x.t))}</td><td class="l" style="font-family:inherit;font-weight:600">${esc(x.coin)}</td><td class="l ${x.qty > 0 ? 'pos' : 'neg'}">${x.qty > 0 ? 'Buy' : 'Sell'}</td><td>${Math.abs(x.qty).toPrecision(4)}</td><td>${px(x.price)}</td><td>${money(Math.abs(x.qty * x.price))}</td><td class="l">${x.why === 'limit' ? 'limit (maker)' : 'market'}</td><td>${money(x.feeUsd)}</td></tr>`).join('') : '<tr><td colspan="8" class="l dim" style="font-family:inherit">No fills yet.</td></tr>') + '</tbody>';
  }
  function renderEquity() {
    const cv = $('#equity'), g = cv.getContext('2d'), r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, Hh = r.height, pts = (S.journal && S.journal.equity) || [], e0 = (S.state && S.state.equity0) || 10000;
    g.clearRect(0, 0, W, Hh);
    if (pts.length < 2) { g.fillStyle = css('--ink-3'); g.font = '12.5px ' + css('--f-display'); g.fillText('The curve fills in as the bot runs.', 12, 24); $('#eqNote').textContent = ''; return; }
    let lo = e0, hi = e0; for (const p of pts) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    const pad = (hi - lo) * 0.15 || 10; lo -= pad; hi += pad;
    const L = 8, R = W - 66, T = 10, B = Hh - 20, t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (R - L), Y = (v) => T + ((hi - v) / (hi - lo)) * (B - T);
    g.strokeStyle = css('--rule'); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(L, Y(e0)); g.lineTo(R, Y(e0)); g.stroke(); g.setLineDash([]);
    const last = pts[pts.length - 1][1], col = last >= e0 ? css('--up') : css('--down');
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.strokeStyle = col; g.lineWidth = 1.6; g.stroke();
    g.lineTo(X(t1), B); g.lineTo(X(t0), B); g.closePath(); g.fillStyle = col; g.globalAlpha = 0.08; g.fill(); g.globalAlpha = 1;
    g.beginPath(); g.arc(X(t1), Y(last), 3, 0, Math.PI * 2); g.fillStyle = col; g.fill();
    g.font = '10.5px ' + css('--f-mono'); g.fillStyle = css('--ink-3'); g.textBaseline = 'middle';
    g.fillText(money(hi - pad), R + 6, Y(hi - pad)); g.fillText(money(lo + pad), R + 6, Y(lo + pad));
    g.fillText(utc(t0).slice(0, 5), L, Hh - 7); g.fillText(utc(t1).slice(0, 5), R - 34, Hh - 7);
    $('#eqNote').textContent = money(last) + ' · ' + pct((last / e0 - 1) * 100);
  }
  function readinessHtml() {
    const rd = S.state && S.state.readiness;
    if (!rd || !rd.checks) return '';
    const n = rd.checks.length, ok = rd.checks.filter((c) => c.ok).length;
    return `<p class="desc" style="margin:14px 0 6px"><b>Ready for ${esc(rd.next || 'the next step')}?</b> <span class="tag ${rd.ready ? 'acc' : ''}">${rd.ready ? 'READY' : 'NOT YET'} · ${ok}/${n}</span> <span class="dim">checks the mechanics (uptime, errors, costs, risk), not profit — weeks are too short to judge profit</span></p>` +
      `<table class="t rd"><tbody>${rd.checks.map((c) => `<tr><td class="${c.ok ? 'pos' : 'dim'}">${c.ok ? '✓' : '…'}</td><td>${esc(c.name)}</td><td class="mono">${esc(c.value)}</td></tr>`).join('')}</tbody></table>`;
  }
  function renderResearch() {
    const r = S.state && S.state.research;
    const k = (lab, m, note) => m ? `<div class="kpi"><span>${esc(lab)}</span><b class="${cls(m.sharpe)}">${m.sharpe}</b><small>Sharpe · ${m.cagr}%/yr · max DD ${m.maxDD}% · ${m.posEras}/6 eras up</small><small class="dim">${esc(note)}</small></div>` : '';
    $('#research').innerHTML = (r ? `<div class="kpis">${k('Top-20 coins, 2020–26', r.main, 'flattered: chosen by today’s volume')}${k('30 unseen coins', r.validation, 'incl. LUNA, FTT, SRM, MATIC — the honest guide')}${k('BTC + ETH only', r.btceth, 'no selection luck at all')}</div>` : '') +
      readinessHtml() +
      `<p class="desc">All after fees, slippage and funding. Each timeframe from 1 hour to 3 months votes at its own close (many lookbacks each); each coin is sized to 25% volatility and tilted toward the strongest coins; shorts come only from 1-day-and-up timeframes. One-minute to 30-minute frames work the orders: post at the best price, re-post each minute, market after 30 minutes — about 2 bps cheaper than market orders. Expect long flat stretches; the worst historical drawdown was 14–16%.</p>`;
  }
  function renderAll() { renderHeader(); renderTiles(); renderLadder(); renderMatrix(); renderCoin(); renderLog(); renderFills(); renderEquity(); renderResearch(); }
  window.addEventListener('resize', () => { renderEquity(); if (S.sel) drawCoinChart(S.sel); });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { renderEquity(); if (S.sel) drawCoinChart(S.sel); }); } catch (e) { /* older browsers */ }
  new MutationObserver(() => { renderEquity(); if (S.sel) drawCoinChart(S.sel); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  setInterval(renderHeader, 30000);
  renderAll();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use('db') : null;
    if (!db) { $('#coin').innerHTML = '<div class="empty">Open this page in claude.ai to see the bot’s synced state.</div>'; return; }
    const on = (id, key) => db.doc('bot/' + id).onSnapshot((snap) => { S[key] = snap.exists ? snap.data() : null; renderAll(); }, () => {});
    on('mtf_state', 'state'); on('mtf_journal', 'journal'); on('mtf_candles', 'candles');
  })();
  (async () => {
    const mcp = window.claude && window.claude.use ? await window.claude.use('mcp') : null;
    if (!mcp) { S.liveErr = 'BTC · live price needs claude.ai'; renderHeader(); return; }
    mcp.watchTool('Crypto.com', 'get_candlestick', { instrument_name: 'BTCUSD-PERP', timeframe: '1m' }, (ev) => {
      if (ev.type === 'data') {
        const p = ev.result && ev.result.payload, rows = (p && (p.data || (p.result && p.result.data))) || [];
        if (!rows.length) return;
        const newest = rows.reduce((a, r) => (Date.parse(r.timestamp || 0) > Date.parse(a.timestamp || 0) ? r : a), rows[0]);
        const v = +(newest.close ?? newest.c);
        if (isFinite(v) && v > 0) { S.live = v; S.liveAt = ev.result.cache ? ev.result.cache.storedAt : Date.now(); S.liveErr = null; renderHeader(); }
      } else {
        const code = ev.error && ev.error.code;
        if (['needs_reauth', 'server_not_connected', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'selection_required'].includes(code)) S.live = null;
        S.liveErr = code === 'needs_reauth' ? 'Reconnect Crypto.com in Settings → Connectors for a live BTC price' : code === 'server_not_connected' ? 'Add the Crypto.com connector for a live BTC price' : code === 'not_in_manifest' || code === 'approval_required' ? 'Allow Crypto.com for this page to see a live BTC price' : 'BTC · live price unavailable; showing last synced price';
        renderHeader();
      }
    }, { refetchInterval: 60000 });
  })();
})();
