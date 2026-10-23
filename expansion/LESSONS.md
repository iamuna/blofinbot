# Lessons and data facts from the 1-minute bot

Taken from iamuna/1-min-blofin-bot (`main` code, `handoff-ready` docs: HANDOFF.md, LESSONS_FROM_BOT_AND_RESEARCH.md,
BLOFIN_EXECUTION_SPEC.md, VALIDATION_AND_NEXT_STEPS.md, AGENTS.md), dated 2026-09-20. Kept here so they survive if that
repo is deleted. Each is checked against what the swarm does today.

## The data it had

| Fact | Value |
|---|---|
| Source | Binance **spot** BTCUSDT 1-minute klines, ZIP `BTCUSD_1m_Binance.zip` (not in any repo) |
| Span | 2017-08-17 04:00 UTC → 2025-10-11 11:02 UTC, **4,278,671** bars |
| Gaps | **35** real discontinuities (exchange outages); kept as gaps, filled only with bars Binance actually returns |
| Last bar | 2025-10-11 11:02 was captured before the minute closed: replace it only if the new bar is a valid cumulative extension (same open, higher-or-equal high/volume/trades, lower-or-equal low) |
| Gap filler | `tools/build_btc_gap.py` (on `main`) fetched 2025-10-11 → present from Binance's public API on a self-hosted Windows runner |
| One derivation | 150,001 minutes → 150,001 feature rows, 112,553 pattern events, 149,761 outcome labels |
| Result | the adaptive strategy and its challengers were **unprofitable after costs; nothing promoted** |

The same Python code is also in this repo at tag `archive/trend-bot-2026-10-20` (`btc_bot/`, byte-identical), unused
by the swarm. The ZIP can now be imported with `swarm/tools/import_binance_1m.js`.

## Lessons, and where the swarm stands

| Lesson (1-minute bot) | In the swarm |
|---|---|
| Never invent missing candles; list gaps | Feature code marks a bar with a missing boundary minute as partial; strategies skip partial bars. The importer lists gaps. ✔ |
| Spot history ≠ BloFin perpetual; measure the gap | Universe uses Binance volume but trades BloFin; feeds record both; costs modelled on BloFin fees. Spot data (the ZIP) only for long-range questions. ✔ (keep in mind) |
| Fees and microstructure decide 1-minute systems | Proven again by the 5-year sweep: every 1–45 minute strategy loses after costs. ✔ |
| Correlated indicators are not independent votes | Fusion combines budgets per coin, not votes; the regime bias averages Donchian states but is not counted as confirmation. ✔ |
| Elliott/harmonic counts are hypotheses, not truth | Harmonic plugin tested and found without edge. ✔ |
| Candlesticks only matter in context | 14 families tested on 665 coins: no edge, with or without the trend filter. ✔ |
| Learning = controlled model selection; a loss is a data point, not a reason to self-modify | Factory gate, multiple-testing bar, shadow first, plugins checked, agents cannot touch risk. ✔ Tuner added on this branch. |
| Failure is output; keep failed variants | `trials.jsonl` counts every try; rejected candidates kept in `factory/rejected/`. ✔ |
| Risk is a hard layer the strategy cannot raise | Signed `risk.json`, guardian halts on mismatch. ✔ |
| No martingale; after losses risk goes down | Drawdown ladder halves budgets at 10%; allocator gives 0 to a strategy with a negative record. ✔ Loss-streak rule: replay tool on this branch, not adopted. |
| Reserve risk for accepted-but-unresolved orders | Risk engine counts working orders in open risk; demo trader keeps UNKNOWN orders until reconciled. ✔ |
| Persist the intent before sending; never blind-retry an ambiguous send | Demo trader: intent journal, SUBMITTING→UNKNOWN on restart, look up by clientOrderId. ✔ |
| Only closed candles create signals | StrategyHost ignores partial bars; decisions at the bar close. ✔ |
| Backtest must model the trigger and exit rules used live | **Gap found:** paper/demo move stops to break-even at +1 R, ExecSim (backtests, shadow) did not. Opt-in fix on this branch. |
| PAPER / DEMO / LIVE unmistakable; live needs several separate unlocks | Live gate + live key + signed limits + your /mode. ✔ |
| Keys trade-only, never committed | Secrets outside the repo (`C:\swarm\secrets.json`). ✔ |
| Don't copy the old bot's aggressive defaults (1.45% risk, 7× leverage, 11.5% heat) | Swarm: 0.25% start, 1% cap, 6% open risk, 5× exchange leverage. ✔ |

## Its open research questions, and what answers them now

| Question (VALIDATION_AND_NEXT_STEPS.md) | Answer / tool |
|---|---|
| Does 1-minute edge survive realistic cost? | No (5-year sweep, 2026-10-20). |
| Which feature families add value beyond the others? | `event_study.js` tag table (lift with/without) per strategy. |
| Is higher-timeframe alignment useful or too late? | Deep review: the trend filter rescues no losing family. |
| Which regimes should be "no trade"? | `event_study.js` tags `in_range`, `high_volatility`, `against_trend`, by lift. |
| Do candle/harmonic/Elliott features add value after trend/volatility? | Candles and harmonics: no. Elliott: untested, event study first. |
| Does trailing improve expected R or only win rate? | Deep review: the trailing version is no better than a 2:1 target. Break-even: measure with `--breakeven 1`. |
| How much edge disappears when slippage doubles? | Backtests report `cost2` (2× costs) already. |
| Is performance stable across BTC eras? | Import the 2017–2025 ZIP; run the robust five on 2017–2021. |
