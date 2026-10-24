# Promotion rule v2 — 2026-10-24T02:43Z

Trade now: **it-4h, ma-retest-12h, ma-retest-4h, rsi-macd-trend-12h**.

Changes from the PC's modes: candle-engulfing-1h trade → shadow; candle-engulfing-4h trade → shadow; candle-harami-4h trade → shadow; candle-morning-star-4h trade → shadow; candle-three-outside-1h trade → shadow; dip-reversal trade → shadow; intraday-trend trade → shadow; it-4h off → trade; ma-retest-12h shadow → trade; ma-retest-4h shadow → trade; rsi-macd-trend-12h shadow → trade; wyckoff-spring-1h trade → shadow.

| Strategy | Mode now | Rule v2 | Live trades | Live avg R | Active days | Clustered t (daily) | Posterior avg R | Factory avg R (trades) | Why |
|---|---|---|---|---|---|---|---|---|---|
| adaptive-score | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| adaptive-score-12h | shadow | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| adaptive-score-4h | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candel-harami-1h | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candel-harami-4h | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-doji-1h | shadow | shadow | 11 | -0.06 | 4 | -0.25 | — | -0.2343 (351) | no 5-year sweep result, and the factory backtest is negative (-0.2343 R a trade, t -3.22, 351 trades): retirement candidate |
| candle-doji-4h | shadow | shadow | 0 | — | 0 | — | — | -0.0613 (66) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-doji-star-1h | shadow | shadow | 2 | +0.36 | 1 | +1.00 | — | -0.1914 (146) | no 5-year sweep result — queue it for the sweep (live: 2 trades over 1 active days, clustered t 1.00) |
| candle-doji-star-4h | shadow | shadow | 2 | +1.98 | 1 | +1.00 | — | 0.4284 (36) | no 5-year sweep result — queue it for the sweep (live: 2 trades over 1 active days, clustered t 1.00) |
| candle-engulfing-1h | trade | shadow | 150 | +0.07 | 3 | +1.86 | — | -0.2187 (4213) | no 5-year sweep result, and the factory backtest is negative (-0.2187 R a trade, t -10.58, 4213 trades): retirement candidate |
| candle-engulfing-4h | trade | shadow | 19 | +0.34 | 3 | +0.34 | — | -0.1154 (1087) | no 5-year sweep result, and the factory backtest is negative (-0.1154 R a trade, t -2.86, 1087 trades): retirement candidate |
| candle-hammer-1h | off | shadow | 93 | -0.39 | 4 | -0.80 | — | -0.3666 (2818) | no 5-year sweep result, and the factory backtest is negative (-0.3666 R a trade, t -13.67, 2818 trades): retirement candidate |
| candle-hammer-4h | shadow | shadow | 16 | -0.20 | 4 | -0.43 | — | -0.2716 (666) | no 5-year sweep result, and the factory backtest is negative (-0.2716 R a trade, t -5.27, 666 trades): retirement candidate |
| candle-harami-1h | off | shadow | 89 | -0.62 | 4 | -1.83 | — | -0.1691 (1883) | no 5-year sweep result, and the factory backtest is negative (-0.1691 R a trade, t -5.23, 1883 trades): retirement candidate |
| candle-harami-4h | trade | shadow | 13 | +1.45 | 3 | +0.95 | — | -0.2392 (504) | no 5-year sweep result, and the factory backtest is negative (-0.2392 R a trade, t -4.03, 504 trades): retirement candidate |
| candle-marubozu-1h | off | shadow | 4 | +0.40 | 2 | +2.00 | — | 0.0081 (461) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 2 active days, clustered t 2.00) |
| candle-marubozu-4h | shadow | shadow | 0 | — | 0 | — | — | 0.1853 (125) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-morning-star-1h | off | shadow | 17 | -0.19 | 4 | -2.45 | — | -0.165 (703) | no 5-year sweep result, and the factory backtest is negative (-0.165 R a trade, t -3.39, 703 trades): retirement candidate |
| candle-morning-star-4h | trade | shadow | 4 | +1.97 | 1 | +1.00 | — | -0.1244 (174) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 1 active days, clustered t 1.00) |
| candle-piercing-1h | shadow | shadow | 27 | -0.20 | 3 | -1.06 | — | -0.1039 (1054) | no 5-year sweep result, and the factory backtest is negative (-0.1039 R a trade, t -2.44, 1054 trades): retirement candidate |
| candle-piercing-4h | shadow | shadow | 4 | +1.97 | 1 | +1.00 | — | -0.0828 (255) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 1 active days, clustered t 1.00) |
| candle-soldiers-1h | shadow | shadow | 3 | +1.15 | 2 | +1.71 | — | -0.1012 (94) | no 5-year sweep result — queue it for the sweep (live: 3 trades over 2 active days, clustered t 1.71) |
| candle-soldiers-4h | shadow | shadow | 0 | — | 0 | — | — | -0.0547 (21) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-star-1h | off | shadow | 77 | -0.25 | 3 | -0.87 | — | -0.2935 (2613) | no 5-year sweep result, and the factory backtest is negative (-0.2935 R a trade, t -10.22, 2613 trades): retirement candidate |
| candle-star-4h | shadow | shadow | 13 | +0.04 | 3 | +0.07 | — | -0.0586 (601) | no 5-year sweep result — queue it for the sweep (live: 13 trades over 3 active days, clustered t 0.07) |
| candle-three-inside-1h | shadow | shadow | 5 | +0.76 | 2 | +0.72 | — | -0.1959 (230) | no 5-year sweep result, and the factory backtest is negative (-0.1959 R a trade, t -2.39, 230 trades): retirement candidate |
| candle-three-inside-4h | shadow | shadow | 2 | +1.97 | 1 | +1.00 | — | -0.2893 (51) | no 5-year sweep result — queue it for the sweep (live: 2 trades over 1 active days, clustered t 1.00) |
| candle-three-methods-1h | shadow | shadow | 0 | — | 0 | — | — | 0.303 (43) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| candle-three-methods-4h | off | shadow | 1 | -1.02 | 1 | -1.00 | — | -0.2013 (11) | no 5-year sweep result — queue it for the sweep (live: 1 trades over 1 active days, clustered t -1.00) |
| candle-three-outside-1h | trade | shadow | 52 | +0.74 | 3 | +1.29 | — | -0.1498 (2487) | no 5-year sweep result, and the factory backtest is negative (-0.1498 R a trade, t -5.82, 2487 trades): retirement candidate |
| candle-three-outside-4h | shadow | shadow | 4 | +0.46 | 3 | +0.71 | — | -0.0601 (581) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 3 active days, clustered t 0.71) |
| candle-tweezer-1h | off | shadow | 133 | -0.23 | 3 | -0.49 | — | -0.2489 (4030) | no 5-year sweep result, and the factory backtest is negative (-0.2489 R a trade, t -11.27, 4030 trades): retirement candidate |
| candle-tweezer-4h | shadow | shadow | 33 | -0.40 | 3 | -0.64 | — | -0.0819 (1044) | no 5-year sweep result — queue it for the sweep (live: 33 trades over 3 active days, clustered t -0.64) |
| candles | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| crowd-squeeze | shadow | shadow | 1 | +0.03 | 1 | +1.00 | -0.019 | -0.0885 (26) | 5-year sweep crowd-squeeze@5 fails the gate: -0.0197 R a trade, 2/4 years positive, negative at 1.5× costs |
| dip-reversal | trade | shadow | 50 | +0.17 | 4 | +1.25 | +0.024 | -0.1207 (3777) | 5-year sweep dip-reversal@5 fails the gate: -0.0493 R a trade, 0/4 years positive, negative at 1.5× costs |
| donchian-12h-60 | shadow | shadow | 0 | — | 0 | — | — | 0.2891 (207) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| donchian-1d-150 | shadow | shadow | 0 | — | 0 | — | — | -0.024 (30) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| donchian-1d-20 | shadow | shadow | 0 | — | 0 | — | — | 0.0599 (440) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| donchian-1d-60 | shadow | shadow | 0 | — | 0 | — | — | 0.0156 (141) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| donchian-trend | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| funding-fade | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| funding-fade-4h | shadow | shadow | 0 | — | 0 | — | — | -0.3009 (16) | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| harmonic | off | shadow | 6 | -0.61 | 2 | -0.71 | -0.092 | -0.0867 (311) | 5-year sweep harmonic@15 fails the gate: -0.0602 R a trade, 0/4 years positive, negative at 1.5× costs |
| intraday-trend | trade | shadow | 201 | +0.23 | 5 | +1.33 | +0.140 | -0.1215 (7899) | 5-year sweep intraday-trend@30 fails the gate: -0.0427 R a trade, 0/4 years positive, negative at 1.5× costs |
| it-12h | shadow | shadow | 0 | — | 0 | — | -0.007 | — | 5-year sweep intraday-trend@720 fails the gate: -0.0074 R a trade, 1/4 years positive, negative at 1.5× costs |
| it-1d | shadow | shadow | 0 | — | 0 | — | -0.025 | — | 5-year sweep intraday-trend@1440 fails the gate: -0.0253 R a trade, 1/4 years positive, negative at 1.5× costs |
| it-45-hold16 | off | shadow | 3 | -0.93 | 2 | -1.61 | — | 0.0142 (1269) | no 5-year sweep result — queue it for the sweep (live: 3 trades over 2 active days, clustered t -1.61) |
| it-45-hold32 | off | shadow | 3 | -1.03 | 2 | -1.55 | — | 0.0188 (1333) | no 5-year sweep result — queue it for the sweep (live: 3 trades over 2 active days, clustered t -1.55) |
| it-45-long | off | shadow | 1 | -1.02 | 1 | -1.00 | — | 0.141 (721) | no 5-year sweep result — queue it for the sweep (live: 1 trades over 1 active days, clustered t -1.00) |
| it-4h | off | **trade** | 9 | -1.02 | 1 | -1.00 | -0.041 | 0.0833 (579) | 5-year sweep intraday-trend@240: 12114 trades, 0.047 R a trade, 4/4 years positive, positive at 1.5× costs; live record too short to veto (1 active days) |
| krown-jewel | shadow | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| krown-jewel-1h | off | shadow | 81 | -0.06 | 4 | -0.14 | — | -0.0671 (3444) | no 5-year sweep result, and the factory backtest is negative (-0.0671 R a trade, t -2.83, 3444 trades): retirement candidate |
| krown-jewel-2h | shadow | shadow | 34 | +0.29 | 4 | +0.65 | — | -0.0378 (1774) | no 5-year sweep result — queue it for the sweep (live: 34 trades over 4 active days, clustered t 0.65) |
| leader-follow | off | shadow | 57 | -0.23 | 3 | -1.51 | — | -0.2917 (1589) | no 5-year sweep result, and the factory backtest is negative (-0.2917 R a trade, t -12.32, 1589 trades): retirement candidate |
| ma-21-200 | shadow | shadow | 8 | +0.98 | 3 | +2.15 | +0.026 | -0.1078 (6523) | 5-year sweep ma-retest@15 fails the gate: -0.0509 R a trade, 0/4 years positive, negative at 1.5× costs |
| ma-pullback-12h | shadow | shadow | 0 | — | 0 | — | +0.047 | 0.1368 (160) | 5-year sweep ma-pullback@720 fails the gate: 0.0474 R a trade, 2/4 years positive, positive at 1.5× costs |
| ma-retest-12h | shadow | **trade** | 1 | -1.02 | 1 | -1.00 | +0.137 | 0.5571 (54) | 5-year sweep ma-retest@720: 1807 trades, 0.1486 R a trade, 4/4 years positive, positive at 1.5× costs; live record too short to veto (1 active days) |
| ma-retest-1d | shadow | shadow | 0 | — | 0 | — | +0.162 | — | 5-year sweep ma-retest@1440 fails the gate: 0.1623 R a trade, 2/4 years positive, positive at 1.5× costs |
| ma-retest-4h | shadow | **trade** | 0 | — | 0 | — | +0.038 | 0.0228 (308) | 5-year sweep ma-retest@240: 7270 trades, 0.038 R a trade, 3/4 years positive, positive at 1.5× costs; live record too short to veto (0 active days) |
| noise-breakout | shadow | shadow | 0 | — | 0 | — | -0.234 | -0.3032 (32928) | 5-year sweep noise-breakout@60 fails the gate: -0.2338 R a trade, 0/4 years positive, negative at 1.5× costs |
| overshoot-fade | off | shadow | 236 | -0.50 | 5 | -1.90 | -0.431 | -0.3426 (4804) | 5-year sweep overshoot-fade@1 fails the gate: -0.2748 R a trade, 0/4 years positive, negative at 1.5× costs |
| pivot-matrix | — | shadow | 88 | +0.25 | 2 | +1.41 | — | — | no 5-year sweep result — queue it for the sweep (live: 88 trades over 2 active days, clustered t 1.41) |
| pivot-matrix-1h | shadow | shadow | 37 | -0.58 | 1 | -1.00 | — | -0.0666 (3885) | no 5-year sweep result, and the factory backtest is negative (-0.0666 R a trade, t -3.4, 3885 trades): retirement candidate |
| pivot-matrix-4h | shadow | shadow | 1 | -1.05 | 1 | -1.00 | — | -0.0586 (834) | no 5-year sweep result — queue it for the sweep (live: 1 trades over 1 active days, clustered t -1.00) |
| rsi-macd | off | shadow | 103 | -0.66 | 3 | -0.82 | -0.390 | -0.1066 (3962) | 5-year sweep rsi-macd-rev@15 fails the gate: -0.1103 R a trade, 0/4 years positive, negative at 1.5× costs |
| rsi-macd-trend-12h | shadow | **trade** | 1 | -1.01 | 1 | -1.00 | +0.077 | 0.2894 (262) | 5-year sweep rsi-macd-trend@720: 6608 trades, 0.0883 R a trade, 3/4 years positive, positive at 1.5× costs; live record too short to veto (1 active days) |
| session-drive | off | shadow | 13 | -0.00 | 4 | -0.00 | -0.083 | -0.1732 (951) | 5-year sweep session-drive@30 fails the gate: -0.0936 R a trade, 0/4 years positive, negative at 1.5× costs |
| squeeze-ride | shadow | shadow | 2 | +0.27 | 1 | +1.00 | -0.005 | 0.1847 (110) | 5-year sweep squeeze-ride@5 fails the gate: -0.0105 R a trade, 0/4 years positive, negative at 1.5× costs |
| trend-pullback | off | shadow | 160 | -0.34 | 5 | -1.25 | -0.257 | -0.1721 (11726) | 5-year sweep trend-pullback@5 fails the gate: -0.1193 R a trade, 0/4 years positive, negative at 1.5× costs |
| trend-pullback-1h | off | shadow | 4 | -0.42 | 2 | -0.41 | +0.009 | -0.0286 (495) | 5-year sweep trend-pullback@60 fails the gate: 0.0263 R a trade (below the 0.03 R minimum edge), 4/4 years positive, positive at 1.5× costs |
| wyckoff-spring | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
| wyckoff-spring-1h | trade | shadow | 75 | +0.10 | 3 | +0.14 | — | -0.143 (1750) | no 5-year sweep result, and the factory backtest is negative (-0.143 R a trade, t -3.84, 1750 trades): retirement candidate |
| wyckoff-spring-4h | shadow | shadow | 4 | -0.04 | 2 | -0.04 | — | 0.0092 (427) | no 5-year sweep result — queue it for the sweep (live: 4 trades over 2 active days, clustered t -0.04) |
| wykoff-spring | off | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result — queue it for the sweep (live: 0 trades over 0 active days) |
