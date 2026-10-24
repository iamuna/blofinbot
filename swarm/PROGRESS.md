# Swarm — progress

Living log for the multi-agent 1–45 minute bot (branch `swarm`). Newest first. Times Europe/Amsterdam.
Design doc: "BloFin Swarm — multi-agent 1–45 min bot design" (claude.ai doc). The existing trend bot on `main` keeps running untouched.

## Now — resume here (updated 2026-10-20 15:50)

**5-year sweep done** (rerun 39419701055 with the R fix, commit 4bb2d22). Results: `swarm-reports`
history/2026-10-20/REPORT.md and docs/RESEARCH_LOG.md (15:45 entry). Short version: 1m–30m lose everywhere; edges only
on 1h–1d; walk-forward picker Sharpe 0.49 (not significant); best single ma-retest@12h, Sharpe 1.33, positive every
year, mostly from shorts. Code: `history/` (README). Data stays in release `swarm-history-v1` (19.4 GB, 665 coins);
sweep artifacts kept 90 days (not downloadable from Claude's workspace — the report and results.json are).

**Ibrahim approved (18:01) → commit 956ae84 pushed 18:10**: live features 1h/2h/4h/12h/1d, seeded at start-up from
BloFin (1h, 2h, 4h bars; 12h and 1d built from 4h in UTC; brain metric `seededBars`), plugins ma-21-200 and rsi-macd
start from that history, `onlyTfs` sets a variant's timeframes, R against ≥ 10 bps of risk (exec_sim, paper and
demo trader). Shadow now: ma-retest-12h, ma-retest-1d, it-4h, rsi-macd-trend-12h, trend-pullback-1h; every
1–45 minute strategy disabled (5-year sweep). Protected → on the PC: Telegram asks, Ibrahim runs
`powershell -ExecutionPolicy Bypass -File C:\swarm\app\swarm\deploy\windows\approve.ps1`, installed within 10 min.
Check after: swarm-state agents.brain.metrics.seededBars > 0, strategy:ma-retest-12h etc. present. Scheduled
researcher and daily review prompts updated for the new timeframes (18:08).

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

- 2026-10-24 (branch `new-strats`) — Deep review, second run ([docs/DEEP_REVIEW_2026-10-24.md](docs/DEEP_REVIEW_2026-10-24.md)): the robust trend set and the golden-zone variants hold; orb-retest has no edge even before costs (fixed a zone-finder bug first, v2); donchian-1d-60/-150 shorts lose in all three samples; it-45-long is the only sub-hour variant that makes money (longs only, not proven). New tool: tools/subhour_backtest.js. Applied on Ibrahim's OK: orb-retest off, donchian-1d-60/-150 long only (config), it-45-long back to shadow on the PC (control.json on swarm-state).
- 2026-10-24 07:45 — Daily review: agent manager retired 19 strategies with decisively negative backtests (b278683; list in swarm-reports daily/2026-10-24.md). Trade now: it-4h, ma-retest-12h, ma-retest-4h, rsi-macd-trend-12h (Ibrahim's Phase 0). Rule v2 dry run disagrees on two: ma-retest-4h → shadow (edge 0.0275 < 0.03 R), ma-retest-1d → trade. Paper +$441, but −$252 without the one IRYS trade; drawdown 6.6%.
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

## 2026-10-21 (night) — more strategies, all in shadow
- Every retired strategy enabled again in shadow (Ibrahim). Note: `/mode x shadow` on a strategy disabled in config only changes the listed mode — the brain never loads it.
- New plugins: `krown-jewel` (Krown-style EMA 21/55/200 + stochastic RSI; 1h, 2h), `wyckoff-spring` (Mitch Ray TA's spring + test, 3:1; 1h, 4h), `candles` (14 Japanese candlestick families, one variant each on 1h and 4h: `candle-<family>-<1h|4h>`).
- `/status` shows shadow results per strategy (all time + 24 h), seeded from state-repo/shadow.jsonl.
- Not yet run through the 5-year sweep: add them to history/sweep.js GROUPS to test.
- `/status` (99c031e): per-strategy shadow/paper stats (trades, win %, total/avg/best/worst R, 24 h), only running strategies listed, long reports split. Approved by Ibrahim 05:02; confirm it runs (66 agents ok expected).
- Open next: shadow results need days on 1h/4h; then add the new plugins (krown-jewel, wyckoff-spring, candles) to history/sweep.js GROUPS for the 5-year test; dragon (W) pattern was offered, not built.

## 2026-10-24 — upswarm Phase 0 and Phase 1 (upswarm/GUIDE.md §12)
- Phase 0 (Ibrahim: "do as the guide says"): the last five strategies with negative backtests still in trade
  (intraday-trend, dip-reversal, candle-morning-star-4h, candle-harami-4h, candle-three-outside-1h) → shadow through
  control.json on swarm-state; trading now: it-4h, ma-retest-12h, ma-retest-4h, rsi-macd-trend-12h (rule v2). PR #4
  (trend sleeve, in shadow) and this Phase 1 PR merged on Ibrahim's OK in chat (08:50); both are protected, so the PC
  installs them after approve.ps1. Sleeve: 2 weeks of shadow tracking, then `/mode sleeve:trend trade`.
- Phase 1 (branch swarm-fix/upswarm-phase1, protected → pull request): t-stats clustered by day in the gate, the
  backtest rows (`tDay`), the report cards and /status (which no longer ranks strategies by total R); sentinel in the
  coordinator (target > 0, stop ≤ 25% away and ≥ 2× the round-trip cost, coin listed ≥ 30 days); coin-shock rule in
  the data guard; execution-cost tracker (`exec.cost`, kv `execCost`, swarm-state costs.jsonl); promotion rule v2
  (src/factory/promote_v2.js) replaces the old gate in the factory workflow as a dry run (report in swarm-factory
  PROMOTION.md, no control.json). The guide, its tools and results come to main in `upswarm/`.
- Rule v2 on the newest sweep (2026-10-23) differs from the guide's run (2026-10-20) on one strategy: ma-retest-4h
  now averages +0.0275 R a trade, just under the +0.03 minimum edge (era test 2018–21 +0.125 R). It stays in trade
  (Ibrahim's Phase 0 choice); the dry-run report shows it as shadow until he decides.

## 2026-10-23 (morning) — safety fixes from a code review (protected: needs approve.ps1, then a runner restart)
- Update gate: tests are no longer self-service. The PC runs every test before it installs, and a test file is any
  code at all, so a push touching only `swarm/test/` could run code on the PC with the tokens in reach. Factory and
  docs are narrowed to `factory/candidates/*.json` and `*.md`. Windows runner: the tests run without the tokens and
  keys in their environment.
- Brain isolated on Windows (`--isolate brain`, src/core/isolate.js): its own Node process under Node's permission
  model (reads only swarm/src; no secrets.json, bus.key, blofin-demo.json, config or data folder; cannot start
  programs or threads; no tokens in its environment). The bridge forwards only idea/feat.bar/regime.state/shadow.*/
  heartbeat/log under its own name, kv write only `betas`. It checks its own lock-down first and does not start
  without it (needs Node 22.13+; the installer now upgrades older Node). Before this, every plugin ran in the one
  process that holds the tokens and the bus key; the README's "own user" was true only on Linux.
- Coordinator: orders in flight count in every risk check. All ideas of one bar close were checked against the same
  portfolio, so dozens of 1h/4h ideas could each pass the open-risk / gross / BTC-exposure caps that only fit one of
  them (seen live: 22 longs ≈ 4× equity with a 2× BTC-exposure cap). Test reproduces it ($75 risked with $40 room).
- Herald `/mode`: only names that exist (configured or reported by the brain), with a "did you mean"; `/mode <typo>
  off` removes a typo from the list (`candel-harami-4h` is listed in trade mode today: send `/mode candel-harami-4h off`).
- Installers (Windows and Linux): the Telegram chat is linked by a one-time code sent from a private chat, not "the
  last chat that messaged the bot" (anyone can message a bot).
- Runner: an update that changes run.ps1 restarts the runner itself (rollback still armed). This update is the first
  one with that code, so the running runner must be restarted once by hand after it installs: run the installer
  again (Terminal as Admin) — `irm https://raw.githubusercontent.com/iamuna/blofinbot/swarm/swarm/deploy/windows/install.ps1 | iex`
  — it keeps the tokens and chat. Check after: /status lists `brain-host` ok and the strategies report again.

## 2026-10-23 (morning) — the swarm is `main`; repo consolidated
- Branch: the swarm's code is on `main` now (main = swarm + main's last 2 commits). `swarm` stays as a mirror until
  the PC follows `main`, then it is deleted. PC scripts, installers (Windows + Linux) and the four swarm workflows
  default to `main`; every fetch names its branch explicitly, because the PC's clone was made single-branch for
  `swarm`. Switch-over on the PC: approve the update as usual, then run the installer again (it moves the clone to
  `main`). The scheduled Claude agents (researcher, daily review) must push to `main` from now on.
- Retired code removed from `main`, kept at tag `archive/trend-bot-2026-10-20`: Python BTC core (btc_bot/, tools/,
  tests/), single-coin and 20-coin trend bots (lab/), dashboards, research outputs, root docs, their 6 workflows
  (the 30-minute trend-bot schedule was only paused in the Actions settings; the file is gone now). The BloFin
  client the demo trader needs moved to `src/exec/blofin/` (keyProblem with it); the fake exchange to `test/`. Kept
  in `docs/`: the trend bot's research (TREND_BOT_RESEARCH) and the high-frequency study.
- Branches: swarm-history-fix, swarm-no-heap-cap, swarm-status-report (fully merged), paper-state, mtf-state
  (retired bots' state) deleted, each kept as tag `archive/<name>`.
- [INDEX.md](INDEX.md): map of every agent, file, strategy, branch and test.
- New plugin `donchian-trend` (shadow): one component of the retired trend bot's ensemble — the best-evidenced
  strategy in the repo (Sharpe 1.40 top-20 2020–2026 after costs, 0.86 on 30 unseen coins). Variants donchian-1d-20,
  -1d-60, -1d-150 (long + short), donchian-12h-60 (long only); sweep groups donchian-20/-60/-150 @12h/@1d. The
  full portfolio (vol targeting, cross-coin momentum, rebalancing) is the next piece of work.
- Found: `funding-fade` never ran live (its default listens on 45m bars; tf 240 needs onlyTfs). Now runs as
  `funding-fade-4h` (shadow); the base entry is off.

## 2026-10-23 (evening) — strategies from Mitch Ray TA's videos; the golden-zone retest (branch `new-strats`)
- Ibrahim sent 4 videos (Fibonacci, swing-trading "cake-baking", bearish AB=CD, "trade effectively"). Built as
  plugins: `mixing-bowl`, `fib-golden`, `abcd`, `wedge-break`; and `ma-retest-plus` = ma-21-200's retest with his
  checks as switches. Hourly harness of the deep review now in the repo (`tools/hourly_backtest.js`), study script
  `tools/video_research.js`. Write-up: docs/VIDEO_STRATEGIES_2026-10-23.md.
- Result: the video methods alone have no edge (like every reversal / pattern family). His golden-zone rule as a
  filter on the 4h retest (pull-back ≥ 38.2% of the impulse) doubles avg R in all three samples: `ma-retest-4h-golden`
  +0.139 / +0.189 / +0.111 R (t 2.3 / 3.0 / 2.7), pooled t 3.73, max DD 47 R vs 127 R; the robust-five book's
  Sharpe 0.99/0.98/1.41 → 1.19/1.34/1.50. In config as shadow (+ two 12h / 1d watches); the four video plugins off.
  38 tries → ~439 total, t bar 3.32.
- Open: merge `new-strats` into `main` (Ibrahim's call); then compare `ma-retest-4h-golden` with `ma-retest-4h` in
  shadow and trade one of them, not both. Tests/tools need approve.ps1 on the PC; plugins, config and docs install themselves.

