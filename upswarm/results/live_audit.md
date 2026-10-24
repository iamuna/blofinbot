# Live audit — state of 2026-10-24T02:43:43.088Z

Account PAPER: equity $10880.84 (start $10000), drawdown 5.9%, open positions 12, unrealised $111.69.

## Closed paper trades

55 trades (2026-10-22T19:30 → 2026-10-24T00:33 UTC): **$441, +16.4 R**. Biggest single trade: IRYS long by intraday-trend, +24.6 R ($693, 0.04617 → 0.16806478649999998, 4.7 h). **Without it: $-252, -8.2 R.**

By side: longs 34 trades -4.3 R (without the biggest trade: -28.9 R), shorts 21 trades +20.7 R (without it: +20.7 R).

| Strategy (or fused group) | Trades | Sum R | Avg R | $ | Exits |
|---|---|---|---|---|---|
| intraday-trend | 9 | +24.7 | +2.74 | 682 | stop 5, time 4 |
| candle-engulfing-1h | 21 | +8.0 | +0.38 | 197 | target 11, stop 10 |
| candle-three-outside-1h | 4 | +2.5 | +0.63 | 45 | target 2, stop 2 |
| dip-reversal | 3 | +0.3 | +0.11 | 9 | time 3 |
| rsi-macd-trend-12h | 1 | -1.0 | -1.01 | -27 | stop 1 |
| ma-retest-12h | 1 | -1.0 | -1.02 | -11 | stop 1 |
| candle-engulfing-4h | 3 | -3.2 | -1.06 | -61 | stop 3 |
| wyckoff-spring-1h+candle-engulfing-1h | 5 | -5.4 | -1.07 | -188 | stop 5 |
| wyckoff-spring-1h | 8 | -8.5 | -1.07 | -205 | stop 8 |

## Shadow record

1893 shadow trades, 2026-10-20 → 2026-10-24. All longs -0.588 R a trade (985), all shorts +0.340 R (908): the market's direction is most of what a few days measure.

"t by hour": trades entered in the same hour counted as one. "Direction-adjusted": R minus the average of all shadow trades on the same side the same day. "±0.7 rule": average R > +0.7 → trade, < −0.7 → off.

| Strategy | Trades | Avg R | t per trade | t by hour (hours) | Long avg R | Short avg R | Direction-adjusted avg R | ±0.7 rule | Backtest avg R (t, trades) |
|---|---|---|---|---|---|---|---|---|---|
| candle-doji-star-4h | 2 | +1.98 | +164.2 | — (1) | — | +1.98 | +1.58 | **trade** | +0.428 (+1.8, 36) |
| candle-morning-star-4h | 4 | +1.97 | +336.1 | — (1) | — | +1.97 | +1.57 | **trade** | -0.124 (-1.3, 174) |
| candle-three-inside-4h | 2 | +1.97 | +1356.9 | — (1) | — | +1.97 | +1.57 | **trade** | -0.289 (-1.8, 51) |
| candle-piercing-4h | 4 | +1.97 | +196.3 | +2.0 (2) | — | +1.97 | +1.42 | **trade** | -0.083 (-1.0, 255) |
| candle-harami-4h | 13 | +1.45 | +4.4 | +1.1 (3) | +1.96 | +1.41 | +0.94 | **trade** | -0.239 (-4.0, 504) |
| candle-soldiers-1h | 3 | +1.15 | +2.8 | +7.9 (2) | — | +1.15 | +0.62 | **trade** | -0.101 (-1.0, 94) |
| ma-21-200 | 8 | +0.98 | +1.9 | +1.9 (8) | +1.98 | +0.84 | +0.66 | **trade** | -0.108 (-6.5, 6523) |
| candle-three-inside-1h | 5 | +0.76 | +1.0 | +1.0 (5) | -1.05 | +1.96 | +0.76 | **trade** | -0.196 (-2.4, 230) |
| candle-three-outside-1h | 48 | +0.75 | +3.5 | +1.8 (26) | -0.34 | +1.30 | +0.56 | **trade** | -0.150 (-5.8, 2487) |
| candle-engulfing-4h | 16 | +0.60 | +1.5 | +1.0 (7) | -1.33 | +1.05 | +0.26 | shadow | -0.115 (-2.9, 1087) |
| candle-three-outside-4h | 4 | +0.46 | +0.5 | +0.5 (4) | -0.04 | +1.95 | +0.52 | shadow | -0.060 (-1.2, 581) |
| candle-marubozu-1h | 4 | +0.40 | +0.4 | +0.7 (2) | — | +0.40 | -0.02 | shadow | +0.008 (+0.1, 461) |
| candle-doji-star-1h | 2 | +0.36 | +0.3 | +0.3 (2) | — | +0.36 | -0.14 | shadow | -0.191 (-1.8, 146) |
| wyckoff-spring-1h | 62 | +0.35 | +1.4 | +0.9 (29) | -0.77 | +1.21 | +0.32 | shadow | -0.143 (-3.8, 1750) |
| krown-jewel-2h | 34 | +0.29 | +1.1 | +0.8 (14) | -0.62 | +1.01 | +0.16 | shadow | -0.038 (-1.1, 1774) |
| squeeze-ride | 2 | +0.27 | +3.0 | +3.0 (2) | +0.27 | — | +0.88 | shadow | +0.185 (+2.4, 110) |
| pivot-matrix | 88 | +0.25 | +1.7 | +1.1 (11) | -0.82 | +0.75 | +0.12 | shadow | — |
| dip-reversal | 47 | +0.18 | +2.6 | +1.3 (18) | +0.18 | — | +0.82 | shadow | -0.121 (-10.4, 3777) |
| intraday-trend | 192 | +0.11 | +2.2 | +0.9 (36) | -0.39 | +0.18 | -0.16 | shadow | -0.121 (-10.3, 7899) |
| candle-engulfing-1h | 124 | +0.06 | +0.4 | +0.2 (40) | -0.65 | +1.04 | +0.21 | shadow | -0.219 (-10.6, 4213) |
| candle-star-4h | 13 | +0.04 | +0.1 | +0.1 (7) | -0.41 | +0.76 | +0.21 | shadow | -0.059 (-1.0, 601) |
| crowd-squeeze | 1 | +0.03 | — | — (1) | +0.03 | — | +0.84 | shadow | -0.088 (-0.3, 26) |
| session-drive | 13 | -0.00 | -0.0 | -0.0 (6) | -0.00 | — | +0.34 | shadow | -0.173 (-5.1, 951) |
| wyckoff-spring-4h | 4 | -0.04 | -0.0 | -0.0 (4) | -1.05 | +0.98 | -0.05 | shadow | +0.009 (+0.1, 427) |
| krown-jewel-1h | 81 | -0.06 | -0.4 | -0.3 (34) | -0.20 | +0.36 | +0.06 | shadow | -0.067 (-2.8, 3444) |
| candle-doji-1h | 11 | -0.06 | -0.1 | -0.1 (10) | -0.13 | +0.03 | +0.06 | shadow | -0.234 (-3.2, 351) |
| candle-morning-star-1h | 17 | -0.19 | -0.6 | -0.5 (14) | -1.07 | +1.06 | +0.03 | shadow | -0.165 (-3.4, 703) |
| candle-piercing-1h | 27 | -0.20 | -0.7 | -0.5 (14) | -0.88 | +0.43 | -0.12 | shadow | -0.104 (-2.4, 1054) |
| candle-hammer-4h | 16 | -0.20 | -0.5 | -0.4 (7) | -0.58 | -0.03 | -0.35 | shadow | -0.272 (-5.3, 666) |
| leader-follow | 57 | -0.23 | -2.0 | -2.0 (6) | +0.00 | -0.76 | +0.03 | shadow | -0.292 (-12.3, 1589) |
| candle-tweezer-1h | 133 | -0.23 | -1.9 | -1.0 (37) | -0.73 | +0.98 | +0.08 | shadow | -0.249 (-11.3, 4030) |
| candle-star-1h | 77 | -0.25 | -1.5 | -0.9 (29) | -1.01 | +0.36 | -0.25 | shadow | -0.293 (-10.2, 2613) |
| trend-pullback | 160 | -0.34 | -3.9 | -1.9 (45) | +0.04 | -0.45 | -0.09 | shadow | -0.172 (-16.3, 11726) |
| candle-hammer-1h | 93 | -0.39 | -2.7 | -1.6 (37) | -0.52 | -0.04 | -0.02 | shadow | -0.367 (-13.7, 2818) |
| candle-tweezer-4h | 33 | -0.40 | -1.7 | -0.8 (10) | -0.92 | -0.09 | -0.53 | shadow | -0.082 (-1.9, 1044) |
| trend-pullback-1h | 4 | -0.42 | -0.7 | -0.7 (4) | -1.05 | +1.48 | +0.07 | shadow | -0.029 (-0.6, 495) |
| overshoot-fade | 236 | -0.50 | -4.6 | -2.3 (59) | -0.82 | -0.09 | -0.29 | shadow | -0.343 (-14.4, 4804) |
| pivot-matrix-1h | 37 | -0.58 | -4.2 | -1.2 (9) | -0.95 | +0.59 | -0.24 | shadow | -0.067 (-3.4, 3885) |
| harmonic | 6 | -0.61 | -1.1 | -0.8 (4) | +0.52 | -1.18 | -0.79 | shadow | -0.087 (-1.0, 311) |
| candle-harami-1h | 89 | -0.62 | -5.1 | -2.2 (28) | -0.94 | +0.25 | -0.25 | shadow | -0.169 (-5.2, 1883) |
| rsi-macd | 103 | -0.66 | -6.2 | -2.0 (19) | -0.67 | -0.36 | +0.11 | shadow | -0.107 (-5.1, 3962) |
| it-45-hold16 | 3 | -0.93 | -8.8 | -3.6 (2) | -0.90 | -1.01 | -1.01 | off | +0.014 (+0.5, 1269) |
| it-4h | 9 | -1.02 | -254.1 | -2.0 (3) | -1.02 | — | -0.81 | off | +0.083 (+1.7, 579) |
| it-45-long | 1 | -1.02 | — | — (1) | -1.02 | — | -0.89 | off | +0.141 (+2.5, 721) |
| candle-three-methods-4h | 1 | -1.02 | — | — (1) | -1.02 | — | -0.89 | off | -0.201 (-0.7, 11) |
| it-45-hold32 | 3 | -1.03 | -59.8 | -2.9 (2) | -1.04 | -1.01 | -1.11 | off | +0.019 (+0.6, 1333) |
| pivot-matrix-4h | 1 | -1.05 | — | — (1) | -1.05 | — | -0.44 | off | -0.059 (-1.4, 834) |

