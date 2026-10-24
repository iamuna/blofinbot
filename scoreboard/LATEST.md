# Scoreboard — 2026-10-24

State of 2026-10-24T05:33Z (swarm-state 4d875aa). Sweep used by rule v2: history/2026-10-24/results.json. The upswarm promotion tool takes no era file, so era/2026-10-23 was not part of the rule.

## a. Live audit


Account PAPER: equity $10800.43 (start $10000), drawdown 6.6%, open positions 14, unrealised $31.28.

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

1931 shadow trades, 2026-10-20 → 2026-10-24. All longs -0.600 R a trade (1008), all shorts +0.344 R (923): the market's direction is most of what a few days measure.

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
| candle-three-outside-1h | 48 | +0.75 | +3.5 | +1.8 (26) | -0.34 | +1.30 | +0.55 | **trade** | -0.150 (-5.8, 2487) |
| candle-engulfing-4h | 16 | +0.60 | +1.5 | +1.0 (7) | -1.33 | +1.05 | +0.26 | shadow | -0.115 (-2.9, 1087) |
| candle-three-outside-4h | 4 | +0.46 | +0.5 | +0.5 (4) | -0.04 | +1.95 | +0.52 | shadow | -0.060 (-1.2, 581) |
| candle-marubozu-1h | 4 | +0.40 | +0.4 | +0.7 (2) | — | +0.40 | -0.03 | shadow | +0.008 (+0.1, 461) |
| candle-doji-star-1h | 2 | +0.36 | +0.3 | +0.3 (2) | — | +0.36 | -0.14 | shadow | -0.191 (-1.8, 146) |
| wyckoff-spring-1h | 62 | +0.35 | +1.4 | +0.9 (29) | -0.77 | +1.21 | +0.32 | shadow | -0.143 (-3.8, 1750) |
| pivot-matrix | 93 | +0.32 | +2.2 | +1.3 (12) | -0.82 | +0.81 | +0.17 | shadow | — |
| krown-jewel-2h | 34 | +0.29 | +1.1 | +0.8 (14) | -0.62 | +1.01 | +0.16 | shadow | -0.038 (-1.1, 1774) |
| squeeze-ride | 2 | +0.27 | +3.0 | +3.0 (2) | +0.27 | — | +0.88 | shadow | +0.185 (+2.4, 110) |
| dip-reversal | 47 | +0.18 | +2.6 | +1.3 (18) | +0.18 | — | +0.82 | shadow | -0.121 (-10.4, 3777) |
| intraday-trend | 192 | +0.11 | +2.2 | +0.9 (36) | -0.39 | +0.18 | -0.16 | shadow | -0.121 (-10.3, 7899) |
| candle-star-4h | 13 | +0.04 | +0.1 | +0.1 (7) | -0.41 | +0.76 | +0.21 | shadow | -0.059 (-1.0, 601) |
| crowd-squeeze | 1 | +0.03 | — | — (1) | +0.03 | — | +0.84 | shadow | -0.088 (-0.3, 26) |
| candle-engulfing-1h | 128 | +0.02 | +0.1 | +0.1 (41) | -0.68 | +1.04 | +0.19 | shadow | -0.219 (-10.6, 4213) |
| wyckoff-spring-4h | 4 | -0.04 | -0.0 | -0.0 (4) | -1.05 | +0.98 | -0.05 | shadow | +0.009 (+0.1, 427) |
| session-drive | 14 | -0.04 | -0.1 | -0.1 (7) | -0.00 | -0.54 | +0.26 | shadow | -0.173 (-5.1, 951) |
| candle-doji-1h | 11 | -0.06 | -0.1 | -0.1 (10) | -0.13 | +0.03 | +0.10 | shadow | -0.234 (-3.2, 351) |
| krown-jewel-1h | 82 | -0.07 | -0.4 | -0.3 (35) | -0.22 | +0.36 | +0.05 | shadow | -0.067 (-2.8, 3444) |
| candle-morning-star-1h | 17 | -0.19 | -0.6 | -0.5 (14) | -1.07 | +1.06 | +0.03 | shadow | -0.165 (-3.4, 703) |
| candle-piercing-1h | 27 | -0.20 | -0.7 | -0.5 (14) | -0.88 | +0.43 | -0.13 | shadow | -0.104 (-2.4, 1054) |
| candle-hammer-4h | 16 | -0.20 | -0.5 | -0.4 (7) | -0.58 | -0.03 | -0.32 | shadow | -0.272 (-5.3, 666) |
| leader-follow | 57 | -0.23 | -2.0 | -2.0 (6) | +0.00 | -0.76 | +0.03 | shadow | -0.292 (-12.3, 1589) |
| candle-star-1h | 78 | -0.26 | -1.6 | -0.9 (30) | -1.02 | +0.36 | -0.26 | shadow | -0.293 (-10.2, 2613) |
| candle-tweezer-1h | 144 | -0.31 | -2.7 | -1.3 (39) | -0.79 | +0.98 | +0.04 | shadow | -0.249 (-11.3, 4030) |
| trend-pullback | 166 | -0.33 | -3.7 | -1.8 (46) | +0.04 | -0.42 | -0.09 | shadow | -0.172 (-16.3, 11726) |
| candle-hammer-1h | 95 | -0.37 | -2.6 | -1.6 (38) | -0.49 | -0.04 | +0.02 | shadow | -0.367 (-13.7, 2818) |
| candle-tweezer-4h | 33 | -0.40 | -1.7 | -0.8 (10) | -0.92 | -0.09 | -0.53 | shadow | -0.082 (-1.9, 1044) |
| trend-pullback-1h | 4 | -0.42 | -0.7 | -0.7 (4) | -1.05 | +1.48 | +0.06 | shadow | -0.029 (-0.6, 495) |
| overshoot-fade | 240 | -0.50 | -4.7 | -2.4 (61) | -0.83 | -0.08 | -0.29 | shadow | -0.343 (-14.4, 4804) |
| pivot-matrix-1h | 38 | -0.59 | -4.4 | -1.3 (10) | -0.96 | +0.59 | -0.24 | shadow | -0.067 (-3.4, 3885) |
| harmonic | 6 | -0.61 | -1.1 | -0.8 (4) | +0.52 | -1.18 | -0.80 | shadow | -0.087 (-1.0, 311) |
| candle-harami-1h | 90 | -0.62 | -5.2 | -2.3 (28) | -0.94 | +0.25 | -0.22 | shadow | -0.169 (-5.2, 1883) |
| rsi-macd | 104 | -0.66 | -6.2 | -2.0 (20) | -0.67 | -0.32 | +0.10 | shadow | -0.107 (-5.1, 3962) |
| it-45-hold16 | 3 | -0.93 | -8.8 | -3.6 (2) | -0.90 | -1.01 | -1.02 | off | +0.014 (+0.5, 1269) |
| it-4h | 9 | -1.02 | -254.1 | -2.0 (3) | -1.02 | — | -0.81 | off | +0.083 (+1.7, 579) |
| it-45-long | 1 | -1.02 | — | — (1) | -1.02 | — | -0.89 | off | +0.141 (+2.5, 721) |
| candle-three-methods-4h | 1 | -1.02 | — | — (1) | -1.02 | — | -0.89 | off | -0.201 (-0.7, 11) |
| it-45-hold32 | 3 | -1.03 | -59.8 | -2.9 (2) | -1.04 | -1.01 | -1.12 | off | +0.019 (+0.6, 1333) |
| pivot-matrix-4h | 1 | -1.05 | — | — (1) | -1.05 | — | -0.44 | off | -0.059 (-1.4, 834) |



## b. Promotion rule v2 — DRY RUN (nothing written to control.json)


Trade now: **it-4h, ma-retest-12h, ma-retest-1d, rsi-macd-trend-12h**.

Changes from the PC's modes: ma-retest-1d shadow → trade; ma-retest-4h trade → shadow.

| Strategy | Mode now | Rule v2 | Live trades | Live avg R | Active days | Clustered t (daily) | Posterior avg R | Factory avg R (trades) | Why |
|---|---|---|---|---|---|---|---|---|---|
| adaptive-score | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| adaptive-score-12h | shadow | shadow | 0 | — | 0 | — | — | -0.0577 (295) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| adaptive-score-4h | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candel-harami-1h | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candel-harami-4h | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-doji-1h | shadow | shadow | 11 | -0.06 | 4 | -0.25 | — | -0.2343 (351) | no 5-year sweep result, and the factory backtest is negative (-0.2343 R a trade, t -3.22, 351 trades): retirement candidate |
| candle-doji-4h | shadow | shadow | 0 | — | 0 | — | — | -0.0613 (66) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-doji-star-1h | shadow | shadow | 2 | +0.36 | 1 | +1.00 | — | -0.1914 (146) | no 5-year sweep result — queue it for the sweep (live: 2 trades over 1 active days, clustered t 1.00) |
| candle-doji-star-4h | shadow | shadow | 2 | +1.98 | 1 | +1.00 | — | 0.4284 (36) | no 5-year sweep result — queue it for the sweep (live: 2 trades over 1 active days, clustered t 1.00) |
| candle-engulfing-1h | shadow | shadow | 154 | +0.03 | 4 | +0.53 | — | -0.2187 (4213) | no 5-year sweep result, and the factory backtest is negative (-0.2187 R a trade, t -10.58, 4213 trades): retirement candidate |
| candle-engulfing-4h | shadow | shadow | 19 | +0.34 | 3 | +0.34 | — | -0.1154 (1087) | no 5-year sweep result, and the factory backtest is negative (-0.1154 R a trade, t -2.86, 1087 trades): retirement candidate |
| candle-hammer-1h | off | shadow | 95 | -0.37 | 4 | -0.78 | — | -0.3666 (2818) | no 5-year sweep result, and the factory backtest is negative (-0.3666 R a trade, t -13.67, 2818 trades): retirement candidate |
| candle-hammer-4h | shadow | shadow | 16 | -0.20 | 4 | -0.43 | — | -0.2716 (666) | no 5-year sweep result, and the factory backtest is negative (-0.2716 R a trade, t -5.27, 666 trades): retirement candidate |
| candle-harami-1h | off | shadow | 90 | -0.62 | 4 | -1.90 | — | -0.1691 (1883) | no 5-year sweep result, and the factory backtest is negative (-0.1691 R a trade, t -5.23, 1883 trades): retirement candidate |
| candle-harami-4h | shadow | shadow | 13 | +1.45 | 3 | +0.95 | — | -0.2392 (504) | no 5-year sweep result, and the factory backtest is negative (-0.2392 R a trade, t -4.03, 504 trades): retirement candidate |
| candle-marubozu-1h | off | shadow | 4 | +0.40 | 2 | +2.00 | — | 0.0081 (461) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 2 active days, clustered t 2.00) |
| candle-marubozu-4h | shadow | shadow | 0 | — | 0 | — | — | 0.1853 (125) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-morning-star-1h | off | shadow | 17 | -0.19 | 4 | -2.45 | — | -0.165 (703) | no 5-year sweep result, and the factory backtest is negative (-0.165 R a trade, t -3.39, 703 trades): retirement candidate |
| candle-morning-star-4h | shadow | shadow | 4 | +1.97 | 1 | +1.00 | — | -0.1244 (174) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 1 active days, clustered t 1.00) |
| candle-piercing-1h | shadow | shadow | 27 | -0.20 | 3 | -1.06 | — | -0.1039 (1054) | no 5-year sweep result, and the factory backtest is negative (-0.1039 R a trade, t -2.44, 1054 trades): retirement candidate |
| candle-piercing-4h | shadow | shadow | 4 | +1.97 | 1 | +1.00 | — | -0.0828 (255) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 1 active days, clustered t 1.00) |
| candle-soldiers-1h | shadow | shadow | 3 | +1.15 | 2 | +1.71 | — | -0.1012 (94) | no 5-year sweep result — queue it for the sweep (live: 3 trades over 2 active days, clustered t 1.71) |
| candle-soldiers-4h | shadow | shadow | 0 | — | 0 | — | — | -0.0547 (21) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-star-1h | off | shadow | 78 | -0.26 | 4 | -0.94 | — | -0.2935 (2613) | no 5-year sweep result, and the factory backtest is negative (-0.2935 R a trade, t -10.22, 2613 trades): retirement candidate |
| candle-star-4h | shadow | shadow | 13 | +0.04 | 3 | +0.07 | — | -0.0586 (601) | no 5-year sweep result — queue it for the sweep (live: 13 trades over 3 active days, clustered t 0.07) |
| candle-three-inside-1h | shadow | shadow | 5 | +0.76 | 2 | +0.72 | — | -0.1959 (230) | no 5-year sweep result, and the factory backtest is negative (-0.1959 R a trade, t -2.39, 230 trades): retirement candidate |
| candle-three-inside-4h | shadow | shadow | 2 | +1.97 | 1 | +1.00 | — | -0.2893 (51) | no 5-year sweep result — queue it for the sweep (live: 2 trades over 1 active days, clustered t 1.00) |
| candle-three-methods-1h | shadow | shadow | 0 | — | 0 | — | — | 0.303 (43) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-three-methods-4h | off | shadow | 1 | -1.02 | 1 | -1.00 | — | -0.2013 (11) | no 5-year sweep result — queue it for the sweep (live: 1 trades over 1 active days, clustered t -1.00) |
| candle-three-outside-1h | shadow | shadow | 52 | +0.74 | 3 | +1.29 | — | -0.1498 (2487) | no 5-year sweep result, and the factory backtest is negative (-0.1498 R a trade, t -5.82, 2487 trades): retirement candidate |
| candle-three-outside-4h | shadow | shadow | 4 | +0.46 | 3 | +0.71 | — | -0.0601 (581) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 3 active days, clustered t 0.71) |
| candle-tweezer-1h | off | shadow | 144 | -0.31 | 4 | -0.73 | — | -0.2489 (4030) | no 5-year sweep result, and the factory backtest is negative (-0.2489 R a trade, t -11.27, 4030 trades): retirement candidate |
| candle-tweezer-4h | shadow | shadow | 33 | -0.40 | 3 | -0.64 | — | -0.0819 (1044) | no 5-year sweep result — queue it for the sweep (live: 33 trades over 3 active days, clustered t -0.64) |
| candles | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| crowd-squeeze | shadow | shadow | 1 | +0.03 | 1 | +1.00 | -0.019 | -0.0885 (26) | 5-year sweep crowd-squeeze@5 fails the gate: -0.0197 R a trade, 2/4 years positive, negative at 1.5× costs |
| dip-reversal | shadow | shadow | 50 | +0.17 | 4 | +1.25 | +0.024 | -0.1207 (3777) | 5-year sweep dip-reversal@5 fails the gate: -0.0493 R a trade, 0/4 years positive, negative at 1.5× costs |
| donchian-12h-60 | shadow | shadow | 0 | — | 0 | — | — | 0.2891 (207) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| donchian-1d-150 | shadow | shadow | 0 | — | 0 | — | — | -0.024 (30) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| donchian-1d-20 | shadow | shadow | 0 | — | 0 | — | — | 0.0599 (440) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| donchian-1d-60 | shadow | shadow | 0 | — | 0 | — | — | 0.0156 (141) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| donchian-trend | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| funding-fade | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| funding-fade-4h | shadow | shadow | 0 | — | 0 | — | — | -0.3009 (16) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| harmonic | off | shadow | 6 | -0.61 | 2 | -0.71 | -0.092 | -0.0867 (311) | 5-year sweep harmonic@15 fails the gate: -0.0602 R a trade, 0/4 years positive, negative at 1.5× costs |
| intraday-trend | shadow | shadow | 201 | +0.23 | 5 | +1.33 | +0.140 | -0.1215 (7899) | 5-year sweep intraday-trend@30 fails the gate: -0.0427 R a trade, 0/4 years positive, negative at 1.5× costs |
| it-12h | shadow | shadow | 0 | — | 0 | — | -0.007 | 0.4617 (183) | 5-year sweep intraday-trend@720 fails the gate: -0.0074 R a trade, 1/4 years positive, negative at 1.5× costs |
| it-1d | shadow | shadow | 0 | — | 0 | — | -0.025 | 0.5554 (86) | 5-year sweep intraday-trend@1440 fails the gate: -0.0253 R a trade, 1/4 years positive, negative at 1.5× costs |
| it-45-hold16 | off | shadow | 3 | -0.93 | 2 | -1.61 | — | 0.0142 (1269) | no 5-year sweep result — queue it for the sweep (live: 3 trades over 2 active days, clustered t -1.61) |
| it-45-hold32 | off | shadow | 3 | -1.03 | 2 | -1.55 | — | 0.0188 (1333) | no 5-year sweep result — queue it for the sweep (live: 3 trades over 2 active days, clustered t -1.55) |
| it-45-long | off | shadow | 1 | -1.02 | 1 | -1.00 | — | 0.141 (721) | no 5-year sweep result — queue it for the sweep (live: 1 trades over 1 active days, clustered t -1.00) |
| it-4h | trade | **trade** | 9 | -1.02 | 1 | -1.00 | -0.041 | 0.0833 (579) | 5-year sweep intraday-trend@240: 12114 trades, 0.047 R a trade, 4/4 years positive, positive at 1.5× costs; live record too short to veto (1 active days) |
| krown-jewel | shadow | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| krown-jewel-1h | off | shadow | 82 | -0.07 | 4 | -0.18 | — | -0.0671 (3444) | no 5-year sweep result, and the factory backtest is negative (-0.0671 R a trade, t -2.83, 3444 trades): retirement candidate |
| krown-jewel-2h | shadow | shadow | 34 | +0.29 | 4 | +0.65 | — | -0.0378 (1774) | no 5-year sweep result — queue it for the sweep (live: 34 trades over 4 active days, clustered t 0.65) |
| leader-follow | off | shadow | 57 | -0.23 | 3 | -1.51 | — | -0.2917 (1589) | no 5-year sweep result, and the factory backtest is negative (-0.2917 R a trade, t -12.32, 1589 trades): retirement candidate |
| ma-21-200 | shadow | shadow | 8 | +0.98 | 3 | +2.15 | +0.026 | -0.1078 (6523) | 5-year sweep ma-retest@15 fails the gate: -0.0506 R a trade, 0/4 years positive, negative at 1.5× costs |
| ma-pullback-12h | shadow | shadow | 0 | — | 0 | — | +0.034 | 0.1368 (160) | 5-year sweep ma-pullback@720 fails the gate: 0.0341 R a trade, 2/4 years positive, positive at 1.5× costs |
| ma-retest-12h | trade | **trade** | 1 | -1.02 | 1 | -1.00 | +0.105 | 0.5571 (54) | 5-year sweep ma-retest@720: 2215 trades, 0.1159 R a trade, 4/4 years positive, positive at 1.5× costs; live record too short to veto (1 active days) |
| ma-retest-1d | shadow | **trade** | 0 | — | 0 | — | +0.183 | — | 5-year sweep ma-retest@1440: 904 trades, 0.1826 R a trade, 4/4 years positive, positive at 1.5× costs; live record too short to veto (0 active days) |
| ma-retest-4h | trade | shadow | 0 | — | 0 | — | +0.028 | 0.0228 (308) | 5-year sweep ma-retest@240 fails the gate: 0.0275 R a trade (below the 0.03 R minimum edge), 3/4 years positive, positive at 1.5× costs |
| noise-breakout | shadow | shadow | 0 | — | 0 | — | -0.234 | -0.3032 (32928) | 5-year sweep noise-breakout@60 fails the gate: -0.2338 R a trade, 0/4 years positive, negative at 1.5× costs |
| oi-flush | shadow | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| overshoot-fade | off | shadow | 240 | -0.50 | 5 | -1.98 | -0.432 | -0.3426 (4804) | 5-year sweep overshoot-fade@1 fails the gate: -0.2748 R a trade, 0/4 years positive, negative at 1.5× costs |
| pivot-matrix | — | shadow | 93 | +0.32 | 2 | +3.80 | — | — | no 5-year sweep result — queue it for the sweep (live: 93 trades over 2 active days, clustered t 3.80) |
| pivot-matrix-1h | shadow | shadow | 38 | -0.59 | 2 | -1.10 | — | -0.0666 (3885) | no 5-year sweep result, and the factory backtest is negative (-0.0666 R a trade, t -3.4, 3885 trades): retirement candidate |
| pivot-matrix-4h | shadow | shadow | 1 | -1.05 | 1 | -1.00 | — | -0.0586 (834) | no 5-year sweep result — queue it for the sweep (live: 1 trades over 1 active days, clustered t -1.00) |
| rsi-macd | off | shadow | 104 | -0.66 | 4 | -0.83 | -0.390 | -0.1066 (3962) | 5-year sweep rsi-macd-rev@15 fails the gate: -0.1111 R a trade, 0/4 years positive, negative at 1.5× costs |
| rsi-macd-trend-12h | trade | **trade** | 1 | -1.01 | 1 | -1.00 | +0.070 | 0.2894 (262) | 5-year sweep rsi-macd-trend@720: 7122 trades, 0.0808 R a trade, 3/4 years positive, positive at 1.5× costs; live record too short to veto (1 active days) |
| session-drive | off | shadow | 14 | -0.04 | 5 | -0.06 | -0.087 | -0.1732 (951) | 5-year sweep session-drive@30 fails the gate: -0.0936 R a trade, 0/4 years positive, negative at 1.5× costs |
| squeeze-ride | shadow | shadow | 2 | +0.27 | 1 | +1.00 | -0.005 | 0.1847 (110) | 5-year sweep squeeze-ride@5 fails the gate: -0.0105 R a trade, 0/4 years positive, negative at 1.5× costs |
| trend-pullback | off | shadow | 166 | -0.33 | 5 | -1.22 | -0.248 | -0.1721 (11726) | 5-year sweep trend-pullback@5 fails the gate: -0.1193 R a trade, 0/4 years positive, negative at 1.5× costs |
| trend-pullback-1h | off | shadow | 4 | -0.42 | 2 | -0.41 | +0.009 | -0.0286 (495) | 5-year sweep trend-pullback@60 fails the gate: 0.0263 R a trade (below the 0.03 R minimum edge), 4/4 years positive, positive at 1.5× costs |
| wyckoff-spring | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| wyckoff-spring-1h | shadow | shadow | 75 | +0.10 | 3 | +0.14 | — | -0.143 (1750) | no 5-year sweep result, and the factory backtest is negative (-0.143 R a trade, t -3.84, 1750 trades): retirement candidate |
| wyckoff-spring-4h | shadow | shadow | 4 | -0.04 | 2 | -0.04 | — | 0.0092 (427) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 2 active days, clustered t -0.04) |
| wykoff-spring | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |


## c. Paper account by week

`weekly_scoreboard.js` on the upswarm-upG branch has no `--live` option: it printed only the theory table below. The weekly row is computed from swarm-state trades.jsonl (exit time, ISO week, UTC):

| ISO week | Closed trades | Wins | Sum R | Net $ |
|---|---|---|---|---|
| 2026-W43 (Oct 19–25, still open) | 55 | 22 | +16.4 | +441 |

The accountant's account record shows 78 trades, but trades.jsonl has 55 closed trades. Check whether partial exits are counted separately, or the file is incomplete.

### What it takes to win most weeks (normal returns, no fat tails)

| Annual Sharpe | Weekly Sharpe | Positive weeks | Positive months | Positive quarters |
|---|---|---|---|---|
| 0.5 | 0.07 | 53% | 56% | 60% |
| 1 | 0.14 | 56% | 61% | 69% |
| 1.5 | 0.21 | 58% | 67% | 77% |
| 2 | 0.28 | 61% | 72% | 84% |
| 3 | 0.42 | 66% | 81% | 93% |
| 5 | 0.69 | 76% | 93% | 99% |
| 8 | 1.11 | 87% | 99% | 100% |
| 12 | 1.66 | 95% | 100% | 100% |

