# PROGRESS — multi-coin, multi-timeframe bot

Living log so work can resume if a session is lost. Newest status at the top of each section. Times are Europe/Amsterdam.

## Goal (Ibrahim, 2026-10-18 04:53)

Research the most robust, dynamic strategy possible: understand price action first (web + data), analyse every trading pair before trading it, build each pair's plan around its behaviour, and decide the best action on every timeframe at its own cadence — 1m every minute, 2m every 2 minutes, 3m every 3 … up to 3 months. Hardware: Windows PC (Ryzen 7 2700X, RTX 2070 Super) for research/ML; small 24/7 PC (Ubuntu Server 24.04 LTS recommended) for the live bot.

Decisions (his answers): **top 20 BloFin USDT perps**; timeframe design left to Claude; **paper → BloFin demo → small live**, each step only after the previous proves out; 24/7 PC OS: whatever is needed.

## Design (decided 2026-10-18)

- Every timeframe (1m, 2m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 3d, 1w, 1M, 3M) is evaluated at its own candle close.
- Layers: **big picture 1d→3M** (direction, regime, risk budget per coin) · **setups 1h→12h** (trade ideas) · **execution 1m→30m** (limit-order entry timing, exits every minute).
- Target-position style: each coin has a volatility-targeted target size from the trend ensemble; changes are traded only past a hysteresis band (controls fees).
- Every component must improve out-of-sample results to keep its vote (walk-forward, other eras, 2× fees).
- Evidence base: docs/MARKET_KNOWLEDGE.md.

## Status

| Step | State | Where |
|---|---|---|
| 1. Evidence review (web) | done 05:00 | docs/MARKET_KNOWLEDGE.md |
| 2. Top-20 universe + history (GitHub runner) | running — pipeline pushed 05:02 | tools/research_data.py, .github/workflows/research-data.yml → branch `research-data` |
| 3. Coin profiler | next | lab/research/ (planned: profile.js) |
| 4. Multi-timeframe portfolio engine | pending | lab/ (planned: mtf.js) |
| 5. Walk-forward validation | pending | docs/RESEARCH_MTF_*.md |
| 6. Multi-coin paper bot + Ubuntu installer | pending | lab/, deploy/ |

## Log

- 05:03 — Ibrahim asked to keep working, save to GitHub and keep this progress file updated each step.
- 05:02 — Pushed research-data pipeline (top-20 by BloFin 24h volume; Binance archive 1h full history, 5m 24 months, funding; checksums; gaps reported).
- 05:00 — Evidence review written: trend ensembles (days→months) are the strongest documented edge; cross-sectional momentum in large coins; minute-scale mean reversion real but below fees (matches our own 60k-config test); session effects; funding as crowding/cost; volatility targeting.
- 04:31 — High-frequency research: 100–200 trades/day on BTC does not survive costs (docs/RESEARCH_HF_2026-10-18.md).
- 04:05 — Paper bot live on GitHub Actions (BloFin feed), dashboard artifact, hourly supervisor scheduled task (:50 Amsterdam).

## Where things are

- Repo: github.com/iamuna/blofinbot (main = code, `paper-state` = live paper bot state, `history-data` = BTC 1m gap fill, `research-data` = top-20 dataset).
- Dashboard: https://claude.ai/artifact/DCr9QM1eNB8E2ULUU2VrwB (synced hourly by the supervisor).
- Supervisor procedure: docs/SUPERVISOR.md. Research: docs/RESEARCH_*.md.

## How to resume

1. `git clone https://github.com/iamuna/blofinbot` and read this file top to bottom.
2. Check `research-data` branch for `manifest.json` (dataset status).
3. Continue at the first step not marked done; update the Status table and Log, commit, push after each step.
