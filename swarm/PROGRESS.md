# Swarm — progress

Living log for the multi-agent 1–45 minute bot (branch `swarm`). Newest first. Times Europe/Amsterdam.
Design doc: "BloFin Swarm — multi-agent 1–45 min bot design" (claude.ai doc). The existing trend bot on `main` keeps running untouched.

## Plan and status

| Day | Target | State |
|---|---|---|
| 1 | Message bus, BloFin + Binance feeds, universe, data guard, recorder | code + tests done; live smoke run on GitHub Actions |
| 2 | Features, regime, event calendar, strategy kit (6 strategies in shadow), backtester | — |
| 3 | Coordinator, fusion, allocator, risk (signed limits), hedger, execution (paper + demo), trade manager, accountant | — |
| 4 | Whole swarm on paper, Herald (Telegram), dashboard, Ubuntu installer; gate: 24 h on paper | — |
| 5 | BloFin demo trading at 0.25% risk | — |
| 6 | Researcher → builder → tester loop, reviewer report cards | — |
| 7 | Agent manager, guardian, restart/rollback drills; live gate per strategy | — |

## Decisions

- Universe (Ibrahim 2026-10-19: "minimum ~$20M, you decide"): Binance USD-M 7-day average ≥ $20M/day, listed on BloFin (crypto only), BloFin spread ≤ 5 bps; stays until < $14M or > 10 bps. Binance volume because all of BloFin trades ~$450M/day — a BloFin-only rule would leave 3 coins. 31 coins qualified on 2026-10-18 data.
- No npm dependencies (none reachable from the build machine; fewer moving parts on the home PC): own Redis client, Node 22 fetch/WebSocket.
- Binance futures WebSocket uses the `/market` route (legacy URLs stopped 2026-04-23). Binance blocks US servers: on GitHub Actions the universe uses Binance's public archive instead and the Binance feed reports itself degraded.

## Log

- 2026-10-20 00:xx — Day 1 code: bus (Redis Streams with consumer groups + in-memory), schemas, agent base, keep-alive WebSocket, universe, BloFin feed, Binance feed, data guard, recorder, runner, smoke report, CI workflow. 15 offline tests pass (fake BloFin/Binance sockets and REST, real throwaway Redis incl. restart).
