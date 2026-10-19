# Swarm — multi-agent 1–45 minute bot for BloFin

A team of agents that trades BloFin USDT perpetuals on 1–45 minute horizons. Fast agents (code) handle data,
decisions and orders every minute; slow agents (Claude) research, build, test and review strategies and agents.
Every agent talks through one message bus. Design: the "BloFin Swarm" doc; status: [PROGRESS.md](PROGRESS.md).

**PAPER first.** No keys in this folder; demo and live come later, each behind its own gate.

## Run

Needs Node 22+ and (for production) Redis. No npm dependencies.

    cd swarm && npm test                                               # unit tests (uses redis-server if installed)
    node src/run.js --group market --bus memory --data-dir /tmp/sw --minutes 5   # market agents, one process
    node src/tools/smoke_report.js /tmp/sw                             # what they recorded

Production runs one process per agent group on the Redis bus (`--group market`, systemd units in `deploy/`).
Machine-specific settings go in `config/swarm.local.json` (merged over `config/swarm.json`, not in git).

## Layout

| Path | What |
|---|---|
| `src/core/` | message bus (Redis Streams + in-memory), message schemas, agent base, network helpers |
| `src/market/` | universe, BloFin feed, Binance feed, data guard, recorder |
| `src/tools/` | smoke report |
| `test/` | offline tests with fake exchanges and a throwaway Redis |
| `config/swarm.json` | every threshold, in one place |

## Messages (so far)

| Type | From | What |
|---|---|---|
| `uni.list` | universe | coins to trade: Binance 7-day average ≥ $20M/day, listed on BloFin, spread ≤ 5 bps (stays until < $14M or > 10 bps) |
| `md.trade` `md.book` `md.bar` `md.ticker` `md.funding` | blofin-feed | BloFin trades (batched), top-5 book (1/s), confirmed 1m bars, tickers, funding |
| `ref.flow` `ref.bar` `ref.liq` `ref.mark` `ref.oi` | binance-feed | Binance taker flow per second, 1m bars, liquidations, mark/funding, open interest |
| `guard.status` | guard | per coin: tradable?, Binance OK?, reasons |
| `sys.heartbeat` `sys.log` `sys.dead` | every agent / bus | health, warnings, messages a handler failed on |

Prices are in BloFin units and sizes in base units everywhere (contracts and Binance's 1000× symbols are converted at the edge).
