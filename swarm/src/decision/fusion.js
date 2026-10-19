/* Fusion: turns a cycle's trade ideas into at most one intent per coin.
 *
 * Ideas on the same coin and side combine: the idea with the largest risk budget leads (its entry, stop, target
 * and exits are used) and the others add their budgets, up to maxStackX × the leader's. Ideas on opposite sides
 * cancel unless one side's budget is at least 2× the other's, in which case the bigger side trades with the
 * difference — so the swarm never pays fees twice to be flat. A coin with an open position or a working order
 * gets no new intent (the trade manager owns it until it is closed).
 */
'use strict';

function fuse(ideas, o = {}) {
  const busy = o.busy || new Set(), budget = o.budget || (() => 0.0025), maxStackX = o.maxStackX || 1.5;
  const byCoin = new Map();
  for (const i of ideas) { if (busy.has(i.coin)) continue; (byCoin.get(i.coin) || byCoin.set(i.coin, []).get(i.coin)).push(i); }
  const intents = [], dropped = [];
  for (const [coin, list] of byCoin) {
    const sides = { 1: [], '-1': [] };
    for (const i of list) { const b = budget(i.strategy); if (b > 0) sides[i.side].push({ i, b }); else dropped.push({ idea: i, why: 'strategy has no budget' }); }
    const sum = (a) => a.reduce((x, y) => x + y.b, 0);
    let L = sum(sides[1]), S = sum(sides['-1']), side = 0, net = 0;
    if (L && S) { if (L >= 2 * S) { side = 1; net = L - S; } else if (S >= 2 * L) { side = -1; net = S - L; } else { for (const x of [...sides[1], ...sides['-1']]) dropped.push({ idea: x.i, why: 'opposite ideas cancelled' }); continue; } }
    else if (L) { side = 1; net = L; } else if (S) { side = -1; net = S; } else continue;
    const group = sides[side].sort((a, b) => b.b - a.b), lead = group[0].i;
    const riskPct = Math.min(net, group[0].b * maxStackX);
    intents.push({
      id: `int-${lead.id}`, coin, side, t: lead.t, entry: lead.entry, stop: lead.stop, target: lead.target == null ? null : lead.target, trail: lead.trail || null,
      timeStopMin: lead.timeStopMin, riskPct, lead: lead.strategy,
      strategies: group.map((x) => ({ name: x.i.strategy, ideaId: x.i.id, budgetPct: x.b })), why: group.map((x) => `${x.i.strategy}: ${x.i.why || ''}`).join(' | '),
    });
    for (const x of group.slice(1)) if (x.i.id !== lead.id) { /* joined the leader */ }
  }
  return { intents, dropped };
}

module.exports = { fuse };
