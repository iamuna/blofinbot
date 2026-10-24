# Promotion rule v2 — 2026-10-24T09:05Z

Evidence: 5-year sweep 2026-10-24, era test 2026-10-23, factory latest, live state 2026-10-24T08:49:45.438Z.

Trade by the rule: **candle-doji-star-4h, candle-marubozu-4h, it-4h, ma-retest-12h, rsi-macd-trend-12h**.

Differs from the PC's modes: candle-doji-star-4h shadow → trade; candle-marubozu-4h shadow → trade; it-4h shadow → trade; ma-retest-12h shadow → trade; ma-retest-4h trade → shadow; rsi-macd-trend-12h shadow → trade.

| Strategy | Mode now | Rule v2 | Live trades | Live avg R | Active days | Clustered t (daily) | Posterior avg R | Factory avg R (trades) | Why |
|---|---|---|---|---|---|---|---|---|---|
| adaptive-score | off | off | 0 | — | 0 | — | — | — | off in the config or by Ibrahim: the rule does not switch it on |
| adaptive-score-12h | shadow | shadow | 0 | — | 0 | — | +0.016 | -0.0577 (295) | 5-year sweep adaptive-score@720 fails the gate: 1/4 years positive, 0.016 R a trade (minimum edge 0.03) |
| adaptive-score-4h | off | off | 0 | — | 0 | — | -0.011 | — | off in the config or by Ibrahim: the rule does not switch it on |
| candel-harami-1h | off | off | 0 | — | 0 | — | — | — | off in the config or by Ibrahim: the rule does not switch it on |
| candel-harami-4h | off | off | 0 | — | 0 | — | — | — | off in the config or by Ibrahim: the rule does not switch it on |
| candle | off | off | 0 | — | 0 | — | — | — | off in the config or by Ibrahim: the rule does not switch it on |
| candle-doji-1h | shadow | shadow | 11 | -0.06 | 4 | -0.25 | -0.134 | — | 5-year sweep candle-doji@60 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.1427 R a trade (minimum edge 0.03) |
| candle-doji-4h | shadow | shadow | 0 | — | 0 | — | -0.127 | -0.0613 (66) | 5-year sweep candle-doji@240 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.1273 R a trade (minimum edge 0.03) |
| candle-doji-star-1h | shadow | shadow | 2 | +0.36 | 1 | +1.00 | -0.070 | -0.1914 (146) | 5-year sweep candle-doji-star@60 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0783 R a trade (minimum edge 0.03) |
| candle-doji-star-4h | shadow | **trade** | 2 | +1.98 | 1 | +1.00 | +0.072 | 0.4284 (36) | 5-year sweep candle-doji-star@240: 825 trades, 0.034 R a trade, 3/4 years positive, positive at 1.5× costs; live record too short to veto (1 active days) |
| candle-engulfing-1h | shadow | shadow | 163 | +0.02 | 4 | +0.27 | -0.032 | -0.2187 (4213) | 5-year sweep candle-engulfing@60 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.114 R a trade (minimum edge 0.03) |
| candle-engulfing-4h | shadow | shadow | 20 | +0.29 | 4 | +0.31 | -0.007 | -0.1154 (1087) | 5-year sweep candle-engulfing@240 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0662 R a trade (minimum edge 0.03) |
| candle-hammer-1h | off | off | 99 | -0.37 | 4 | -0.82 | -0.292 | — | off in the config or by Ibrahim: the rule does not switch it on |
| candle-hammer-4h | shadow | shadow | 16 | -0.20 | 4 | -0.43 | -0.149 | — | 5-year sweep candle-hammer@240 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.1397 R a trade (minimum edge 0.03) |
| candle-harami-1h | off | off | 91 | -0.63 | 4 | -1.97 | -0.364 | — | off in the config or by Ibrahim: the rule does not switch it on |
| candle-harami-4h | shadow | shadow | 14 | +1.31 | 4 | +0.92 | +0.078 | — | 5-year sweep candle-harami@240 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0949 R a trade (minimum edge 0.03) |
| candle-marubozu-1h | shadow | shadow | 4 | +0.40 | 2 | +2.00 | +0.012 | 0.0081 (461) | 5-year sweep candle-marubozu@60 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0038 R a trade (minimum edge 0.03) |
| candle-marubozu-4h | shadow | **trade** | 0 | — | 0 | — | +0.057 | 0.1853 (125) | 5-year sweep candle-marubozu@240: 2290 trades, 0.0574 R a trade, 3/4 years positive, positive at 1.5× costs; live record too short to veto (0 active days) |
| candle-morning-star-1h | off | off | 17 | -0.19 | 4 | -2.45 | -0.086 | — | off in the config or by Ibrahim: the rule does not switch it on |
| candle-morning-star-4h | shadow | shadow | 4 | +1.97 | 1 | +1.00 | +0.030 | -0.1244 (174) | 5-year sweep candle-morning-star@240 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0478 R a trade (minimum edge 0.03) |
| candle-piercing-1h | shadow | shadow | 27 | -0.20 | 3 | -1.06 | -0.093 | -0.1039 (1054) | 5-year sweep candle-piercing@60 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0639 R a trade (minimum edge 0.03) |
| candle-piercing-4h | shadow | shadow | 4 | +1.97 | 1 | +1.00 | +0.005 | -0.0828 (255) | 5-year sweep candle-piercing@240 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0739 R a trade (minimum edge 0.03) |
| candle-soldiers-1h | shadow | shadow | 3 | +1.15 | 2 | +1.71 | +0.030 | -0.1012 (94) | 5-year sweep candle-soldiers@60 fails the gate: negative at 1.5× costs, 2/4 years positive, -0.0039 R a trade (minimum edge 0.03) |
| candle-soldiers-4h | shadow | shadow | 0 | — | 0 | — | +0.011 | -0.0547 (21) | 5-year sweep candle-soldiers@240 fails the gate: 2/4 years positive, 0.0107 R a trade (minimum edge 0.03) |
| candle-star-1h | off | off | 79 | -0.24 | 4 | -0.84 | -0.197 | — | off in the config or by Ibrahim: the rule does not switch it on |
| candle-star-4h | shadow | shadow | 13 | +0.04 | 3 | +0.07 | -0.084 | -0.0586 (601) | 5-year sweep candle-star@240 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.1006 R a trade (minimum edge 0.03) |
| candle-three-inside-1h | shadow | shadow | 5 | +0.76 | 2 | +0.72 | -0.016 | -0.1959 (230) | 5-year sweep candle-three-inside@60 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0551 R a trade (minimum edge 0.03) |
| candle-three-inside-4h | shadow | shadow | 2 | +1.97 | 1 | +1.00 | -0.012 | -0.2893 (51) | 5-year sweep candle-three-inside@240 fails the gate: negative at 1.5× costs, 2/4 years positive, -0.0513 R a trade (minimum edge 0.03) |
| candle-three-methods-1h | shadow | shadow | 0 | — | 0 | — | -0.013 | 0.303 (43) | 5-year sweep candle-three-methods@60 fails the gate: negative at 1.5× costs, 2/4 years positive, -0.0127 R a trade (minimum edge 0.03) |
| candle-three-methods-4h | shadow | shadow | 1 | -1.02 | 1 | -1.00 | -0.095 | -0.2013 (11) | 5-year sweep candle-three-methods@240 fails the gate: negative at 1.5× costs, 2/4 years positive, -0.0853 R a trade (minimum edge 0.03) |
| candle-three-outside-1h | shadow | shadow | 54 | +0.73 | 4 | +1.33 | +0.202 | — | 5-year sweep candle-three-outside@60 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.082 R a trade (minimum edge 0.03) |
| candle-three-outside-4h | shadow | shadow | 4 | +0.46 | 3 | +0.71 | -0.014 | -0.0601 (581) | 5-year sweep candle-three-outside@240 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0325 R a trade (minimum edge 0.03) |
| candle-tweezer-1h | off | off | 152 | -0.29 | 4 | -0.73 | -0.231 | — | off in the config or by Ibrahim: the rule does not switch it on |
| candle-tweezer-4h | shadow | shadow | 33 | -0.40 | 3 | -0.64 | -0.181 | -0.0819 (1044) | 5-year sweep candle-tweezer@240 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.1106 R a trade (minimum edge 0.03) |
| candles | off | off | 0 | — | 0 | — | — | — | off in the config or by Ibrahim: the rule does not switch it on |
| crowd-squeeze | shadow | shadow | 1 | +0.03 | 1 | +1.00 | -0.019 | -0.0885 (26) | 5-year sweep crowd-squeeze@5 fails the gate: negative at 1.5× costs, 2/4 years positive, -0.0197 R a trade (minimum edge 0.03) |
| dip-reversal | shadow | shadow | 50 | +0.17 | 4 | +1.25 | +0.024 | — | 5-year sweep dip-reversal@5 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0493 R a trade (minimum edge 0.03) |
| donchian-12h-60 | shadow | shadow | 0 | — | 0 | — | -0.018 | 0.2891 (207) | 5-year sweep donchian-60@720 fails the gate: negative at 1.5× costs, 2/4 years positive, -0.018 R a trade (minimum edge 0.03) |
| donchian-1d-150 | shadow | shadow | 0 | — | 0 | — | -0.017 | 0.0024 (29) | 5-year sweep donchian-150@1440 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.017 R a trade (minimum edge 0.03) |
| donchian-1d-20 | shadow | shadow | 0 | — | 0 | — | +0.011 | 0.0599 (440) | 5-year sweep donchian-20@1440 fails the gate: 0.0107 R a trade (minimum edge 0.03) |
| donchian-1d-60 | shadow | shadow | 0 | — | 0 | — | -0.003 | 0.0964 (105) | 5-year sweep donchian-60@1440 fails the gate: negative at 1.5× costs, 2/4 years positive, -0.0033 R a trade (minimum edge 0.03) |
| donchian-trend | off | off | 0 | — | 0 | — | — | — | off in the config or by Ibrahim: the rule does not switch it on |
| funding-fade | off | off | 0 | — | 0 | — | — | — | off in the config or by Ibrahim: the rule does not switch it on |
| funding-fade-4h | shadow | shadow | 0 | — | 0 | — | +0.012 | -0.3009 (16) | 5-year sweep funding-fade@240 fails the gate: 0.0119 R a trade (minimum edge 0.03) |
| harmonic | off | off | 6 | -0.61 | 2 | -0.71 | -0.092 | -0.0867 (311) | off in the config or by Ibrahim: the rule does not switch it on |
| intraday-trend | shadow | shadow | 202 | +0.23 | 5 | +1.32 | +0.139 | -0.1215 (7899) | 5-year sweep intraday-trend@30 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0427 R a trade (minimum edge 0.03) |
| it-12h | shadow | shadow | 0 | — | 0 | — | -0.007 | 0.4617 (183) | 5-year sweep intraday-trend@720 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0074 R a trade (minimum edge 0.03) |
| it-1d | shadow | shadow | 0 | — | 0 | — | -0.025 | 0.5554 (86) | 5-year sweep intraday-trend@1440 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0253 R a trade (minimum edge 0.03) |
| it-45-hold16 | off | off | 3 | -0.93 | 2 | -1.61 | — | 0.0142 (1269) | off in the config or by Ibrahim: the rule does not switch it on |
| it-45-hold32 | off | off | 3 | -1.03 | 2 | -1.55 | — | 0.0188 (1333) | off in the config or by Ibrahim: the rule does not switch it on |
| it-45-long | shadow | shadow | 1 | -1.02 | 1 | -1.00 | — | 0.141 (721) | no 5-year sweep result: queue it for the sweep (live: 1 trades over 1 active days, clustered t -1.00) |
| it-4h | shadow | **trade** | 9 | -1.02 | 1 | -1.00 | -0.041 | 0.0833 (579) | 5-year sweep intraday-trend@240: 12114 trades, 0.047 R a trade, 4/4 years positive, positive at 1.5× costs; live record too short to veto (1 active days) |
| krown-jewel | shadow | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result: queue it for the sweep (live: 0 trades over 0 active days) |
| krown-jewel-1h | off | off | 82 | -0.07 | 4 | -0.18 | -0.052 | -0.0671 (3444) | off in the config or by Ibrahim: the rule does not switch it on |
| krown-jewel-2h | shadow | shadow | 34 | +0.29 | 4 | +0.65 | +0.048 | -0.0378 (1774) | 5-year sweep krown-jewel@120 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0341 R a trade (minimum edge 0.03) |
| leader-follow | shadow | shadow | 57 | -0.23 | 3 | -1.51 | — | — | no 5-year sweep result: queue it for the sweep (live: 57 trades over 3 active days, clustered t -1.51) |
| ma-21-200 | shadow | shadow | 9 | +0.76 | 4 | +1.52 | +0.016 | — | 5-year sweep ma-retest@15 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0506 R a trade (minimum edge 0.03) |
| ma-pullback-12h | shadow | shadow | 0 | — | 0 | — | +0.034 | 0.1368 (160) | 5-year sweep ma-pullback@720 fails the gate: 2/4 years positive |
| ma-retest-12h | shadow | **trade** | 1 | -1.02 | 1 | -1.00 | +0.105 | 0.5571 (54) | 5-year sweep ma-retest@720: 2215 trades, 0.1159 R a trade, 4/4 years positive, positive at 1.5× costs, era 2018–21 0.2928 R; live record too short to veto (1 active days) |
| ma-retest-12h-golden-fib | shadow | shadow | 0 | — | 0 | — | — | 0.9448 (37) | no 5-year sweep result: queue it for the sweep (live: 0 trades over 0 active days) |
| ma-retest-1d | shadow | shadow | 0 | — | 0 | — | +0.183 | — | 5-year sweep ma-retest@1440 fails the gate: 2018–21 era test -0.1669 R at 1.5× costs |
| ma-retest-1d-golden | shadow | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result: queue it for the sweep (live: 0 trades over 0 active days) |
| ma-retest-4h | trade | shadow | 0 | — | 0 | — | +0.028 | 0.0228 (308) | 5-year sweep ma-retest@240 fails the gate: 0.0275 R a trade (minimum edge 0.03) |
| ma-retest-4h-golden | shadow | shadow | 0 | — | 0 | — | — | 0.1112 (188) | no 5-year sweep result: queue it for the sweep (live: 0 trades over 0 active days) |
| noise-breakout | shadow | shadow | 0 | — | 0 | — | -0.234 | — | 5-year sweep noise-breakout@60 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.2338 R a trade (minimum edge 0.03) |
| oi-flush | shadow | shadow | 0 | — | 0 | — | — | — | no 5-year sweep result: queue it for the sweep (live: 0 trades over 0 active days) |
| overshoot-fade | off | off | 243 | -0.48 | 5 | -1.91 | -0.423 | — | off in the config or by Ibrahim: the rule does not switch it on |
| pivot-matrix | — | shadow | 97 | +0.27 | 2 | +2.46 | — | — | no 5-year sweep result: queue it for the sweep (live: 97 trades over 2 active days, clustered t 2.46) |
| pivot-matrix-1h | shadow | shadow | 39 | -0.52 | 2 | -0.89 | -0.186 | — | 5-year sweep pivot-matrix@60 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0568 R a trade (minimum edge 0.03) |
| pivot-matrix-4h | shadow | shadow | 2 | -0.13 | 2 | -0.15 | -0.025 | -0.0586 (834) | 5-year sweep pivot-matrix@240 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0228 R a trade (minimum edge 0.03) |
| rsi-macd | off | off | 104 | -0.66 | 4 | -0.83 | -0.390 | — | off in the config or by Ibrahim: the rule does not switch it on |
| rsi-macd-trend-12h | shadow | **trade** | 1 | -1.01 | 1 | -1.00 | +0.070 | 0.2894 (262) | 5-year sweep rsi-macd-trend@720: 7122 trades, 0.0808 R a trade, 3/4 years positive, positive at 1.5× costs, era 2018–21 0.3664 R; live record too short to veto (1 active days) |
| session-drive | shadow | shadow | 14 | -0.04 | 5 | -0.06 | -0.087 | — | 5-year sweep session-drive@30 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0936 R a trade (minimum edge 0.03) |
| squeeze-ride | shadow | shadow | 2 | +0.27 | 1 | +1.00 | -0.005 | 0.1847 (110) | 5-year sweep squeeze-ride@5 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.0105 R a trade (minimum edge 0.03) |
| trend-pullback | off | off | 168 | -0.32 | 5 | -1.22 | -0.246 | — | off in the config or by Ibrahim: the rule does not switch it on |
| trend-pullback-1h | off | off | 4 | -0.42 | 2 | -0.41 | +0.009 | -0.0286 (495) | off in the config or by Ibrahim: the rule does not switch it on |
| wyckoff-spring | off | off | 0 | — | 0 | — | — | — | off in the config or by Ibrahim: the rule does not switch it on |
| wyckoff-spring-1h | shadow | shadow | 83 | +0.08 | 4 | +0.13 | -0.027 | — | 5-year sweep wyckoff-spring@60 fails the gate: negative at 1.5× costs, 0/4 years positive, -0.1166 R a trade (minimum edge 0.03) |
| wyckoff-spring-4h | shadow | shadow | 4 | -0.04 | 2 | -0.04 | -0.039 | 0.0092 (427) | 5-year sweep wyckoff-spring@240 fails the gate: negative at 1.5× costs, 1/4 years positive, -0.0392 R a trade (minimum edge 0.03) |
| wykoff-spring | off | off | 0 | — | 0 | — | — | — | off in the config or by Ibrahim: the rule does not switch it on |
