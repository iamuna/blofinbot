# Possible expansion: index

Every file this branch adds or changes, where it came from in iamuna/1-min-blofin-bot, and what it does. Why each was
chosen: [README.md](README.md). Lessons and data facts: [LESSONS.md](LESSONS.md).

## New files

| File | From (1-minute bot) | What it does | Runs on the PC? |
|---|---|---|---|
| [swarm/src/strategies/adaptive_score.js](../swarm/src/strategies/adaptive_score.js) | `btc_bot/learning.py` StrategySpec, `features.py` scores, `patterns.py` candle_pattern | Trend + momentum + RSI band + volume filter, ATR stop, 1.8 R target, for 4h/12h/1d. Same signals as the Python original. | Loaded, but **off** in config |
| [swarm/src/research/excursions.js](../swarm/src/research/excursions.js) | `btc_bot/outcomes.py` | Forward R, MFE, MAE per idea at horizons in its own bars; +1 R vs −1 R first; summary with edge ratio and cost line | No (tool) |
| [swarm/src/research/event_study.js](../swarm/src/research/event_study.js) | `outcomes.py` + `learning.py` failure tags | Runs plugins on the swarm dataset (live code path) and reports excursions plus a condition-tag table | No (tool) |
| [swarm/src/research/trade_tags.js](../swarm/src/research/trade_tags.js) | `learning.py` learn_from_trade | Entry-time condition tags and their lift (with vs without, winners included) | No (tool) |
| [swarm/src/research/streak_rules.js](../swarm/src/research/streak_rules.js) | `btc_bot/risk.py` loss-streak breaker | Replays a trade list with/without "half size after 3 losses, stop after 6"; chance-level streak | No (tool) |
| [swarm/src/factory/tuner.js](../swarm/src/factory/tuner.js) | `btc_bot/engine.py` learning_cycle, `learning.py` mutate / walk_forward_rows / score_metrics | Seeded challengers inside a plugin's `bounds`; walk-forward → validation → untouched test at 1.5× costs; logs every try; writes a factory candidate only on a clear win | No (tool) |
| [swarm/tools/import_binance_1m.js](../swarm/tools/import_binance_1m.js) | `btc_bot/ingest.py` (bootstrap_zip, parse_time_ms, verify_continuity) | Streams a Binance 1m kline ZIP/CSV into the swarm dataset layout; lists gaps, fills none | No (tool) |
| [swarm/test/expansion.test.js](../swarm/test/expansion.test.js) | `tests/test_engine.py` (spirit) | 9 tests: plugin, break-even, excursions, tags, streak replay, tuner, importer → event study → backtest | In `npm test` |
| [expansion/README.md](README.md), [INDEX.md](INDEX.md), [LESSONS.md](LESSONS.md) | `handoff-ready` docs | Why, what, how; this map; lessons and data facts | — |

## Changed files

| File | Change | Effect on live trading |
|---|---|---|
| [swarm/src/backtest/exec_sim.js](../swarm/src/backtest/exec_sim.js) | Opt-in `breakevenR`: stop to entry + fees after +1 R for no-trail ideas, as the paper/demo traders already do | None (default off) |
| [swarm/src/backtest/run.js](../swarm/src/backtest/run.js) | `--breakeven <R>` flag → ExecSim; recorded in `results.json` costs | None |
| [swarm/src/strategies/index.js](../swarm/src/strategies/index.js) | `'adaptive_score'` added to PLUGINS | Plugin loaded, not run (config off) |
| [swarm/config/swarm.json](../swarm/config/swarm.json) | `adaptive-score`, `adaptive-score-4h`, `adaptive-score-12h`, all `enabled: false` | None |
| [history/sweep.js](../history/sweep.js) | Sweep group `adaptive-score` at 4h, 12h, 1d | None (sweep runs on GitHub) |

## Update gate (what the PC does if this is merged)

`node swarm/src/tools/update_gate.js --old main --new possible-expansion` → **approval**: exec_sim.js, run.js, the
four research tools and the tuner are protected code, and the new test runs on the PC. Nothing installs until you run
`approve.ps1`.

## Source repo map (iamuna/1-min-blofin-bot)

| Branch | Holds |
|---|---|
| `main` | Python core `btc_bot/` (db, ingest, binance, features, patterns, mtf, outcomes, learning, engine, risk, knowledge, cli, daemon), `tools/build_btc_gap.py`, `tools/merge_btc_gap.py`, 4 tests, gap-build workflow (self-hosted Windows) |
| `data-gap-fill` | Same as `main` (merged as PR #1) |
| `handoff-ready` | HANDOFF.md, AGENTS.md, docs/LESSONS_FROM_BOT_AND_RESEARCH.md, docs/BLOFIN_EXECUTION_SPEC.md, docs/VALIDATION_AND_NEXT_STEPS.md |

| Python file | Ported? |
|---|---|
| `learning.py` | StrategySpec → adaptive_score.js; mutate / walk-forward / score → tuner.js; learn_from_trade → trade_tags.js; record_knowledge: no |
| `engine.py` | learning_cycle → tuner.js |
| `features.py` | Scores → adaptive_score.js; the rest exists in `swarm/src/analysis/features.js` |
| `patterns.py` | candle_pattern → inside adaptive_score.js; harmonic / Elliott / structure: no (see README) |
| `outcomes.py` | → excursions.js, event_study.js |
| `risk.py` | Loss-streak rule → streak_rules.js (as a test); break-even showed the ExecSim gap; sizing: no |
| `ingest.py` | parse_time_ms, continuity check → import_binance_1m.js |
| `mtf.py`, `db.py`, `binance.py`, `daemon.py`, `cli.py`, `knowledge.py` | No: the swarm has its own data path |
