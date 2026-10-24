# Risk v2 — new limits for Ibrahim to sign (upswarm GUIDE §6.4)

`config/risk.json` is Ibrahim's: no agent edits it, and the guardian halts trading if it changes without his
signature. The code for these limits is in `main` and does nothing until the keys are in the signed file. To switch
them on, add the keys below to `swarm/config/risk.json` (or ask Claude to open the pull request), merge it, and run
`approve.ps1` on the PC: it shows the change and signs it.

| Key | Proposed | What it does | Code |
|---|---|---|---|
| `weekLossStopPct` | `0.025` | week-to-date loss ≥ 2.5% (equity against Monday 00:00 UTC) → no new trades until next Monday; open positions keep their stops | `decision/risk.js` mode(), the accountant keeps `weekStart` |
| `weekLossHalvePct` | `0.04` | a week that ended ≤ −4% → every budget at half the next week | `decision/risk.js` mode() |
| `maxStopDistPct` | `0.25` | the sentinel rejects an idea whose stop is more than 25% from its entry (today a code default) | `decision/sentinel.js` |
| `portVolTargetPct` | `0.10` | the portfolio core's forecast volatility cap, 10% a year (the conductor may only scale down from it) | `portfolio/constructor.js`, `portfolio/conductor.js` |

Not proposed: `maxClusterGrossFrac` (one correlated group ≤ 40% of the gross). The code is there, but on the trend
sleeve 2020–2026 it helped on one sample and hurt on the other (docs/PORTFOLIO_BACKTEST_2026-10-24.md); it is off
until a second sleeve trades and it can be tested on a real multi-sleeve book.

Not built yet (GUIDE §6.4, next): `esLimitPct` (97.5% one-day expected shortfall of the book ≤ 4%) and `liqBufferX`
(a stop at most a third of the way to the liquidation price).

## Why the weekly cap and not more trades

The weekly goal that can be met is a capped weekly loss, not a positive week (GUIDE §10): the best-evidenced system in
the repo wins 47–49% of its weeks. The cap stops a bad week from becoming a bad month; it does not switch strategies
off — nothing is decided on one week's sign.

## The file after signing (the new keys at the end)

```json
  "minOrderUsd": 5,
  "weekLossStopPct": 0.025,
  "weekLossHalvePct": 0.04,
  "maxStopDistPct": 0.25,
  "portVolTargetPct": 0.10
}
```
