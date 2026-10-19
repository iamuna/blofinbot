# Swarm — progress

Living log for the multi-agent 1–45 minute bot (branch `swarm`). Newest first. Times Europe/Amsterdam.
Design doc: "BloFin Swarm — multi-agent 1–45 min bot design" (claude.ai doc). The existing trend bot on `main` keeps running untouched.

## Plan and status

| Day | Target | State |
|---|---|---|
| 1 | Message bus, BloFin + Binance feeds, universe, data guard, recorder | done; verified live on GitHub Actions (43 coins, all feeds) |
| 2 | Features, regime, event calendar, strategy kit (6 strategies in shadow), backtester | done; dataset (31 coins, 6.5 months of 1m + OI + funding) on branch swarm-data |
| 3 | Coordinator, fusion, allocator, risk (signed limits), execution (paper), trade manager, accountant | done (paper); hedger folded into the risk agent's BTC-exposure limit |
| 4 | Whole swarm on paper, Herald (Telegram), state sync, Ubuntu installer + tested updater | code done; CI runs the whole swarm on paper with a probe trade; waiting for the home PC |
| 5 | BloFin demo trading | code done: demo trader with exchange-side stops, intent journal, reconcile by clientOrderId; tested against a fake BloFin; needs Ibrahim's demo key (`sudo swarm/deploy/enable-demo.sh`) |
| 6 | Researcher → builder → tester loop, reviewer report cards | code done: factory tester (counts every try), promotion gate (backtest + shadow evidence → control.json, paper/demo only), report cards; next: scheduled Claude agents |
| 7 | Agent manager, restart/rollback drills; live gate per strategy | — |

**Backtest verdict (docs/BACKTEST_2026-10-20.md): none of the 1–45 minute strategies or 23 variants makes money after costs; all stay in shadow.**

## Decisions

- Universe (Ibrahim 2026-10-19: "minimum ~$20M, you decide"): Binance USD-M 7-day average ≥ $20M/day, listed on BloFin (crypto only), BloFin spread ≤ 5 bps; stays until < $14M or > 10 bps. Binance volume because all of BloFin trades ~$450M/day — a BloFin-only rule would leave 3 coins. 31 coins qualified on 2026-10-18 data.
- No npm dependencies (none reachable from the build machine; fewer moving parts on the home PC): own Redis client, Node 22 fetch/WebSocket.
- Binance futures WebSocket uses the `/market` route (legacy URLs stopped 2026-04-23). Binance REST blocks US servers (451) but its WebSocket works from GitHub Actions: there the universe falls back to Binance's public archive and the feed runs normally (open interest polling fails).

## Log

- 2026-10-20 01:05 — Smoke run 39336995286 (whole swarm live on paper, 8 min): 40/40 coins, every agent OK, probe trade path end to end — 3 ideas → 3 risk approvals → 3 orders → 5 fills → 2 trades closed by time stop (−0.28 R, −0.26 R: taker fees + spread on a 0.5% stop), accountant matched. Day 5–6 code: demo trader (exchange-side stop via order-tpsl, reduce-only post-only target, stop moved new-first-then-cancel-old, orphan warnings), enable-demo.sh, accountant per account (demo equity from BloFin), factory gate/tester/promotion, review report cards, swarm-factory workflow, offline end-to-end test (bars → idea → risk → order → fill → exit → books). 45 tests.
- 2026-10-20 01:00 — Backtests: 6 strategies + noise-breakout + 23 variants on 31 coins × 6.5 months. All lose after costs; most lose before costs. Best: it-45-long +0.14 R (t 2.5) but best-of-29 and long-only in a universe that rose 80% on average (survivorship) — not trusted. Added it-45-long/hold16/hold32 and noise-breakout in shadow. Smoke run: 43 coins live, every feed OK, brain warm-up OK, guard lag measure fixed (ticker ts is last-trade time).
- 2026-10-20 00:30 — Day 3–4 code: fusion, allocator (quarter-Kelly, 0.25% start), risk engine with ladders and per-order caps, coordinator, paper trader (fills only through the price), accountant, Herald, watchdog, guardian (signed limits), state sync, installer (Redis, read-only code, systemd per group) and updater (tests before restart, rollback on bad health). 36 tests.
- 2026-10-20 00:10 — Day 2 code: features (1/3/5/15/30/45m), regime, strategy kit + 6 plugins, execution simulator, backtester, brain (minute batches BTC-first), event calendar. Dataset builder → swarm-data (Binance archive, checksummed).
- 2026-10-20 00:xx — Day 1 code: bus (Redis Streams with consumer groups + in-memory), schemas, agent base, keep-alive WebSocket, universe, BloFin feed, Binance feed, data guard, recorder, runner, smoke report, CI workflow. 15 offline tests pass (fake BloFin/Binance sockets and REST, real throwaway Redis incl. restart).
