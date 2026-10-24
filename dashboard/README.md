# Swarm Desk

A dashboard for the swarm, in one file: `index.html`. Double-click it (or drag it into any browser) on any computer
with internet; no install, no server, no key.

It reads what the home PC publishes to the `swarm-state` branch every 10 minutes (state.json, trades, shadow trades,
risk decisions) and `swarm/config/risk.json` from `main`, straight from raw.githubusercontent.com, and refreshes every
minute. It only reads: changing modes stays with Telegram (`/mode`, `/pause`, `/flatten`).

What it shows: alerts (PC silent for 25+ minutes, risk mode, limits, agents down, strategies in trade that lose in the
backtests), account dials, open positions with distance to the stop, the loss ladders against `risk.json`, every
strategy's paper and shadow record next to its 2020–2026 backtest verdict
([DEEP_REVIEW_2026-10-23.md](../swarm/docs/DEEP_REVIEW_2026-10-23.md)), cumulative shadow R of the strategies in trade,
risk decisions of the last 24 hours, closed paper trades and agent health.

The backtest verdicts are built into the page; rebuild it after a new deep review.
