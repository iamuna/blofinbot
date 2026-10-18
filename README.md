# blofinbot

Multi-coin, multi-timeframe research and paper-trading system for BloFin USDT perpetuals. **PAPER by default** — the BloFin DEMO broker exists but is switched off, runs only on your own PC with your demo key, and LIVE (real money) is not possible with this build.

**Status and how to resume work: [PROGRESS.md](PROGRESS.md).**

## What it does

Every minute, for each of the top-20 crypto perpetuals on BloFin (re-ranked weekly; tokenised stocks excluded):

| Timeframes | Role | Acts |
|---|---|---|
| 1m, 2m, 3m, 5m, 15m, 30m | **Execution**: post orders at the best price, re-post each minute, market after 30 min; mark positions; data checks | every minute / at each frame's close |
| 1h, 2h, 4h, 6h, 12h | **Setups**: add and cut long exposure between daily closes | at each frame's close |
| 1d, 3d, 1w, 1M, 3M | **Big picture**: direction and size per coin; the only source of shorts | at each frame's close |

Each coin's target = trend votes from many lookbacks per timeframe → sized to 25% annual volatility → tilted toward the strongest coins → portfolio scaled to 25% volatility. Every coin is profiled (volatility, BTC beta, which horizons trend or snap back, what fees cost per candle) before it trades. Hard risk limits: daily loss 5% blocks new risk; drawdown 15% halves risk; 25% goes flat and pauses.

Research behind it: [docs/RESEARCH_MTF_2026-10-18.md](docs/RESEARCH_MTF_2026-10-18.md). Backtest 2020–2026 after fees, slippage and funding: Sharpe 1.40 on the top-20; **0.86 on 30 coins it never saw (incl. LUNA, FTT, SRM, MATIC) — the realistic expectation.** Why not 100–200 trades a day: [docs/RESEARCH_HF_2026-10-18.md](docs/RESEARCH_HF_2026-10-18.md). Coin profiles: [docs/COIN_PROFILES.md](docs/COIN_PROFILES.md). Evidence review: [docs/MARKET_KNOWLEDGE.md](docs/MARKET_KNOWLEDGE.md).

## Where things run

| Piece | Where |
|---|---|
| 20-coin paper bot | `lab/mtfbot.js`, GitHub Actions `mtf-bot.yml`, state on branch `mtf-state` (`summary.md` = live status) |
| Engine | `lab/mtf/mtf.js` (signals, sizing, portfolio simulation — same code in research and live) |
| Research data | `tools/research_data.py` → branch `research-data` (weekly); validation coins → `validation-data` |
| BTC 1m history gap fill | `tools/fetch_binance_archive.py` → branch `history-data` (daily) |
| Dashboard | claude.ai artifact, synced hourly by the supervisor (`lab/sync_dashboard_mtf.js`) |
| Supervisor | Claude, hourly scheduled task, procedure in [docs/SUPERVISOR.md](docs/SUPERVISOR.md) |
| 24/7 home PC (optional) | `deploy/install-ubuntu.sh` (Ubuntu Server 24.04 LTS) runs the same bot under systemd |
| BloFin demo broker (off) | `lab/broker/` (signed client, restart-safe order intents, fake exchange + tests); switched on only by you with `deploy/enable-demo.sh` — [docs/DEMO_TRADING.md](docs/DEMO_TRADING.md) |

## Commands

    # offline replay on research data (no network)
    node lab/mtfbot.js run --state-dir /tmp/s --seed-dir <research-data checkout> --sim --minutes 600
    node lab/mtfbot.js report --state-dir /tmp/s

    # research
    node lab/mtf/profile.js <research-data> research_out/profiles
    node lab/mtf/study_v3.js <research-data> research_out/v3 [<validation-data>]
    node lab/mtf/execution_multi.js <research-data> research_out/execution

    # demo broker: offline tests and a replay against an in-process fake exchange
    node --test lab/broker/test/*.test.js
    node lab/mtfbot.js run --state-dir /tmp/d --seed-dir <research-data checkout> --sim --broker demo --fake-exchange --minutes 600

    # home PC
    curl -fsSL https://raw.githubusercontent.com/iamuna/blofinbot/main/deploy/install-ubuntu.sh | sudo bash

The earlier Python history/learning core (`btc_bot/`, `tools/`, `tests/`, `HANDOFF.md`, `AGENTS.md`) and the retired single-coin bot (`lab/paperbot.js`, `lab/engine.js`) remain for reference.

## Path to real money

Paper (now) → BloFin demo account with the same strategy and real post-only orders (built, tested offline, off — [docs/DEMO_TRADING.md](docs/DEMO_TRADING.md)) → small live — each step only after the previous one has enough trades to judge, with API keys kept on your own machine.

Research and paper trading only. Not financial advice, not a claim of future profitability.
