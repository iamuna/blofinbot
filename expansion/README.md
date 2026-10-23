# Possible expansion: what the 1-minute bot adds to the swarm

Branch `possible-expansion` (git branch names can't have spaces), made 2026-10-23. Source: the private repo
**iamuna/1-min-blofin-bot** (`main` = the Python BTC 1-minute research core, `handoff-ready` = its handoff and
lessons docs). The file map is in [INDEX.md](INDEX.md); the lessons and data facts are in [LESSONS.md](LESSONS.md).

**Short version.** The swarm is already far ahead of the 1-minute bot: it has the risk ladders, the signed limits,
the factory gate with a multiple-testing bar, shadow mode, the demo trader's intent journal and the 5-year sweep.
And its own research has already settled most of the 1-minute bot's *strategy* content: candle patterns, harmonics
and everything below 1h lose after costs. So almost nothing was copied as a trading rule. What the 1-minute bot does
have that the swarm lacks is **research machinery**: a way to see whether a signal points anywhere before paying for
a backtest, a bounded champion/challenger tuner, a loss-streak rule, and 8 years of BTC history. Those are brought
over, plus its one strategy as a slow-timeframe plugin so the sweep can judge it. Nothing here changes how the live
bot trades: the plugin is off in config, the tools only run when someone runs them, and the simulator change is opt-in.

## How I chose

Every part of the 1-minute bot went through three questions:

1. **Does the swarm already have it?** If yes, leave it. The swarm's version is usually better (see the table at the end).
2. **Has the swarm's own evidence already answered it?** The 5-year sweep (665 coins) and the deep review of
   2026-10-23 found that pattern and reversal families have no direction at all (price moves as far for them as
   against them), that every 1–45 minute strategy loses after costs, and that trend filters do not rescue losers.
   Anything in the 1-minute bot that depends on those ideas working is left out, with the reason written down.
3. **Can the existing pipeline test it without touching live trading?** Everything brought over plugs into what
   is there (plugin kit, `backtest/run.js`, the factory's try log, the sweep) and is off or opt-in.

## What was brought over

### 1. The excursion study (the most useful piece): `swarm/src/research/excursions.js`, `event_study.js`

**In the 1-minute bot:** `outcomes.py` labelled every minute with forward returns (1–240 min) and the best/worst move
after it (MFE/MAE).
**Here:** the same idea, measured per strategy *idea* in R (its own stop distance), at horizons counted in the idea's
own bars, streamed so nothing about the future is read early. `event_study.js` runs any plugin over the swarm dataset
on the live code path and reports, per horizon: forward R with a t-stat, average MFE and MAE, the **edge ratio**
(MFE ÷ |MAE|), how often +1 R comes before −1 R, and the cost line a trade has to clear.

**Why:** the deep review's key finding came from exactly this diagnostic (MFE ≈ MAE ≈ 1–1.2 R for every losing family),
computed in scratch scripts that are not in the repo. Now it is a permanent tool. It is the cheap screen *before* a
backtest: if the edge ratio sits near 1 and forward R does not beat the cost line, no stop, target or parameter can
help, and the factory's try count should not be spent on it.

**How:** `node swarm/src/research/event_study.js --data <swarm-data> --strategies adaptive-score --out study`.
Have the scheduled researcher run it on every new idea first, and only write a factory candidate when the edge is
there.

### 2. Condition tags, fixed: `swarm/src/research/trade_tags.js`

**In the 1-minute bot:** losing trades were tagged (in range, low volume, against trend, immediate adverse move) and
every tag on a loss counted as evidence.
**The flaw:** it only looked at losers. A condition that is just as common among winners still piled up "evidence".
**Here:** every idea is tagged from what was known at the signal (regime state, trend bias, volume, volatility,
session, side), and a tag counts only through its **lift**: average R with the tag minus without, with a t-stat.
The event study prints this table for each strategy.

**Why:** it gives the daily review a fair way to ask "do this strategy's shorts / range-regime ideas / Asian-session
ideas do worse?". A lift is a hypothesis for the factory (a candidate with a filter), not a switch to flip: the deep
review already showed filters fitted in-sample fail out of sample.

### 3. The champion/challenger tuner: `swarm/src/factory/tuner.js`

**In the 1-minute bot:** `engine.py` + `learning.py` mutated the champion's parameters within fixed ranges, scored
challengers by walk-forward on 60% of the data, ranked on a 20% validation part, showed only the best one the last
20%, and promoted only if it was positive with PF > 1 on both and beat the champion by 0.10. On real BTC data it
promoted nothing, which is the behaviour you want.
**Here:** the same loop on the swarm's backtester, at 1.5× costs throughout, using each plugin's `bounds` (the kit
has always said `bounds` are "for the tuner", but no tuner existed). Every challenger is logged as a **try** in the
factory's `trials.jsonl`, so the multiple-testing bar rises with it. A winner becomes a factory candidate file, which
still has to pass the backtest gate and shadow. The tuner decides nothing about trading.

**Why:** the robust slow set (ma-retest 12h/1d/4h, rsi-macd-trend 12h, ma-pullback 12h) has never had its settings
checked around the defaults. This does that honestly. **Do not run it on a family without edge** (deep review,
recommendation 3); run the event study first.

**How:** `node swarm/src/factory/tuner.js --data <swarm-data> --base ma-21-200 --parent '{"mode":"retest","tf":720,"onlyTfs":[720]}' --factory <swarm-factory checkout> --candidates swarm/factory/candidates`
(the 6.5-month dataset gives few 12h trades: the 5-year data is the right input once a loader for it exists).

### 4. A break-even mismatch the 1-minute bot's risk rules exposed: `ExecSim` `breakevenR` (opt-in)

**Found while comparing:** the 1-minute bot moved the stop to break-even at +1 R. So does the swarm's **paper and demo
trader** (`trading.breakevenR: 1`, for every trade without a trailing stop). But **ExecSim, which runs the backtests,
the sweep and every shadow trade, has no break-even rule.** So ma-retest and rsi-macd-trend (target, no trail) are
judged in shadow and backtests one way and traded on paper another way, and the promotion gate compares shadow with
backtests, never with paper.
**Here:** `new ExecSim({ breakevenR: 1 })` (and `backtest/run.js --breakeven 1`) applies the paper trader's exact rule:
after a bar closes +1 R in favour, the stop moves to entry + round-trip fees. Off by default, so all existing results
and tests are unchanged.

**How to finish it:** run the robust five with and without `--breakeven 1` on the 5-year data. Whichever is better
becomes the rule in *both* places: either pass `breakevenR: cfg.trading.breakevenR` to the brain's shadow ExecSim
(one line in `src/agents/brain.js`), or set `trading.breakevenR` to 0. The deep review saw that trades reaching +1 R
end at +1.05–1.13 R on average, which hints that break-even may cost a little. That's why it should be measured, not
guessed.

### 5. The loss-streak rule, as a test instead of a rule: `swarm/src/research/streak_rules.js`

**In the 1-minute bot:** risk halved after 3 losses in a row and trading stopped after 6. The swarm has day-loss and
drawdown ladders but no streak rule.
**Why not just add it:** a strategy that wins 38% of the time runs about 10 losses in a row by chance in 300 trades.
A hard stop at 6 would switch the robust trend strategies off several times a year for nothing. It only pays if
losses cluster. So this replays a strategy's real trade list (`trades-<name>.csv` from `backtest/run.js`) with and
without the rule, with the chance-level streak printed next to it. Stopped trades keep running in shadow and the
first win resets the count, so it never stops for good.

**How:** `node swarm/src/research/streak_rules.js swarm-backtest/trades-ma-retest-12h.csv`. Adopt it into the risk
engine (protected, your approval) only if the return-to-drawdown ratio improves on the 5-year trades.

### 6. 8 years of BTC: `swarm/tools/import_binance_1m.js`

**In the 1-minute bot:** a Binance BTCUSDT spot 1-minute ZIP, 4,278,671 bars, 2017-08-17 → 2025-10-11, with 35 real gaps.
**Here:** a streaming importer (reads the ZIP directly, no unpacking, low memory for the 4 GB PC) into the swarm
dataset layout. Gaps are listed in the manifest and never filled; spot has no funding.

**Why:** the 5-year sweep starts in late 2021. The 2018 bear market and 2019 are an era nothing in the swarm has
been tested on, and the 1-minute bot's own research list asks "is performance stable across BTC eras?". The robust
five run on BTC 2017–2021 is the cheapest out-of-sample test available. Caveat: spot, not BloFin perpetuals, so use
it for direction and stability, not for cost assumptions.

**How:** `node swarm/tools/import_binance_1m.js --in BTCUSD_1m_Binance.zip --out data/btc-spot --coin BTC`, then
`node swarm/src/backtest/run.js --data data/btc-spot --strategies ma-21-200 --params '{"ma-21-200":{"mode":"retest","tf":720,"onlyTfs":[720]}}' --to 2021-10-01`.
(The ZIP itself was never committed to either repo. It is on whichever machine built the 1-minute bot.)

### 7. The 1-minute bot's strategy, as a plugin: `swarm/src/strategies/adaptive_score.js`

**In the 1-minute bot:** `StrategySpec`: long when the EMA 20/50/200 trend score, a momentum score (RSI, MACD
histogram, 12-bar ROC) and an RSI band agree and volume isn't thin, optionally with a confirming candle. Stop 1 ATR,
target 1.8 R. On BTC 1m after costs it lost, and nothing was promoted.
**Here:** the same arithmetic as a swarm plugin for 4h / 12h / 1d (`adaptive-score`), registered, **off in config**,
added to the sweep as group `adaptive-score`. Checked against the Python original: identical signals on 3,000 of
3,000 bars, with and without candle confirmation.

**Why:** it is a trend-plus-momentum filter, the one family with evidence in the swarm (ma-retest and rsi-macd-trend
hold up at 4h–1d). On 1m it had no chance; on slow bars it is a fair, cheap hypothesis. Expect it to look like
rsi-macd-trend: if it adds nothing beyond that, retire it.
Two things found while porting: the trend score only takes the values ±100, ±40 and ±20, so the old `trendMin` range
(25–85) was really a three-way switch; and the "no trading in a RANGE regime" option could never fire, because a
RANGE regime needs |trend| < 35 and a signal needs ≥ 55. The plugin drops the dead option.

**How:** run the sweep with `--groups adaptive-score`. If it is positive at 1.5× costs in both halves and on the
other coins, set `enabled: true` on `adaptive-score-4h` / `-12h` in `config/swarm.json` (shadow; installs itself).

## What was left out, and why

| 1-minute bot | Why not |
|---|---|
| Candlestick patterns (`patterns.py`) | The swarm has 14 families in `candles.js`; 23 of 28 lose, every 1h one loses. Only used inside adaptive-score's optional confirmation. |
| Harmonic patterns | The swarm has `harmonic.js`; no edge after costs. |
| Elliott wave candidates | The same family as harmonics and candles (pattern hypotheses with no measured direction). If someone wants it, write the plugin and run the event study first: that costs an afternoon, not a factory try. |
| SQLite history store, sync daemon, MTF tables | The swarm has the recorder, the dataset builders, `history/` and live 1m→1d features. A second store would be two truths. |
| Risk governor sizing (0.25% base, regime multipliers ×0.65 / ×0.55, 6% drawdown stop) | The swarm's signed limits, drawdown ladders and quarter-Kelly allocator cover sizing better. Whether range or high-volatility ideas really do worse is now answerable with the event study's tag table. Adopt a multiplier only if that shows it. |
| Structural stop clamp (0.65–2.5 ATR) | The deep review found exits are not the problem; each plugin sets its own stop. |
| Mistake-knowledge store with evidence counts | It counted tags on losers only (the flaw fixed in item 2), and the swarm keeps its research memory in `RESEARCH_LOG.md` and the factory's try log. |
| Binance gap repair / terminal-candle finalize | The swarm's feeds and dataset builders handle their own data. The rule that matters (never invent candles) is kept in the importer. |
| BloFin execution spec | Already built in the swarm's demo trader (intent journal, UNKNOWN state, reconcile by clientOrderId, risk for working orders). See [LESSONS.md](LESSONS.md). |

## How to implement, in order

1. **Review this branch.** CI does not run on it (all workflows are `main`-only), so nothing has happened on its own.
   Locally: `cd swarm && npm test` (88 tests, all passing).
2. **Merge to `main`** when you're happy. That starts the CI, factory and history workflows (they trigger on these
   paths). On the PC, the update gate holds the whole update for your OK (`approve.ps1`), because it touches
   protected files (`exec_sim.js`, `run.js`, the new research and factory tools, a new test). **Live behaviour does
   not change**: no strategy is switched on, and break-even in the simulator is opt-in.
3. **Run the sweep group** `adaptive-score` (`swarm-history.yml`, `--groups adaptive-score`).
4. **Break-even decision:** robust five with and without `--breakeven 1`; make paper and shadow agree.
5. **Era test:** import the 2017–2025 BTC ZIP; run the robust five on 2017-08 → 2021-10.
6. **Researcher routine:** event study first, factory candidate second. Tuner only on families with edge, always with `--factory`.
7. **Streak rule:** replay the robust five's 5-year trades; propose a risk-engine change only if it improves return-to-drawdown.

Research and paper trading only. Not financial advice and not a claim that any of this will make money: the
1-minute bot's best result was "no strategy passed", and that honesty is the main thing worth carrying over.
