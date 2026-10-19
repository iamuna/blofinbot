/* Noise-area breakout (intraday momentum): trade when price leaves the band in which it usually wanders at this
 * time of day, and ride it until the end of the UTC day or until it comes back inside.
 * Evidence: "Beat the Market — an effective intraday momentum strategy" (Zarattini, Aziz & Barbon 2024, SPY):
 * noise band = the average absolute move from the day's open at each time of day over the last 14 days; checked
 * every 30 minutes; exit at the band/VWAP or at the close. The same family drives Concretum's Bitcoin intraday
 * trend benchmark (gross Sharpe ~1.6, 2018–2025).
 * Crypto version: the day opens at 00:00 UTC; the stop is max(band edge, VWAP) and trails at that distance;
 * everything is closed at 23:59 UTC.
 */
'use strict';
const DAY = 86400000;

module.exports = {
  name: 'noise-breakout', version: 1, tfs: [30], needsRef: false,
  params: { lookbackDays: 14, minDays: 10, band: 1.0, waitMin: 5, fallback: 'taker', minRiskBps: 15, maxRiskBps: 400 },
  bounds: { lookbackDays: [7, 30], band: [0.6, 1.6], minRiskBps: [5, 40] },
  onBar(ev, api) {
    const { bar, coin, tf } = ev, p = api.p, st = api.state(coin), span = tf * 60000;
    const day = Math.floor(ev.t / DAY) * DAY;
    if (st.day !== day) { st.day = day; st.open = bar.o; st.pv = 0; st.v = 0; st.slots = st.slots || {}; }
    const tp = (bar.h + bar.l + bar.c) / 3, vol = bar.q > 0 ? bar.q : 1;
    st.pv += tp * vol; st.v += vol;
    const vwap = st.pv / st.v, slot = Math.round((ev.t + span - day) / span), move = Math.abs(bar.c / st.open - 1);
    const hist = (st.slots[slot] = st.slots[slot] || []);
    const sigma = hist.length >= p.minDays ? hist.slice(-p.lookbackDays).reduce((a, b) => a + b, 0) / Math.min(hist.length, p.lookbackDays) : null;
    hist.push(move); if (hist.length > 40) hist.shift(); // recorded after use: today's move never sets today's band
    if (sigma == null || api.now >= day + DAY - span) return null; // no band yet, or the last bar of the day
    const up = st.open * (1 + p.band * sigma), dn = st.open * (1 - p.band * sigma), px = bar.c;
    let side = 0, stop = 0;
    if (px > up) { side = 1; stop = Math.max(up, vwap); } else if (px < dn) { side = -1; stop = Math.min(dn, vwap); }
    if (!side) return null;
    const riskBps = (Math.abs(px - stop) / px) * 1e4;
    if (riskBps < p.minRiskBps || riskBps > p.maxRiskBps) return null; // too tight to survive costs, or too loose
    return {
      coin, side, entry: { kind: 'maker', px, waitMin: p.waitMin, fallback: p.fallback, chase: true },
      stop, target: null, trail: { dist: Math.abs(px - stop), afterR: 0 }, timeStopMin: Math.max(1, Math.floor((day + DAY - 60000 - api.now) / 60000)),
      why: `${coin} ${(((px / st.open) - 1) * 100).toFixed(2)}% from the 00:00 open, band ±${(p.band * sigma * 100).toFixed(2)}%, vwap ${vwap.toPrecision(6)}`,
    };
  },
};
