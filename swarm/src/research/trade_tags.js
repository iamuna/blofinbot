/* Trade tags: name the conditions an idea was taken in, then measure whether results differ with and without each.
 *
 * Ported from the 1-minute bot's mistake tags (iamuna/1-min-blofin-bot, btc_bot/learning.py learn_from_trade:
 * loss_in_range, loss_low_volume, loss_against_trend, immediate_adverse_move), changed because of one flaw there:
 * it tagged LOSING trades only and counted every tag as evidence, so a condition that is just as common among
 * winners still looked like a lesson. Here every idea is tagged, winners included, and a tag counts only through its
 * lift: average R with the tag minus average R without it, with a t-stat. Tags use only what was known when the idea
 * was given (regime, features at the signal bar) — except `adverse_first`, an outcome tag, kept separate.
 *
 * The deep review found that filtering by trend did not rescue any losing family; tags are diagnostics for the review
 * and the researcher, not filters to switch on because a number looks good. A tag's lift is a hypothesis for the
 * factory (a candidate with a filter param), and pays the multiple-testing bar like any other try.
 */
'use strict';
const { tstat } = require('./excursions');

// ctx (at the signal bar): {regime: {bias, state, volPct, session}, f: feature object of the signal bar}
function contextTags(idea, ctx, o = {}) {
  const tags = [], r = (ctx && ctx.regime) || {}, f = (ctx && ctx.f) || {};
  const lowVolZ = o.lowVolZ == null ? -0.5 : o.lowVolZ, hiVolPct = o.hiVolPct == null ? 0.8 : o.hiVolPct;
  if (r.state === 'range') tags.push('in_range');
  if (r.state === 'trend') tags.push('in_trend');
  if (Number.isFinite(f.volZ) && f.volZ < lowVolZ) tags.push('low_volume');
  if (Number.isFinite(r.bias) && idea.side * r.bias < 0) tags.push('against_trend');
  if (Number.isFinite(r.bias) && idea.side * r.bias > 0) tags.push('with_trend');
  if (Number.isFinite(r.volPct) && r.volPct >= hiVolPct) tags.push('high_volatility');
  if (r.session) tags.push(`session_${r.session}`);
  tags.push(idea.side > 0 ? 'long' : 'short');
  return tags;
}
// from an excursion record: −1 R was reached before +1 R and the idea never got +0.25 R first (the original's
// "immediate adverse move": MAE ≤ −1 R with MFE < 0.25 R)
function outcomeTags(rec) {
  const last = rec.rows[rec.rows.length - 1];
  return rec.first < 0 && last && last.mfeR < 0.25 ? ['adverse_first'] : [];
}

// items: [{tags: [...], r}] → per tag {n, avgR, nOut, avgROut, lift, t}; t compares the two groups (Welch)
function lift(items, o = {}) {
  const minN = o.minN || 20, all = [...new Set(items.flatMap((x) => x.tags))].sort(), out = {};
  const m = (a) => a.reduce((x, y) => x + y, 0) / a.length, v = (a, mu) => a.reduce((x, y) => x + (y - mu) ** 2, 0) / Math.max(1, a.length - 1);
  for (const tag of all) {
    const a = items.filter((x) => x.tags.includes(tag)).map((x) => x.r), b = items.filter((x) => !x.tags.includes(tag)).map((x) => x.r);
    if (a.length < minN || b.length < minN) { out[tag] = { n: a.length, nOut: b.length, note: `fewer than ${minN} on one side` }; continue; }
    const ma = m(a), mb = m(b), se = Math.sqrt(v(a, ma) / a.length + v(b, mb) / b.length);
    out[tag] = { n: a.length, avgR: +ma.toFixed(3), nOut: b.length, avgROut: +mb.toFixed(3), lift: +(ma - mb).toFixed(3), t: se > 0 ? +((ma - mb) / se).toFixed(2) : null, tAlone: +(tstat(a) || 0).toFixed(2) };
  }
  return out;
}

module.exports = { contextTags, outcomeTags, lift };
