# Swarm — index

Everything in the swarm, where it lives and what it does. The swarm is a team of agents that trades BloFin USDT
perpetuals: fast agents (code, on the home PC) handle data, decisions and orders every minute; slow agents (Claude,
scheduled) research, test and review strategies. PAPER account. Code on branch `main` (until 2026-10-23: `swarm`).

**Start here:** [README.md](README.md) (rules: who may change what) → [PROGRESS.md](PROGRESS.md) (status: "Now" at the
top, the latest dated entries at the bottom) → [HANDOFF.md](HANDOFF.md) (the PC, Telegram, open items) → this index for the map.

## How a trade flows

```
 BloFin + Binance feeds ─► data guard ─► brain (features, regime, strategy plugins) ─► idea
                                                                                      │
   shadow: ExecSim simulates every idea ◄────────────────────────────────────────────┤
                                                                                      ▼  (only strategies in mode 'trade')
 coordinator: fusion (one intent per coin) → allocator (size from the strategy's record) → risk engine (hard limits)
                                                                                      │ signed 'order'
                                                                                      ▼
 trader (paper) / demo trader (BloFin demo) ─► exec.fill, positions, trade.closed ─► accountant ─► account
 ops: guardian (signed risk limits) · watchdog · herald (Telegram) · state-sync (GitHub branch swarm-state)
 sleeves: trend-sleeve ─► sleeve.target (weights; unsigned: a request) + sleeve.state (its shadow book under risk.json)
```

Every agent talks only through the message bus ([src/core/bus.js](src/core/bus.js); types in
[src/core/schemas.js](src/core/schemas.js)). Orders, commands and account messages are signed
([src/core/auth.js](src/core/auth.js)); strategy code runs away from the keys (Linux: own user; Windows: own
locked-down process, [src/core/isolate.js](src/core/isolate.js)).

## Agents

| Agent | File | Group | Does |
|---|---|---|---|
| universe | [src/market/universe.js](src/market/universe.js) | market | which coins: Binance 7-day volume ≥ $20M, listed on BloFin, spread ≤ 5 bps |
| blofin-feed | [src/market/blofin_feed.js](src/market/blofin_feed.js) | market | BloFin trades, top-5 book, 1m bars, tickers, funding |
| binance-feed | [src/market/binance_feed.js](src/market/binance_feed.js) | market | Binance taker flow, bars, liquidations, mark/funding, open interest |
| guard | [src/market/data_guard.js](src/market/data_guard.js) | market | per coin: is the data good enough to trade on |
| recorder | [src/market/recorder.js](src/market/recorder.js) | market | keeps every market message (gzipped hourly, 60 days) |
| events | [src/agents/event_calendar.js](src/agents/event_calendar.js) | brain | no-new-risk windows around scheduled news |
| brain | [src/agents/brain.js](src/agents/brain.js) | brain | features + regime + every strategy plugin; shadow-simulates every idea |
| trend-sleeve | [src/sleeve/agent.js](src/sleeve/agent.js) | brain | the retired trend bot's portfolio as a sleeve: hourly weights for the top 20, a shadow book under every risk.json limit (shadow only; [design](docs/TREND_SLEEVE_DESIGN.md)) |
| coordinator | [src/decision/coordinator.js](src/decision/coordinator.js) | decision | fusion → allocator → risk engine; loss ladders; strategy modes |
| trader | [src/exec/trader.js](src/exec/trader.js) / [src/exec/demo_trader.js](src/exec/demo_trader.js) | trader | paper broker / BloFin demo orders; stops, targets, trailing, time stops |
| accountant | [src/exec/accountant.js](src/exec/accountant.js) | trader | equity, drawdown, fees, funding; per-strategy results |
| guardian | [src/ops/guardian.js](src/ops/guardian.js) | ops | risk limits must match Ibrahim's signature, else flatten + halt |
| watchdog | [src/ops/watchdog.js](src/ops/watchdog.js) | ops | silent agents, disk, memory |
| herald | [src/ops/herald.js](src/ops/herald.js) | ops | Telegram: alerts, digests; /status /pause /resume /flatten /mode |
| state-sync | [src/ops/state_sync.js](src/ops/state_sync.js) | ops | publishes state to branch `swarm-state` every 10 min |

Started by [src/run.js](src/run.js) (`--group` / `--agents`, `--isolate brain`). Groups in
[config/swarm.json](config/swarm.json) → `groups`.

## Folder map

| Path | What |
|---|---|
| [config/swarm.json](config/swarm.json) | every threshold, the agent groups, every strategy and variant with its mode (`shadow` / `trade` / `off`) |
| [config/risk.json](config/risk.json) | hard risk limits — only Ibrahim changes them, then signs (`sign-risk.ps1` / `swarm-sign-risk`) |
| `src/core/` | bus (Redis Streams + in-memory), schemas, agent base, signed messages, isolated agents, network, Redis client |
| `src/market/` | universe, feeds, data guard, recorder |
| `src/analysis/` | [features.js](src/analysis/features.js) (1m → 1d bars + indicators), [regime.js](src/analysis/regime.js), [ta.js](src/analysis/ta.js) |
| `src/agents/` | brain, event calendar |
| `src/sleeve/` | the trend sleeve: [trend_engine.js](src/sleeve/trend_engine.js) (the archived engine, ported exactly), [sleeve.js](src/sleeve/sleeve.js) (risk.json on its weights, the book), [agent.js](src/sleeve/agent.js) |
| `src/strategies/` | strategy plugins (pure functions of bars; [kit.js](src/strategies/kit.js) = the interface, [index.js](src/strategies/index.js) = the list, [loader.js](src/strategies/loader.js) checks before loading) |
| `src/decision/` | coordinator, [fusion.js](src/decision/fusion.js), [allocator.js](src/decision/allocator.js) (quarter-Kelly), [risk.js](src/decision/risk.js) |
| `src/exec/` | paper trader, demo trader, accountant; `blofin/` = signed BloFin client + contract precision |
| `src/backtest/` | [exec_sim.js](src/backtest/exec_sim.js) (fills/exits for backtests and shadow; opt-in `breakevenR`), [run.js](src/backtest/run.js), [stats.js](src/backtest/stats.js) |
| `src/research/` | from the 1-minute bot (branch possible-expansion): [event_study.js](src/research/event_study.js) (MFE/MAE in R per idea + condition tags: does a signal point anywhere?), [excursions.js](src/research/excursions.js), [trade_tags.js](src/research/trade_tags.js), [streak_rules.js](src/research/streak_rules.js) |
| `src/factory/` | [plugin_check.js](src/factory/plugin_check.js), tester, promotion gate, live gate, try log, [tuner.js](src/factory/tuner.js) (challengers inside `bounds`) |
| `src/ops/` | guardian, watchdog, herald, state sync |
| `src/tools/` | [update_gate.js](src/tools/update_gate.js) (what installs itself vs. waits for Ibrahim), review, agent manager, smoke report |
| `deploy/windows/` | the home PC: [install.ps1](deploy/windows/install.ps1), [run.ps1](deploy/windows/run.ps1) (runner + updater), [approve.ps1](deploy/windows/approve.ps1), enable-demo, sign-risk, uninstall |
| `deploy/` | the same for Ubuntu (systemd, one process per group, Redis) |
| `factory/` | strategy candidates for the factory tester (JSON) |
| [tools/build_dataset.js](tools/build_dataset.js) | the 6.5-month backtest dataset → branch `swarm-data` |
| [tools/trend_sleeve_backtest.js](tools/trend_sleeve_backtest.js) | the trend sleeve on research-data / validation-data, 2020–2026 |
| [tools/import_binance_1m.js](tools/import_binance_1m.js) | a Binance 1m kline ZIP (e.g. the 1-minute bot's BTC spot 2017–2025) → the same layout |
| [../history/](../history/README.md) | the 5-year sweep: build data (release `swarm-history-v1`), every strategy × timeframe, walk-forward selection |
| `test/` | offline tests with fake exchanges (`npm test`); they need Ibrahim's OK to install on the PC |
| `docs/` | research log, backtests, launch steps, the Claude agents' jobs, the retired trend bot's research |

## Strategies

All start in shadow; trade mode is Ibrahim's call (`/mode <name> trade`). Evidence from
[docs/RESEARCH_LOG.md](docs/RESEARCH_LOG.md) (6.5-month factory, 31 coins) and the 5-year sweep (swarm-reports
`history/2026-10-20/REPORT.md`, 665 coins, dead ones included). R = result per unit risked, after costs.

| Plugin | File | Idea | Evidence so far |
|---|---|---|---|
| ma-21-200 | [ma_21_200.js](src/strategies/ma_21_200.js) | 21/200 EMA cross / retest / pullback | **retest @12h: best of the sweep, +0.14 R, Sharpe 1.33, positive every year** (mostly shorts); @1d Sharpe 0.96 |
| intraday-trend | [intraday_trend.js](src/strategies/intraday_trend.js) | volume-confirmed breakouts | 1–45m lose; @4h +0.06 R, Sharpe 0.72 |
| rsi-macd | [rsi_macd.js](src/strategies/rsi_macd.js) | RSI + MACD | reversal: no edge anywhere; trend @12h +0.09 R (sweep), +0.30 R (factory) |
| trend-pullback | [trend_pullback.js](src/strategies/trend_pullback.js) | buy dips in a clear trend | best on 1h (Sharpe 0.51); loses below 1h |
| trend sleeve (not a plugin) | [src/sleeve/](src/sleeve/) | the whole trend-bot portfolio: 34 Donchian states 1h→3M, vol-targeted, momentum-tilted, rebalanced | under risk.json 2020–2026: **Sharpe 1.10 top-20, 0.84 on 30 unseen coins** (research engine 1.20 / 0.86); shadow since 2026-10-23 ([backtest](docs/BACKTEST_TREND_SLEEVE_2026-10-23.md)) |
| donchian-trend | [donchian_trend.js](src/strategies/donchian_trend.js) | close beyond the N-bar channel, trailing midpoint stop | new 2026-10-23, from the retired trend bot (its ensemble: Sharpe 1.40, 0.86 on unseen coins); sweep groups `donchian-*` |
| funding-fade | [funding_fade.js](src/strategies/funding_fade.js) | fade a crowd paying high funding for 3 days | under test (sweep group `funding-fade`); runs live as `funding-fade-4h` |
| squeeze-ride | [squeeze_ride.js](src/strategies/squeeze_ride.js) | 15m jump while open interest falls | +0.22 R on 104 trades: "watch" |
| harmonic | [harmonic.js](src/strategies/harmonic.js) | Gartley / Bat / Butterfly / Crab | no edge after costs |
| krown-jewel | [krown_jewel.js](src/strategies/krown_jewel.js) | EMA 21/55/200 + stochastic RSI | no edge (1h −0.07 R) |
| wyckoff-spring | [wyckoff_spring.js](src/strategies/wyckoff_spring.js) | spring / upthrust + test | 1h −0.13 R; 4h +0.01 R |
| candles | [candles.js](src/strategies/candles.js) | 14 candlestick families | 23 of 28 lose; every 1h version loses |
| session-drive, overshoot-fade, leader-follow, crowd-squeeze, noise-breakout | `src/strategies/` | the starting 1–45 minute set | all lose after costs |
| dip-reversal | [dip_reversal.js](src/strategies/dip_reversal.js) | buy an outsized 15m drop | fails once it has a stop (−0.12 R) |
| adaptive-score | [adaptive_score.js](src/strategies/adaptive_score.js) | the 1-minute bot's trend + momentum score, 4h–1d | `adaptive-score-12h` shadow (watch), 4h off: flat on 2021–26 (t < 0.7), +0.11 / +0.19 R at t 5 on 2018–21 ([../expansion/RESULTS_2026-10-23.md](../expansion/RESULTS_2026-10-23.md)) |
| probe | [probe.js](src/strategies/probe.js) | CI only: exercises the trade path | — |

The lesson across all of it: below 1h, costs eat every edge we found; the slow (12h–1d) edges are mostly short.

## Branches and data

| Branch / place | What | Written by |
|---|---|---|
| `main` | the code (this folder, `history/`, workflows) | people + scheduled Claude agents |
| `swarm` | old name of the code branch; kept as a mirror of `main` until the home PC follows `main`, then deleted | — |
| `swarm-state` | live state from the PC every 10 min (state.json, summary.md, trades, shadow trades) | the PC (state-sync) |
| `swarm-data` | 6.5 months × 31 coins of 1m bars, open interest, funding | workflow `swarm-data.yml` |
| `swarm-factory` | tester results, try log (`trials.jsonl`), promotion decisions | workflow `swarm-factory.yml` |
| `swarm-reports` | smoke-run reports, 5-year sweep reports, era-test reports (`era/`) | workflows `swarm-ci.yml`, `swarm-history.yml`, `swarm-era.yml` |
| release `swarm-history-v1` | 5 years × 665 coins of 1m data (19.4 GB) | workflow `swarm-history.yml` |
| `research-data`, `validation-data`, `history-data` | the retired trend bot's data (1h bars 2020–2026, BTC 1m) — needed to port its full portfolio | (no longer updated) |
| tags `archive/*` | the retired code and its state branches: `archive/trend-bot-2026-10-20` (Python core, trend bot, dashboards, its research) | — |

Workflows ([../.github/workflows/](../.github/workflows)): `swarm-ci` (tests + live smoke run, Linux and Windows),
`swarm-factory` (tester + promotion gate), `swarm-history` (5-year sweep), `swarm-data` (dataset), `swarm-era` (slow
strategies on Binance spot 2017–2021, by hand: [../expansion/RESULTS_2026-10-23.md](../expansion/RESULTS_2026-10-23.md)). None run on a timer.

## Tests

`cd swarm && npm test` — Node 22.13+. Redis tests skip without `redis-server`.

| File | Covers |
|---|---|
| bus, e2e | bus semantics (memory + Redis), the whole path bars → idea → risk → order → fill → books |
| decision_exec | fusion, allocator, risk engine, coordinator (in-flight orders, ladders, resume), paper trader |
| demo_trader (+ fake_exchange, fake_blofin_plus) | demo trader against a fake BloFin: intents, reconcile, exchange-side stops, restarts |
| security, isolate | plugin check, update gate, signed messages, the isolated brain's lock-down |
| ops | herald (commands, /mode), watchdog, guardian, state sync |
| feeds, guard_recorder, universe | feeds with fake sockets, data guard, recorder, universe rules |
| brain, strategy_engine, *strategies*, donchian_trend, funding_fade | features, regime, every plugin |
| trend_sleeve | the ported engine (exactness), risk.json on its weights (fuzz), ladders, stops, the shadow agent with a fake BloFin |
| factory | tester, gate, promotion |
| expansion | adaptive-score, ExecSim break-even, excursions, tags, streak replay, tuner, importer |
