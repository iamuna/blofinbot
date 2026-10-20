# Daily review — 2026-10-20 (run 05:42 UTC)

## Status
- **Home PC not running the swarm**: branch `swarm-state` does not exist. No live/paper equity, no drawdown, no shadow record, no fills. Report cards and live gate skipped (nothing to read).
- Account mode in `swarm/config/swarm.json`: `paper` (10,000 paper equity). Nothing trades anywhere.
- Open pull requests: none.

## Factory (swarm-factory LATEST.md, tested 2026-10-20 04:36 UTC, 31 coins, 2026-04-01 → 2026-10-18)
63 variants tried so far → t-stat bar 2.90. No strategy passes the backtest gate.

| Strategy | Trades | Avg R | t | Note |
|---|---|---|---|---|
| squeeze-ride | 104 | +0.218 | 2.80 | watch: positive in all thirds and at 1.5× costs; too few trades, below bar |
| it-45-long | 716 | +0.141 | 2.52 | below bar; middle third negative |
| it-45-hold32 | 1328 | +0.021 | 0.61 | weak |
| it-45-hold16 | 1264 | +0.015 | 0.52 | negative at 1.5× costs |
| crowd-squeeze | 26 | −0.089 | −0.33 | too few trades |
| intraday-trend | 7794 | −0.118 | −9.96 | decisively negative |
| trend-pullback | 11593 | −0.173 | −16.26 | decisively negative |
| session-drive | 917 | −0.173 | −5.01 | decisively negative |
| leader-follow | 1543 | −0.283 | −11.86 | decisively negative |
| noise-breakout | 32524 | −0.302 | −46.53 | decisively negative |
| overshoot-fade | 4700 | −0.353 | −14.20 | decisively negative |

## Agent manager — NOT applied this run
This session was not permitted to execute repository code (the sandbox's auto-mode classifier blocked `node swarm/src/tools/agent_manager.js` and `npm test`). Applying its rule (backtest n ≥ 300, avg R < 0, t ≤ −3, not trading, no positive 100+ trade shadow record) by reading `agent_manager.js` and the factory results by hand, it **would retire six strategies**:
intraday-trend, trend-pullback, session-drive, overshoot-fade, leader-follow, noise-breakout.

`swarm.json` was left unchanged because the required `npm test` could not be run before pushing. Since nothing is running, no harm comes from the delay; the next run with code execution allowed (or Ibrahim) should apply it.

No fix proposals (no state → no agent flags). No protected-agent changes; no swarm-fix branches.

## Central plan for today
- Risk mode / drawdown: n/a (not running). `control.json` not touched.
- News windows: not checked — the event calendar fetch was not permitted this run. The events agent on the home PC handles USD high-impact windows (5 min before, 10 min after) once it runs.
- Trading: no strategy in `trade`. All 11 enabled strategies are `shadow`; squeeze-ride is the one worth watching.

## Waiting for Ibrahim
1. Set up the home PC to run the swarm (Windows install steps in `swarm/docs/LAUNCH.md` on branch `swarm`) — until then there is no live evidence and nothing can be promoted.
2. Allow scheduled review runs to execute repo code (node / npm test), so the agent manager and tests can run; or apply the six retirements yourself.
3. Later: the BloFin demo key and any live decisions — none are due.
