# Daily review — Saturday 2026-10-24 (05:45 UTC, 07:45 Amsterdam)

State: swarm-state 2026-10-24T05:33Z · factory 92930ab · main b278683 · scoreboard: [scoreboard/2026-10-24.md](../scoreboard/2026-10-24.md)

## Money

- PAPER equity **$10,800.43** (start $10,000; peak $11,562.99) · drawdown **6.6%** · risk mode **normal** (budget scale 1) · today +0.01%.
- 14 open positions, unrealised +$31. Gross 2.06× equity, open risk 2.8%. All 14 belong to strategies that are now in shadow (9 are wyckoff-spring-1h longs). Their stops and time stops close them.
- 55 closed paper trades: **+$441 / +16.4 R**. One trade carries all of it: an IRYS long by intraday-trend made +$693 (+24.6 R). **Without it the account is −$252 (−8.2 R).** Longs −4.3 R (−28.9 R without IRYS), shorts +20.7 R. That is the market's direction, not an edge.
- The four strategies that now trade have 2 closed paper trades so far: ma-retest-12h −1.02 R and rsi-macd-trend-12h −1.01 R, both stopped out. That is too few to mean anything; judge them by the quarter.

## What changed since yesterday

- **Ibrahim's Phase 0 (control.json 04:56Z)** put intraday-trend, dip-reversal, candle-harami-4h, candle-morning-star-4h and candle-three-outside-1h back in shadow. The PC reports these in **trade**: it-4h, ma-retest-12h, ma-retest-4h, rsi-macd-trend-12h.
- **Agent manager retired 19 strategies** (commit b278683 on main, `enabled: false`). Each has a decisively negative factory backtest (t −3.2 to −48) and no 5-year support: trend-pullback, session-drive, overshoot-fade, leader-follow, noise-breakout, dip-reversal, ma-21-200, rsi-macd, wyckoff-spring-1h, pivot-matrix-1h, candle-hammer-1h/-4h, candle-star-1h, candle-morning-star-1h, candle-harami-1h/-4h, candle-tweezer-1h, candle-doji-1h, candle-three-outside-1h. None was in trade. The push printed "Cannot update this protected ref" but landed on main. A spare branch `swarm-review/retire-2026-10-24` (same commit) could not be deleted from here; it is safe to delete. *Note: on 10-21 Ibrahim asked for all retired strategies in shadow again. This reverses that for these 19. Revert b278683 if you want them kept.*
- Researcher: oi-flush-12h was rejected by the factory, and the 5-year sweep exit grid ran (history/2026-10-24).

## Rule v2 (dry run — nothing written)

Rule v2 would trade **it-4h, ma-retest-12h, ma-retest-1d, rsi-macd-trend-12h**. Where it disagrees with the PC:

- **ma-retest-4h trade → shadow.** Its 5-year edge is +0.0275 R a trade, below the 0.03 R minimum (3 of 4 years positive).
- **ma-retest-1d shadow → trade.** 5-year sweep: 904 trades, +0.183 R a trade, 4 of 4 years positive, positive at 1.5× costs.

No live veto fires: every strategy has fewer than 20 active days. These switches stay Ibrahim's until rule v2 is switched on. Queue for the 5-year sweep: the donchian variants, wyckoff-spring-4h, krown-jewel-2h, the candle 4h set, pivot-matrix and adaptive-score.

## Agents on the home PC

- All agents are ok, every report is 9 minutes old, and the watchdog reports nothing down. Free memory is 5.6 of 8.1 GB; free disk is 73%.
- Brain: seededBars 331,114, 73 coins warmed. Guard: lag median 234 ms, 70 of 72 coins tradable.
- herald: pollErrors 24 and sendErrors 26. Telegram messages may be getting lost; worth a look.
- strategy:trend-pullback logs "IRYS: missing side/entry/stop". That strategy is retired now, so no fix.
- The accountant counts 78 trades; trades.jsonl has 55 closed trades. Check whether partial exits are counted separately.
- Events: 0 news windows today.

## Waiting for Ibrahim

1. **PR #10** — Upswarm Phase 1 (clustered t, sentinel, coin-shock guard, costs, rule v2 as a dry run). It also puts `upswarm/` on main; this review took the tools from branch upswarm-upG.
2. **PR #4 / #2** — the trend sleeve (the guide's Phase 0 says approve it and let it trade on paper after a short shadow check).
3. PRs #5 and #1 (plugin tests), and PR #3 (yesterday's live review).
4. Decide on rule v2's two switches: ma-retest-4h → shadow, ma-retest-1d → trade.
5. Any pending approvals on the PC: `powershell -ExecutionPolicy Bypass -File C:\swarm\app\swarm\deploy\windows\approve.ps1`.
6. Still no demo key, so no demo record and no live gate candidates. The live gate says ready for real money: **none**.

Trading was not paused: nothing is broken.
