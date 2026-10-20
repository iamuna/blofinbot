# Swarm — progress

Living log for the multi-agent 1–45 minute bot (branch `swarm`). Newest first. Times Europe/Amsterdam.
Design doc: "BloFin Swarm — multi-agent 1–45 min bot design" (claude.ai doc). The existing trend bot on `main` keeps running untouched.

## Now — resume here (updated 2026-10-20 12:45)

**Running: the 5-year sweep** (Ibrahim 10:56: "rethink timeframe selection, only the highest-ROI actions, test on
3–5 years"; his answers: **all timeframes 1m–1d**, rank by **return per risk, out-of-sample**). Code in `history/`
(README there), workflow `.github/workflows/swarm-history.yml`. First run 39398715406 built the data (one build
job failed on two coins with Chinese names — left out now; builds are resumable). **Current run 39409051537** on
commit aa7a325, started 12:40: data reused, sweep running.

| Stage | State | Output |
|---|---|---|
| plan (universe from Binance's archive) | done 11:14 — 668 coins ever in the top-80 ≥ $20M, 80 coins on almost every day, 18,593 coin-months (incl. 7 warm-up months per coin) | release `swarm-history-v1`: universe.json, plan.json |
| build (8 shards, 1m + OI + funding) | done 12:35 — 665 coins, 19.4 GB | release assets `<coin>.tar` (a rerun builds only missing coins) |
| sweep (10 jobs × 4 processes = 40 coin shards, 101 variants: 13 strategies × 1m…1d) | running since 12:42 (~1.5–2 h) | artifacts `sweep-<job>` (daily R per variant; trades for ≥ 30m) |
| select (walk-forward: 12-month window, top 5, quarterly — declared before the data) | waiting | branch `swarm-reports`: `history/<date>/REPORT.md`, `history/LATEST.md` |

- Check: `gh api repos/iamuna/blofinbot/actions/runs/39409051537/jobs --jq '.jobs[]|"\(.name) \(.status) \(.conclusion)"'`.
  Job logs are NOT readable from Claude's workspace (blob storage 403); release assets are:
  `gh api -H "Accept: application/octet-stream" repos/iamuna/blofinbot/releases/assets/<id>` (ids from
  `gh api repos/iamuna/blofinbot/releases/tags/swarm-history-v1`). data.binance.vision is not reachable from the
  workspace either — everything that needs it runs on GitHub.
- If a stage failed: fix under `history/` and push — that reruns everything, **and cancels a running sweep**
  (concurrency), so never push to `history/` while a good run is in progress. The data is reused when all 8
  manifests are in the release, unless `history/REBUILD` or `history/build.js` changed.
- Local test kit: a mock archive (`node -r <mock.js> history/build.js …`) was used in the session; sweep speed
  measured at ~10.5 s per coin-month for all 101 variants (one core).
- After the results: tell Ibrahim (honest walk-forward number vs. best-in-hindsight = luck gap); winners go into
  the live swarm in shadow — needs the winning timeframes in `swarm/src/analysis/features.js` TFS, longer brain
  warm-up for 4h/1d (protected code → Ibrahim runs approve.ps1), plugin `tfs`, and `config/swarm.json` strategies.
- Not done yet: per-signal ranking ("only the highest-ROI actions" inside a strategy) — after the sweep.

**Home PC (Windows, DESKTOP-4CJV8JF)**: running since 08:27 on paper, all agents OK (state on `swarm-state` every
10 min since 11:18): 72 coins, guard lag 0.7 s (the clock fix worked), recorder ~370 MB raw in 3 h (gzipped hourly,
kept 60 days), 8 shadow ideas so far, 0 paper trades (everything in shadow). /status works since the herald fix
f8a4a42 (Ibrahim approved and installed it by hand). Windows scripts need `powershell -ExecutionPolicy Bypass -File …`.

## Plan and status

| Day | Target | State |
|---|---|---|
| 1 | Message bus, BloFin + Binance feeds, universe, data guard, recorder | done; verified live on GitHub Actions (43 coins, all feeds) |
| 2 | Features, regime, event calendar, strategy kit (6 strategies in shadow), backtester | done; dataset (31 coins, 6.5 months of 1m + OI + funding) on branch swarm-data |
| 3 | Coordinator, fusion, allocator, risk (signed limits), execution (paper), trade manager, accountant | done (paper); hedger folded into the risk agent's BTC-exposure limit |
| 4 | Whole swarm on paper, Herald (Telegram), state sync, Ubuntu installer + tested updater | code done; CI runs the whole swarm on paper with a probe trade; installer fixed 2026-10-20 (it would have started no agents); waiting for the home PC — steps in docs/LAUNCH.md |
| 5 | BloFin demo trading | code done: demo trader with exchange-side stops, intent journal, reconcile by clientOrderId; tested against a fake BloFin; needs Ibrahim's demo key (`sudo swarm/deploy/enable-demo.sh`) |
| 6 | Researcher → builder → tester loop, reviewer report cards | done: factory tester (counts every try, incl. tries made outside it), promotion gate with an out-of-sample route, report cards; researcher and daily review run as scheduled Claude tasks (docs/CLAUDE_AGENTS.md) |
| 7 | Agent manager, restart/rollback drills; live gate per strategy | done: agent manager (self-service retirements, proposals), update gate (agent-written code installs itself only in the self-service area; the rest waits for `sudo swarm-approve`), signed authority messages, brain isolated as its own user, live gate; restart/rollback drill still to do on the home PC once it runs |

**Backtest verdict (docs/BACKTEST_2026-10-20.md): none of the six starting 1–45 minute strategies or 23 variants makes money after costs. First positive one (2026-10-20, docs/RESEARCH_LOG.md): squeeze-ride, +0.22 R over 104 trades — too few to pass the gate; in shadow as a "watch" strategy. Everything stays in shadow until its live record earns trade.**

## Decisions

- Universe (Ibrahim 2026-10-19: "minimum ~$20M, you decide"): Binance USD-M 7-day average ≥ $20M/day, listed on BloFin (crypto only), BloFin spread ≤ 5 bps; stays until < $14M or > 10 bps. Binance volume because all of BloFin trades ~$450M/day — a BloFin-only rule would leave 3 coins. 31 coins qualified on 2026-10-18 data.
- No npm dependencies (none reachable from the build machine; fewer moving parts on the home PC): own Redis client, Node 22 fetch/WebSocket.
- Binance futures WebSocket uses the `/market` route (legacy URLs stopped 2026-04-23). Binance REST blocks US servers (451) but its WebSocket works from GitHub Actions: there the universe falls back to Binance's public archive and the feed runs normally (open interest polling fails).

## Log

- 2026-10-20 11:10 — 5-year sweep built and launched (see "Now"). Universe: Binance archive daily volumes of every
  USDT perpetual, the live rules day by day, coins that later died kept (LUNA 230 days, FTT 21 days in it).
- 2026-10-20 09:20 — Ibrahim's retail strategies tested (plugins rsi-macd, harmonic, ma-21-200; not configured to
  run): RSI+MACD negative on every chart 5m–4h; harmonics best on 15m (−0.06 R) and 1h (+0.12 R on 100 trades);
  21/200 retest beats the cross (−0.11 vs −0.28 R on 15m) and turns slightly positive on 4h (+0.02 to +0.04 R).
  Trailing exits did not help. 38 tries logged (101 total, t bar 3.0). Details: docs/RESEARCH_LOG.md.
- 2026-10-20 08:20 — Windows install on Ibrahim's PC working. Fixed: herald /status (method name collided with the
  agent's status field; f8a4a42), Telegram chat id re-detection in the installer, clock 2 h off (time zone/NTP).
- 2026-10-20 07:00 — Research: event studies on open interest and funding (30 study cells, all counted as tries); built dip-reversal (fails once it has a stop: −0.12 R, t −10.6) and squeeze-ride (+0.22 R, t 2.8, 104 trades: positive but below the gate → shadow "watch"). Try log now complete: the 19 variant backtests run outside the factory were missing (bar was 2.50, should have been 2.73), now 63 tries → bar 2.90. Scheduled Claude agents: researcher daily 05:37, daily review 07:41 (Amsterdam). Launch steps for the home PC: docs/LAUNCH.md. 56 tests.
- 2026-10-20 06:30 — Day 7 safety work: installer bug fixed (GROUPS is a bash variable — the installer would have started `swarm@0` and none of the five groups); update gate (agent-written strategy code installs itself after tests; protected code waits for `sudo swarm-approve`; tests run as `nobody`); plugin check before loading; signed order/command/account messages; brain group as its own user without keys; coordinator no longer trusts the shared kv store for modes and allocator history; CI and factory keep the GitHub token away from strategy code. Out-of-sample promotion route, live gate, agent manager, try log.
- 2026-10-20 01:05 — Smoke run 39336995286 (whole swarm live on paper, 8 min): 40/40 coins, every agent OK, probe trade path end to end — 3 ideas → 3 risk approvals → 3 orders → 5 fills → 2 trades closed by time stop (−0.28 R, −0.26 R: taker fees + spread on a 0.5% stop), accountant matched. Day 5–6 code: demo trader (exchange-side stop via order-tpsl, reduce-only post-only target, stop moved new-first-then-cancel-old, orphan warnings), enable-demo.sh, accountant per account (demo equity from BloFin), factory gate/tester/promotion, review report cards, swarm-factory workflow, offline end-to-end test (bars → idea → risk → order → fill → exit → books). 45 tests.
- 2026-10-20 01:00 — Backtests: 6 strategies + noise-breakout + 23 variants on 31 coins × 6.5 months. All lose after costs; most lose before costs. Best: it-45-long +0.14 R (t 2.5) but best-of-29 and long-only in a universe that rose 80% on average (survivorship) — not trusted. Added it-45-long/hold16/hold32 and noise-breakout in shadow. Smoke run: 43 coins live, every feed OK, brain warm-up OK, guard lag measure fixed (ticker ts is last-trade time).
- 2026-10-20 00:30 — Day 3–4 code: fusion, allocator (quarter-Kelly, 0.25% start), risk engine with ladders and per-order caps, coordinator, paper trader (fills only through the price), accountant, Herald, watchdog, guardian (signed limits), state sync, installer (Redis, read-only code, systemd per group) and updater (tests before restart, rollback on bad health). 36 tests.
- 2026-10-20 00:10 — Day 2 code: features (1/3/5/15/30/45m), regime, strategy kit + 6 plugins, execution simulator, backtester, brain (minute batches BTC-first), event calendar. Dataset builder → swarm-data (Binance archive, checksummed).
- 2026-10-20 00:xx — Day 1 code: bus (Redis Streams with consumer groups + in-memory), schemas, agent base, keep-alive WebSocket, universe, BloFin feed, Binance feed, data guard, recorder, runner, smoke report, CI workflow. 15 offline tests pass (fake BloFin/Binance sockets and REST, real throwaway Redis incl. restart).
