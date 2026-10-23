# Trend sleeve — design (2026-10-23)

**What.** The retired trend bot's whole portfolio, not one of its pieces, as a swarm agent: Donchian trend states on
34 (timeframe, lookback) pairs from 1h to 3M per coin, sized to 25% volatility per coin, tilted by cross-coin
momentum, scaled to 25% portfolio volatility (max 3× gross), rebalanced when a coin drifts outside a 25% band.
Shorts only from the 1d-and-slower layer. Code at tag `archive/trend-bot-2026-10-20` (`lab/mtf/mtf.js`,
`lab/mtfbot.js`); research in [TREND_BOT_RESEARCH_2026-10-18.md](TREND_BOT_RESEARCH_2026-10-18.md).

**Why.** It is the best-evidenced strategy in the repo: Sharpe 0.86 after costs on 30 coins it never saw (2020–2026,
delisted coins included), while the swarm's 5-year sweep found nothing below 1h that survives costs.

**Status.** Phase 1 (this change): shadow only. The agent computes the portfolio every hour from live BloFin candles,
runs it under every limit of `config/risk.json` on a shadow book, and publishes what it would ask for. It sends no
order and holds no key. Phase 2 (trading) is designed below and needs Ibrahim.

## 1. Why it does not fit the idea path, and what a sleeve is

The swarm's trade model is *idea → fusion → allocator → risk engine → trader*: one entry per coin, sized by the
strategy's record in R, with a stop, a target and a time stop, managed until it closes. A trend portfolio is not a
sequence of trades. It holds a *weight* in each coin, changes it a little about 5 times a day across 20 coins, and
rarely closes a position outright. Forcing it into ideas would cut every rebalance into a fake round trip, lose the
portfolio-level volatility scaling, and break fusion's rule that a coin with a position gets no new intent.

A **sleeve** is an agent that owns a share of the account's capital and a set of target weights:

```
 BloFin 1H candles ─► trend engine (weights per coin, every hour)
                        │
                        ▼  sleeve.target  (unsigned: a request)
                  plan(): ladders → capital share → stop-risk budget → band → RiskEngine.check per leg
                        │                       (the coordinator's own RiskEngine, config/risk.json unchanged)
                        ▼
   phase 1: the sleeve's shadow book (sleeve.state)     phase 2: the coordinator signs each leg as an order
```

The sleeve *asks*; the risk agent *decides*. `sleeve.target` and `sleeve.state` are not signed types
(`src/core/auth.js`), so the sleeve runs in the untrusted zone like the brain: on Linux in the brain group (its own
user, no bus key), on Windows in its own locked-down process (`--isolate brain,trend-sleeve`; `src/core/isolate.js`
lets it say only `sleeve.target`, `sleeve.state`, heartbeats and logs, and write only kv `sleeve:trend`). A
compromised sleeve could publish bad weights. It could not place an order, move a stop or change a limit.

## 2. Every hard limit, and how the sleeve meets it

`plan()` in [src/sleeve/sleeve.js](../src/sleeve/sleeve.js) turns one hour's weights into legs. Each step can only
shrink what the engine asked for.

| risk.json | What the sleeve does |
|---|---|
| ladders: `dayStopPct` 3% (no new), `dayFlattenPct` 5%, `ddHalvePct` 10%, `ddProvenOnlyPct` 15%, `ddHaltPct` 20% | `RiskEngine.mode()` on the account. no-new or proven-only: only legs that reduce risk; flatten or halt: close everything; drawdown ≥ 10%: every weight × 0.5. A halt stays until Ibrahim resumes. |
| every order needs a stop | every position has a stop **8 daily standard deviations** (90-day realised vol ÷ √365) from the price where it was opened or last grown. That is a disaster stop, about 30% on a typical alt. Without stops the research hit nothing like it. |
| `maxOpenRiskPct` 6% | (a) before any order, all target weights are scaled by **one** factor so Σ notional × stop distance ≤ `riskShare` × 6% (the portfolio keeps its shape); (b) every hour, stops are **tightened, never loosened**, so the sleeve's stop risk **at current prices** stays within that budget. The furthest stops (in σ) move first, which mostly locks in profit on positions that ran. (c) `RiskEngine.check` counts every other leg too. |
| `maxTradeRiskPct` 1% | `RiskEngine.check` on the **whole resulting position** (not just the leg), and stops are tightened if a position's risk at current prices passes 1%. |
| `maxCoinNotionalX`, `maxGrossX`, `maxBtcBetaX`, spread, book depth, exchange minimum, data guard, news windows | `RiskEngine.check`, unchanged, against the sleeve's other coins and (live) the other strategies' positions and working orders. A trim keeps the trimmed size; a reject keeps what is held. |
| `liveEnabled`, live caps | not touched: shadow only. Phase 2 trades only where the coordinator already lets strategies trade. |

Legs that only reduce risk always pass, as a reduce-only order would. Order: reductions first (they free room), then
additions, largest first. The sleeve trades `capitalShare` (0.5) of account equity; the rest is left for the other
strategies.

Why 8σ, risk share 100%, capital share 0.5 (sweep in the backtest report):
- tighter stops cut trends: 4σ costs 0.1–0.16 Sharpe; trailing every hour cost up to 0.3 at 4σ, and is no better at 8σ;
- wider stops make the stop-risk budget bind most of the time and the sleeve gets small (12σ: 5.7% vol);
- capital share 1.0 runs into the account's own ladders (budgets halved ~2% of the time, a brush with no-new) and a
  worst day of 3.9–4.7%, close to the 5% flatten. 0.5 never touched a ladder in 6.8 years on any of the three coin sets;
- `riskShare` 1 lets the sleeve use all of the 6% while nothing else trades (today: every strategy is in shadow).
  **Lower it to 0.5 once other strategies trade** (Sharpe 1.07 / 0.78 instead of 1.10 / 0.84; config change, needs Ibrahim).

## 3. Backtest (research-data and validation-data, 1h bars, 2020-01 → 2026-10)

Full report: [BACKTEST_TREND_SLEEVE_2026-10-23.md](BACKTEST_TREND_SLEEVE_2026-10-23.md);
`node swarm/tools/trend_sleeve_backtest.js <research-data> --validation <validation-data>`.

| Coin set | Archived result | Research engine, ported | Sleeve under risk.json | Sleeve vol / max DD / worst day |
|---|---|---|---|---|
| research-data top-20 today (20 coins, rebuilt 2026-10-19) | — | 1.20 | **1.10** | 6.9% / 8.2% / 2.2% |
| the archived top-20 (19 coins: QNT is no longer in any data branch) | 1.40 | 1.29 | **1.16** | 6.9% / 7.1% / 2.2% |
| validation: 30 other coins, delisted ones included | 0.86 | 0.86 | **0.84** | 6.2% / 7.4% / 2.6% |

- **The port is exact**: on the same data the ported engine gives bit-for-bit the archived engine's numbers (Sharpe
  1.2000555659…, 0.8552512361…). The archived 1.40 is not reproducible because research-data was rebuilt on 2026-10-19
  with a different top-20 (TAO, XLM in; BCH, QNT out) and QNT's history exists nowhere now. With BCH added back from
  validation-data, 19 of the 20 coins give 1.29. The validation result, the one the research called the honest
  expectation, reproduces exactly.
- **The executor books money as the research did**: replaying the engine's weights through the sleeve's executor
  without limits gives the research result to floating-point precision (the backtest checks it every run).
- **Under the swarm's limits** the sleeve keeps 90–98% of the research Sharpe, at half the volatility (capital share
  0.5): Sharpe 1.10 / 1.16 / 0.84, positive in 6/6 / 6/6 / 5/6 market eras, no ladder triggered, no halt, ~15–26
  stop-outs a year, ~5 rebalances a day, stop risk 3.4% of equity on average (≤ 6% always). 2× costs: 1.04 / 1.11 / 0.81.

## 4. Phase 1 — the shadow agent (this change)

[src/sleeve/agent.js](../src/sleeve/agent.js), agent `trend-sleeve`, brain group. Every hour, once BloFin has confirmed
the hour's 1H candles (it waits up to 10 minutes, then goes ahead and names the late coins):

1. ~560 days of 1H candles per coin (BloFin REST, loaded at start, then the new hour), top 20 of `uni.list` by
   Binance volume (the research used the top 20); funding from `md.funding` settlements;
2. the engine ([trend_engine.js](../src/sleeve/trend_engine.js)) recomputes every weight;
3. the shadow book advances one hour with `step()`, **the same function the backtest runs**: stops on the hour's
   high/low, marks, funding, ladders on the sleeve's own paper account (`trading.paperEquity`), then `plan()`;
4. publishes `sleeve.target` (weights, capital share, portfolio scale) and `sleeve.state` (equity, holdings with stops,
   the hour's legs with verdicts and reasons, stop risk, gross, statistics, each coin's votes per timeframe), plus
   `liveCheck`: the same targets planned against the **live** account and the other strategies' open positions and
   working orders, i.e. what the real risk agent would approve, trim or reject;
5. keeps the book in kv `sleeve:trend`: a restart continues it and catches up the hours it missed (from candles, with
   the same `step()`). Without a saved book (first start, or the Windows PC restarted: its kv is in memory) the book
   starts flat at `shadowSince` (2026-10-23) and is rebuilt from the candles.

A coin that leaves the top 20 keeps being priced with weight 0 until the shadow book is flat in it. `mode: "trade"`
in the config runs as shadow with a warning: trading needs phase 2.

Config `sleeves.trend` in `config/swarm.json` (a section other than `strategies`, so changing it needs Ibrahim):
`enabled`, `mode`, `maxCoins`, `historyDays`, `warmDays`, `shadowSince`, `rules` (`capitalShare`, `stopK`,
`riskShare`; other defaults in `RULES`, `sleeve.js`).

## 5. Phase 2 — trading (not built; needs Ibrahim)

1. **Coordinator** subscribes to `sleeve.target` (only from src `trend-sleeve`; mode from its own `modes`, key
   `sleeve:trend`, set only by Ibrahim's `/mode`). Each hour it runs `plan()` itself, with *its* state (account,
   positions, in-flight orders, books, instruments, data guard, news windows, betas), the same `RiskEngine` instance
   it uses for ideas, and its own `halted`/`paused`. It never trusts the sleeve's own plan. Each approved or trimmed
   leg becomes a signed `order` with `owner: 'sleeve:trend'`, `stop`, `reduceOnly` for reductions, `entry` = chase
   the best price 30 minutes then market (the measured 5.9 bps), counted in flight like any order. Stop tightening
   becomes a new signed type `stop.move` (risk agent → trader; it can only move a stop toward the price).
2. **Trader**: positions keyed by owner (`sleeve:trend:<coin>` next to idea positions), resizing an existing position
   (average entry, fees), reduce-only legs, `stop.move`. Exits by the sleeve publish `trade.closed` with
   `strategies: [{name: 'sleeve:trend'}]` so the accountant books the money; the allocator ignores sleeves (they
   are sized by weight, not R). The demo trader needs the same, plus BloFin's net position per instrument: either
   hedge mode, or **one owner per coin** (fusion treats a coin the sleeve holds as busy, and the sleeve skips a coin
   an idea trade holds until it closes). `liveCheck` in shadow already shows how often that would bite.
3. **Flatten / pause / halt** need nothing new: the trader closes everything, the coordinator's ladders refuse adds.
4. **Promotion**: the sleeve's evidence is a daily return series, not trades in R. Proposal: ≥ 60 days of shadow,
   live shadow daily returns tracking a backtest of the same days (correlation ≥ 0.9), no limit breach in `liveCheck`;
   then Ibrahim decides. Not automatic: the promotion gate in `src/factory/` is for idea strategies.
5. Before any real money: `riskShare` back to 0.5 if other strategies trade, and the live first-month cap applies
   to the capital share (`liveFirstMonthCapPct` ÷ `maxTradeRiskPct` × capitalShare).

## 6. Caveats

- Survivorship: the top-20 sets are today's survivors. The validation set (0.84) is the better guide.
- Backtests use Binance futures prices; the sleeve trades BloFin's. Hourly-and-up signals barely notice, and shadow
  measures it.
- The backtest marks hourly: stops are checked on each hour's high/low (gaps fill at the open), but the ladders see
  the account only at hour closes, and spread and book depth are not modelled (legs are ~$25–$1,500 on a $10k
  account, far below the top-20 books). Betas for the BTC limit: 30-day daily betas in the backtest, the brain's
  1-day 1-minute betas live.
- The live recompute of the weights runs on ~560 days of BloFin history; the slowest components (1d × 360, 1M × 12,
  3M × 4) need about a year to form, so a coin BloFin listed recently votes with fewer components, as in the research.
- Expect long flat or losing stretches: 2024–25 was flat to negative on every set, and the validation set lost 4.3% there.

## Files

| File | What | Who may change it |
|---|---|---|
| [src/sleeve/trend_engine.js](../src/sleeve/trend_engine.js) | the research engine, ported without changing a number | protected (not a plugin) |
| [src/sleeve/sleeve.js](../src/sleeve/sleeve.js) | `plan()` (limits), `step()`/`run()` (book), `fitStops()` | protected |
| [src/sleeve/agent.js](../src/sleeve/agent.js) | the shadow agent | protected |
| [tools/trend_sleeve_backtest.js](../tools/trend_sleeve_backtest.js) | the backtest and the exactness checks | protected |
| `src/core/schemas.js`, `src/core/isolate.js`, `src/run.js`, `deploy/windows/run.ps1`, `config/swarm.json` (groups, sleeves), `.github/workflows/swarm-ci.yml` | message types, isolation rules (and the risk limits passed to isolated agents), registry, the PC's agent list, CI smoke run | protected |
| [test/trend_sleeve.test.js](../test/trend_sleeve.test.js) | engine, exactness, limits fuzz, ladders, stops, the agent end to end with a fake BloFin | protected (tests) |
