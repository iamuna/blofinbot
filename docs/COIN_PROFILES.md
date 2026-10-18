# Coin profiles — how each market moves (2026-10-18)

Built by `lab/mtf/profile.js` from the `research-data` branch (Binance USD-M futures history for the top-20 BloFin USDT perpetuals by 24h volume). Each coin's trading plan starts from these facts; validation decides what survives.

## How to read this

- **Fees / 1h candle**: a taker round trip (0.16% incl. slippage) divided by the median 1-hour high–low range over the last year. Above ~0.1, hourly signals cannot pay for themselves.
- **Variance ratio (VR)**: variance of returns at a horizon ÷ what a random walk would give. **Above 1 = moves persist (trend); below 1 = moves snap back (mean reversion).** Estimates at 1w/1M rest on few independent samples and are noisy.
- **Trend efficiency**: net 30-day move ÷ total path travelled (1 = straight line).
- **Funding**: average annualised funding paid by longs over the last ~3 years.
- Volume is Binance futures 24h median (BloFin volume ranked the universe).

| Coin | Since | Annual vol | Volume/day | Beta to BTC | Corr | Fees / 1h candle | Fees / 1d candle | VR 15m | VR 1h | VR 4h | VR 1d | VR 1w | VR 1M | Funding (ann.) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BTC | 2020-01-01 | 44% | $9602M | 1 | 1 | 0.314 | 0.052 | 0.967 | 0.935 | 0.979 | 0.947 | 0.851 | 1.115 | 3.4% |
| ETH | 2020-01-01 | 61% | $7848M | 1.26 | 0.91 | 0.231 | 0.039 | 0.986 | 0.969 | 1.012 | 1.038 | 0.933 | 1.144 | 2.5% |
| ZEC | 2020-02-05 | 139% | $1331M | 1.53 | 0.49 | 0.098 | 0.018 | 0.972 | 0.942 | 0.934 | 1.037 | 0.958 | 1.374 | -8.7% |
| XRP | 2020-01-06 | 65% | $795M | 1.27 | 0.86 | 0.213 | 0.038 | 0.989 | 0.93 | 0.921 | 0.979 | 0.965 | 1.434 | 0.1% |
| SOL | 2020-09-14 | 64% | $1633M | 1.26 | 0.87 | 0.198 | 0.035 | 0.998 | 0.921 | 0.986 | 0.978 | 0.778 | 1.187 | -1.7% |
| NEAR | 2020-10-15 | 106% | $213M | 1.26 | 0.53 | 0.122 | 0.024 | 0.976 | 0.889 | 0.985 | 0.968 | 0.899 | 1.2 | 3.3% |
| Q | 2025-09-02 | 195% | $3M | 0.18 | 0.04 | 0.086 | 0.015 | 0.986 | 1.049 | 0.933 | 0.53 | 0.871 | 1.083 | 13.4% |
| HYPE | 2025-05-30 | 91% | $567M | 1.01 | 0.49 | 0.127 | 0.025 | 0.973 | 0.916 | 0.888 | 0.947 | 0.857 | 0.642 | 2.4% |
| DOGE | 2020-07-10 | 67% | $368M | 1.21 | 0.8 | 0.195 | 0.033 | 1.01 | 0.935 | 0.968 | 0.964 | 0.974 | 0.979 | 3% |
| XMR | 2020-02-03 | 83% | $40M | 0.89 | 0.48 | 0.141 | 0.03 | 0.93 | 0.875 | 0.923 | 0.76 | 0.805 | 0.565 | 18.4% |
| SUI | 2023-05-03 | 86% | $231M | 1.5 | 0.77 | 0.149 | 0.026 | 0.979 | 0.928 | 0.982 | 0.944 | 0.786 | 1.099 | 3.2% |
| 1000BONK | 2023-11-22 | 94% | $22M | 1.45 | 0.68 | 0.134 | 0.023 | 1.009 | 0.994 | 0.958 | 0.937 | 0.942 | 1.351 | -3.9% |
| PEPE | 2023-05-05 | 96% | $195M | 1.55 | 0.71 | 0.144 | 0.026 | 0.998 | 0.972 | 0.99 | 1.028 | 0.954 | 1.274 | -0.5% |
| HBAR | 2021-03-17 | 70% | $30M | 1.05 | 0.66 | 0.183 | 0.034 | 1.017 | 0.979 | 0.964 | 1.063 | 1.003 | 1.501 | 0.8% |
| PUMP | 2025-04-12 | 123% | $169M | 1.44 | 0.52 | 0.093 | 0.016 | 0.984 | 0.936 | 1.026 | 0.953 | 0.915 | 0.917 | 2.5% |
| SNDK | 2026-04-07 | 122% | $1886M | 0.76 | 0.23 | 0.176 | 0.023 | 1.028 | 1.002 | 0.937 | 0.845 | 1.623 | 1.052 | 10.4% |
| TRX | 2020-01-15 | 24% | $37M | 0.21 | 0.4 | 0.599 | 0.099 | 1.031 | 1.134 | 0.968 | 1.478 | 0.706 | 0.878 | -8.2% |
| TIA | 2023-10-31 | 105% | $21M | 1.42 | 0.6 | 0.119 | 0.022 | 1.001 | 0.977 | 0.951 | 0.946 | 0.791 | 1.115 | 2.1% |
| INJ | 2022-08-17 | 96% | $43M | 1.3 | 0.59 | 0.125 | 0.023 | 0.996 | 0.961 | 0.961 | 0.952 | 0.815 | 1.13 | -11% |
| QNT | 2022-10-20 | 110% | $3M | 0.77 | 0.31 | 0.164 | 0.031 | 0.942 | 0.981 | 0.866 | 0.987 | 1.517 | 1.327 | 1.3% |

## What the data says

- **Monthly moves persist in 15 of 20 coins** (VR 1M > 1): the multi-week to multi-month trend is the most common character — consistent with the published trend-following evidence.
- **Hourly moves snap back in 17 of 20 coins** (VR 1h < 1): short-term mean reversion is everywhere, but at 10–60% of a candle's range in fees it can only be used for *entry timing* (buy dips inside an uptrend), not as a standalone strategy.
- **Fees decide the smallest usable signal timeframe:** BTC, ETH, XRP, SOL, DOGE, HBAR and TRX need daily-scale signals (fees > 15% of an hourly candle); the more volatile coins (ZEC, NEAR, PUMP, Q, TIA, INJ, HYPE) can use 4h signals.
- **Most alts move 1.2–1.5× BTC with correlation 0.5–0.9.** Twenty coins are not twenty independent bets: the portfolio caps total risk and treats the high-correlation group as one cluster.
- **Funding:** longs pay heavily on XMR (~18%/yr), Q (~13%) and SNDK (~10%); shorts are paid. The crowding filter scales down longs when funding is extreme.
- **Caveats:** Q and QNT trade ~$3M/day on Binance — thin markets with noisy statistics; SNDK is a tokenised Sandisk stock perp with ~6 months of history; HYPE, PUMP and Q have under 1.5 years. These get small weights and are judged on less evidence.

## Per-coin plan (starting points)

| Coin | Execution timeframe (maker fees ≤ 10% of candle) | Smallest signal timeframe (taker fees ≤ 8% of candle) | Trends at | Snaps back at | Notes |
|---|---|---|---|---|---|
| BTC | 1h | 1d | 1M | 1d, 1w, 1h | 1-hour moves tend to snap back: avoid chasing hourly breakouts; trends persist at 1M: trend ensemble leads; moves mostly with BTC: counts toward the BTC risk cluster |
| ETH | 30m | 1d | 4h, 1d, 1M | 1w | trends persist at 1d/1M: trend ensemble leads; moves mostly with BTC: counts toward the BTC risk cluster |
| ZEC | 5m | 4h | 1d, 1M | 4h, 1h | 1-hour moves tend to snap back: avoid chasing hourly breakouts; trends persist at 1d/1M: trend ensemble leads |
| XRP | 30m | 1d | 1M | 4h, 1h | 1-hour moves tend to snap back: avoid chasing hourly breakouts; trends persist at 1M: trend ensemble leads; moves mostly with BTC: counts toward the BTC risk cluster |
| SOL | 30m | 1d | 1M | 1w, 1h | 1-hour moves tend to snap back: avoid chasing hourly breakouts; trends persist at 1M: trend ensemble leads; moves mostly with BTC: counts toward the BTC risk cluster |
| NEAR | 15m | 4h | 1M | 1w, 1h | 1-hour moves tend to snap back: avoid chasing hourly breakouts; trends persist at 1M: trend ensemble leads |
| Q | 5m | 4h | 1M, 1h | 4h, 1d, 1w | trends persist at 1M: trend ensemble leads |
| HYPE | 15m | 4h | — | 4h, 1d, 1w, 1M, 1h | 1-hour moves tend to snap back: avoid chasing hourly breakouts; no horizon shows clear persistence: smaller trend allocation |
| DOGE | 30m | 1d | 15m | 1h | 1-hour moves tend to snap back: avoid chasing hourly breakouts; no horizon shows clear persistence: smaller trend allocation |
| XMR | 15m | 4h | — | 4h, 1d, 1w, 1M, 15m, 1h | 15-minute moves tend to snap back: buy dips / sell rips when entering; 1-hour moves tend to snap back: avoid chasing hourly breakouts; no horizon shows clear persistence: smaller trend allocation; funding is usually expensive for longs: crowding filter matters |
| SUI | 15m | 4h | 1M | 1d, 1w, 1h | 1-hour moves tend to snap back: avoid chasing hourly breakouts; trends persist at 1M: trend ensemble leads |
| 1000BONK | 15m | 4h | 1M, 15m | 1d, 1w | trends persist at 1M: trend ensemble leads |
| PEPE | 15m | 4h | 1d, 1M | — | trends persist at 1d/1M: trend ensemble leads |
| HBAR | 15m | 1d | 1d, 1w, 1M, 15m | — | trends persist at 1d/1w/1M: trend ensemble leads |
| PUMP | 5m | 4h | 4h | 1w, 1M, 1h | 1-hour moves tend to snap back: avoid chasing hourly breakouts; no horizon shows clear persistence: smaller trend allocation |
| SNDK | 15m | 4h | 1w, 1M, 15m, 1h | 4h, 1d | trends persist at 1w/1M: trend ensemble leads |
| TRX | 4h | 1d | 1d, 15m, 1h | 1w, 1M | trends persist at 1d: trend ensemble leads |
| TIA | 15m | 4h | 1M, 15m | 1d, 1w | trends persist at 1M: trend ensemble leads |
| INJ | 15m | 4h | 1M | 1w | trends persist at 1M: trend ensemble leads |
| QNT | 15m | 4h | 1w, 1M | 4h, 15m | 15-minute moves tend to snap back: buy dips / sell rips when entering; trends persist at 1w/1M: trend ensemble leads |

Full per-coin detail (hour-of-day volatility and returns, weekday returns, candle ranges per timeframe, funding percentiles): `research_out/profiles/<COIN>.json`.
