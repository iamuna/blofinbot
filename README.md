# blofinbot

A multi-agent trading system for BloFin USDT perpetuals — **the swarm**. PAPER account; the BloFin demo trader is
built and off; live money is not possible in this build.

**→ [swarm/INDEX.md](swarm/INDEX.md)** — the map: every agent, file, strategy, branch and test.

| | |
|---|---|
| Rules (who may change what) | [swarm/README.md](swarm/README.md) |
| Status and how to resume | [swarm/PROGRESS.md](swarm/PROGRESS.md), [swarm/HANDOFF.md](swarm/HANDOFF.md) |
| Install on the home PC | [swarm/docs/LAUNCH.md](swarm/docs/LAUNCH.md) |
| Research | [swarm/docs/RESEARCH_LOG.md](swarm/docs/RESEARCH_LOG.md), 5-year sweep in [history/](history/README.md) |
| What the scheduled Claude agents do | [swarm/docs/CLAUDE_AGENTS.md](swarm/docs/CLAUDE_AGENTS.md) |
| What the 1-minute bot adds (branch `possible-expansion`) | [expansion/README.md](expansion/README.md), [expansion/INDEX.md](expansion/INDEX.md) |

## Layout

    swarm/      the bot: agents, strategies, config, deploy scripts, tests, docs
    history/    the 5-year strategy × timeframe sweep (data in release swarm-history-v1)
    .github/    CI, factory, sweep and dataset workflows (none on a timer)

## History of this repo

Until 2026-10-23 the swarm lived on branch `swarm` and `main` held the earlier systems: a Python BTC 1-minute
research core (`btc_bot/`), a single-coin paper bot, and a 20-coin multi-timeframe trend bot (`lab/mtfbot.js`,
paused 2026-10-20) with its research, dashboards and BloFin demo broker. They are kept at tag
**`archive/trend-bot-2026-10-20`** (`git checkout archive/trend-bot-2026-10-20`). The trend bot's research is in
[swarm/docs/TREND_BOT_RESEARCH_2026-10-18.md](swarm/docs/TREND_BOT_RESEARCH_2026-10-18.md); its BloFin client lives
on in `swarm/src/exec/blofin/`, and one component of its strategy is the swarm's `donchian-trend` plugin.

Research and paper trading only. Not financial advice, not a claim of future profitability.
