# Multi-timeframe, multi-coin system — research results (2026-10-18)

**Bottom line.** A volatility-targeted trend ensemble that reads every timeframe from 1 hour to 3 months on its own closes, across the top-20 BloFin perpetuals, with shorts only from the 1-day-and-up timeframes, earned a **Sharpe ratio of 1.40 (≈21% a year at 14% volatility, max drawdown 13.9%) from 2020 to 2026 after fees, slippage and funding, positive in all six market eras**. On **30 coins it never saw — including LUNA, FTT, SRM and MATIC, which collapsed or were delisted — the same rules earned Sharpe 0.86 (≈11% a year, max drawdown 15.9%), positive in five of six eras.** That second number is the honest expectation: the top-20 were chosen by today's volume, which flatters any backtest.

## How each timeframe is used

| Timeframes | Role | Evaluated | Evidence |
|---|---|---|---|
| 1d, 3d, 1w, 1M, 3M | **Strategic**: direction and size per coin; the only source of shorts | at each of their own closes | removing it makes 2022 a losing year |
| 1h, 2h, 4h, 6h, 12h | **Setup**: adds and removes long exposure between daily closes | at each of their own closes | removing it cuts Sharpe from 1.40 to 0.90 |
| 1m, 2m, 3m, 5m, 15m, 30m | **Execution**: work every order with a limit at the best price, re-posted each minute, market after 30 minutes; data freshness; minute-by-minute marking and risk checks | every minute (each frame logged at its close) | standalone sub-hour signals lose after fees on every test (docs/RESEARCH_HF_2026-10-18.md; ~60,000 configurations) |

Each coin's target = its trend votes (lookbacks from the published crypto trend study, many per timeframe), scaled so each coin runs at 25% annual volatility, tilted toward the strongest coins by cross-coin momentum, divided by the number of coins live at the time, then scaled at portfolio level to 25% volatility (max gross 3×). Orders go out only when holdings drift outside a 25% band (≈5 rebalances a day across 20 coins).

## Data and method

- Universe: top-20 BloFin USDT perpetuals by 24h volume on 2026-10-18 (docs/COIN_PROFILES.md). History: Binance USD-M futures 1h candles + funding, 2020-01 → 2026-10 (research-data branch).
- Costs: execution 5.9 bps per side (measured, below), funding paid/received every 8 hours from real funding history.
- Signals use only closed candles; positions change at the next hour; portfolio volatility scaling uses only past returns.
- Every component was kept only if removing it made results worse; parameters come from published research, not optimisation — and moving them ±30–40% barely changes the result.

## Full study (top-20, 2020-01 → 2026-10)

| Variant | Sharpe | CAGR | Volatility | Max drawdown | Rebalances/day | Eras positive | 2020 | 2021 bull | 2022 bear | 2023 recovery | 2024–25 | 2025–26 decline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| v3 chosen system | 1.4 | 20.8% | 14.2% | 13.9% | 4.8 | 6/6 | 1.97 (+33.2%) | 2.21 (+36.1%) | 0.43 (+5.1%) | 1.83 (+34.1%) | 1.11 (+22.9%) | 1.28 (+17%) |
| − cross-coin momentum | 1.27 | 17.3% | 13.2% | 14.8% | 4.6 | 6/6 | 1.8 (+28.7%) | 2.14 (+32.4%) | 0.32 (+3.3%) | 1.65 (+27.7%) | 0.92 (+16.4%) | 1.13 (+13.1%) |
| − portfolio vol targeting | 1.29 | 10.6% | 8% | 8% | 2.2 | 6/6 | 1.75 (+18.1%) | 1.97 (+21%) | 0.31 (+1.9%) | 1.69 (+17.1%) | 0.76 (+7.7%) | 1.26 (+7.7%) |
| − setup layer (1h→12h) | 0.9 | 13.7% | 15.7% | 21.8% | 2.4 | 6/6 | 1.93 (+29.9%) | 1.66 (+26.8%) | 0.68 (+11.2%) | 1.09 (+19.6%) | 0.37 (+6.6%) | 0.41 (+5.6%) |
| − strategic layer (1d→3M) | 1.62 | 26.7% | 15.4% | 19.5% | 7.5 | 5/6 | 2.15 (+41.2%) | 2.56 (+41%) | -0.93 (-11.3%) | 2 (+47.1%) | 1.92 (+50.6%) | 1.09 (+15.8%) |
| − shorts entirely (long only) | 1.63 | 25.6% | 14.6% | 18.4% | 3 | 5/6 | 2.19 (+38.7%) | 2.51 (+45.2%) | -1 (-9.7%) | 2.34 (+53.7%) | 1.58 (+37.4%) | 1.26 (+16%) |
| + shorts on all timeframes | 1.1 | 17.3% | 15.6% | 18.7% | 8 | 6/6 | 1.64 (+25.1%) | 1.49 (+21%) | 0.78 (+13.6%) | 1.23 (+22.6%) | 0.72 (+18.6%) | 1.06 (+17.2%) |
| − live-coin sizing | 1.33 | 15.5% | 11.3% | 12.4% | 4 | 6/6 | 2.14 (+19.4%) | 1.9 (+19.3%) | 0.39 (+3.2%) | 1.93 (+29.8%) | 1.12 (+21%) | 1.28 (+16.9%) |
| + funding crowding filter | 1.39 | 19.4% | 13.4% | 14.2% | 5.2 | 6/6 | 2.15 (+32%) | 2.25 (+32.6%) | 0.45 (+5%) | 1.74 (+29.4%) | 1.12 (+22.8%) | 1.26 (+16.6%) |
| + Monday Asia-open boost (setup ×1.5) | 1.4 | 20.7% | 14.2% | 14.2% | 5.2 | 6/6 | 2.07 (+34.9%) | 2.27 (+37.2%) | 0.4 (+4.7%) | 1.68 (+31.3%) | 1.05 (+21.5%) | 1.26 (+16.7%) |
| + fee-aware setup gating | 1.36 | 20.2% | 14.3% | 13.5% | 3.9 | 6/6 | 2.08 (+35.8%) | 2.22 (+36.3%) | 0.42 (+4.9%) | 1.79 (+33.7%) | 0.95 (+18.7%) | 1.07 (+14%) |
| lookbacks × 0.7 | 1.44 | 21.7% | 14.4% | 14% | 6 | 6/6 | 2.12 (+37.3%) | 2.2 (+35.5%) | 0.12 (+0.8%) | 1.86 (+36.3%) | 1.01 (+21.3%) | 1.45 (+19.8%) |
| lookbacks × 1.4 | 1.46 | 20.9% | 13.6% | 13.6% | 3.9 | 6/6 | 2.16 (+36.2%) | 2.17 (+33.7%) | 0.33 (+3.6%) | 2.04 (+37.6%) | 1.01 (+19.1%) | 1.25 (+15.7%) |
| vol target 15% | 1.44 | 12.7% | 8.6% | 8.3% | 3 | 6/6 | 2.05 (+19.9%) | 2.08 (+19.9%) | 0.39 (+2.9%) | 1.92 (+20.8%) | 1.14 (+14.2%) | 1.44 (+11.1%) |
| vol target 35% | 1.42 | 29.8% | 19.8% | 20.3% | 6.1 | 6/6 | 2.11 (+53.1%) | 2.22 (+52.5%) | 0.43 (+6.6%) | 1.78 (+48%) | 1.06 (+30.2%) | 1.23 (+23%) |
| layer weights 0.8 / 0.2 | 1.16 | 17.4% | 14.8% | 19.4% | 3.3 | 6/6 | 1.99 (+32.5%) | 1.88 (+30.2%) | 0.57 (+8.1%) | 1.57 (+28.3%) | 0.66 (+12.8%) | 0.87 (+12.1%) |
| layer weights 0.4 / 0.6 | 1.54 | 22.5% | 13.8% | 15.7% | 6.4 | 5/6 | 2.11 (+37.1%) | 2.45 (+40%) | -0.18 (-2.3%) | 1.92 (+39%) | 1.42 (+30.5%) | 1.49 (+18.5%) |
| 2× fees and slippage | 1.33 | 19.6% | 14.2% | 15.1% | 4.8 | 6/6 | 1.93 (+32.3%) | 2.19 (+35.6%) | 0.37 (+4.2%) | 1.73 (+31.8%) | 1.05 (+21.2%) | 1.18 (+15.6%) |
| 3× fees and slippage | 1.27 | 18.5% | 14.2% | 16.7% | 4.8 | 6/6 | 1.88 (+31.4%) | 2.16 (+35.1%) | 0.29 (+3.2%) | 1.62 (+29.5%) | 0.97 (+19.4%) | 1.1 (+14.3%) |
| market-order execution (8 bps) | 1.38 | 20.3% | 14.2% | 14.3% | 4.8 | 6/6 | 1.95 (+32.8%) | 2.21 (+35.9%) | 0.41 (+4.8%) | 1.8 (+33.3%) | 1.09 (+22.4%) | 1.25 (+16.5%) |
| BTC+ETH only | 0.84 | 8.9% | 10.8% | 12.2% | 1.3 | 6/6 | 2.78 (+34.4%) | 0.84 (+8.9%) | 0.61 (+4.8%) | 1.33 (+19.4%) | 0.41 (+3.4%) | 0.01 (-0.4%) |

## Out-of-universe validation (30 different coins, incl. delisted)

Coins: LTC, BCH, ADA, LINK, DOT, AVAX, MATIC (delisted 2024), ATOM, UNI, FIL, ETC, EOS (to 2025-05), XLM, ALGO, AAVE, LUNA (collapsed 2022-05, $118 → $0.008), FTT, SRM (to 2024-05), AXS, SAND, MANA, CRV, ICP, APT, ARB, OP, BNB, WAVES, CHZ, GALA.

| Variant | Sharpe | CAGR | Volatility | Max drawdown | Rebalances/day | Eras positive | 2020 | 2021 bull | 2022 bear | 2023 recovery | 2024–25 | 2025–26 decline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Validation universe (30 other coins, incl. delisted) | 0.86 | 11.3% | 13.6% | 15.9% | 4.4 | 5/6 | 1.45 (+20.5%) | 2.35 (+39.7%) | 0.52 (+5.6%) | 1.24 (+20.2%) | -0.41 (-8.2%) | 0.43 (+4.6%) |
| Validation universe, long only | 0.89 | 12.1% | 14% | 18.8% | 2.5 | 4/6 | 1.62 (+24%) | 2.43 (+44.3%) | -1.01 (-10.7%) | 1.57 (+29.4%) | 0.29 (+0.6%) | -0.14 (-2.6%) |
| Validation universe, − setup layer | 0.46 | 6.3% | 16% | 23.9% | 2.5 | 5/6 | 1.07 (+12.7%) | 1.92 (+29.8%) | 1.05 (+18.3%) | 0.48 (+7.3%) | -0.74 (-14.1%) | 0.23 (+2.4%) |

Requiring 180 or 365 days of history before trading a coin made both universes worse (Sharpe 0.74 / 0.54 on validation) — not used.

## Execution study (all 20 coins, 5-minute candles, 6659 real rebalances)

Cost = distance of the average fill from the price at the signal, plus fees (BloFin standard tier: maker 0.02%, taker 0.06%, 0.02% slippage on market fills). Limit orders count as filled only if price trades through them.

| Execution policy | Cost, first half (bps) | Cost, second half (bps) |
|---|---|---|
| Market now | 8 | 8.02 |
| Limit at signal price, 15 min | 6.49 | 6.78 |
| Limit at signal price, 1 h | 6.01 | 6.64 |
| Limit 10 bps better, 1 h | 8.99 | 5.31 |
| Limit 20 bps better, 2 h | 10.83 | 4.01 |
| Limit 40 bps better, 4 h | 9.61 | 3.96 |
| Limit 0.5 ATR(5m) better, 1 h | 9.16 | 3.98 |
| Limit 1 ATR(5m) better, 2 h | 18.18 | 3.25 |
| Limit 2 ATR(5m) better, 4 h | 19.14 | 3.72 |
| Chase best price, 30 min | 5.86 | 5.93 |
| TWAP 30 min | 10.72 | 9.8 |
| Half market, half 1 ATR limit, 2 h | 13.09 | 5.63 |

**Chosen: post at the best price, re-post on every candle for 30 minutes, then market.** It is the only policy that beat a market order by the same amount in both halves. Deep "wait for a dip" orders were excellent in one half and expensive in the other.

## What did not earn a place

Funding crowding filter, Monday Asia-open weighting, fee-aware gating of the setup layer, minimum-history rule, shorts on intraday timeframes (all ≤ the chosen system or worse in some era).

## Honest caveats

- Survivorship: the top-20 are today's winners. The validation universe (Sharpe 0.86) is the better guide.
- 2025–26 (the current decline) is weaker on the validation set (0.43) and BTC+ETH alone was flat (0.01).
- Backtests use Binance futures prices; the bot trades BloFin. Hourly-and-up trend signals are insensitive to the small venue differences, and live paper trading measures them.
- Expect long flat or losing stretches: the worst historical drawdown was 13.9% (top-20) / 15.9% (validation). The live risk governor halves risk at 15% and goes flat at 25%.
