# Strategy factory — latest test

Tested 2026-10-24T09:05Z on 31 coins, 2026-04-01 → 2026-10-21. Variants tried so far: 415 → t-stat bar 3.31.

| Strategy | Origin | Trades | Avg R | t | Avg R at 1.5× costs | Thirds (sum R) | Backtest gate |
|---|---|---|---|---|---|---|---|
| intraday-trend | config | 7899 | -0.1215 | -10.33 | -0.1672 | -365.82 / -270.24 / -323.49 | average -0.1672 R at 1.5× costs (need > 0); newest third -0.1232 R (need > 0); positive in fewer than 2 of 3 thirds; t -10.33 < 3.31 (bar for 415 tries; daily-clustered) |
| crowd-squeeze | config | 26 | -0.0885 | -0.33 | -0.1268 | 7.47 / -1.15 / -8.63 | 26 trades (need 300); average -0.1268 R at 1.5× costs (need > 0); newest third -0.7188 R (need > 0); positive in fewer than 2 of 3 thirds; t -0.44 < 3.31 (bar for 415 tries; daily-clustered) |
| it-45-long | config | 721 | 0.141 | 2.53 | 0.1244 | 3.29 / 57.86 / 40.49 | t 1.36 < 3.31 (bar for 415 tries; daily-clustered) |
| it-45-hold32 | config | 1333 | 0.0188 | 0.55 | 0.0015 | -15.41 / 22.81 / 17.65 | t 0.29 < 3.31 (bar for 415 tries; daily-clustered) |
| it-45-hold16 | config | 1269 | 0.0142 | 0.51 | -0.0029 | -2.31 / 0.99 / 19.27 | average -0.0029 R at 1.5× costs (need > 0); t 0.27 < 3.31 (bar for 415 tries; daily-clustered) |
| squeeze-ride | config | 110 | 0.1847 | 2.43 | 0.1619 | 6.39 / 8.07 / 5.85 | 110 trades (need 300); t 1.61 < 3.31 (bar for 415 tries; daily-clustered) |
| ma-retest-12h | config | 54 | 0.5571 | 2.81 | 0.5526 | 9.82 / 3.82 / 16.44 | 54 trades (need 300); t 2.31 < 3.31 (bar for 415 tries; daily-clustered) |
| ma-retest-4h | config | 308 | 0.0228 | 0.3 | 0.0123 | 10.01 / -19.19 / 16.21 | t 0.22 < 3.31 (bar for 415 tries; daily-clustered) |
| ma-pullback-12h | config | 160 | 0.1368 | 1.27 | 0.1316 | 8.62 / -4.97 / 18.24 | 160 trades (need 300); t 0.79 < 3.31 (bar for 415 tries; daily-clustered) |
| ma-retest-1d | config | 0 | — | — | — |  | 0 trades (need 300); average undefined R at 1.5× costs (need > 0); newest third undefined R (need > 0); positive in fewer than 2 of 3 thirds; t undefined < 3.31 (bar for 415 tries) |
| donchian-1d-20 | config | 440 | 0.0599 | 1.36 | 0.0544 | 29.27 / -7.46 / 4.56 | t 0.77 < 3.31 (bar for 415 tries; daily-clustered) |
| donchian-1d-60 | config | 105 | 0.0964 | 1.21 | 0.0937 | -2.99 / 11.83 / 1.29 | 105 trades (need 300); t 0.79 < 3.31 (bar for 415 tries; daily-clustered) |
| donchian-1d-150 | config | 29 | 0.0024 | 0.02 | 0.0008 | -0.51 / 3.71 / -3.13 | 29 trades (need 300); newest third -0.2236 R (need > 0); positive in fewer than 2 of 3 thirds; t 0.02 < 3.31 (bar for 415 tries; daily-clustered) |
| donchian-12h-60 | config | 207 | 0.2891 | 3.9 | 0.285 | 16.7 / 34.25 / 8.89 | 207 trades (need 300); t 2.02 < 3.31 (bar for 415 tries; daily-clustered) |
| funding-fade-4h | config | 16 | -0.3009 | -1.7 | -0.3069 | -1.76 / 0 / -3.05 | 16 trades (need 300); average -0.3069 R at 1.5× costs (need > 0); newest third -0.2775 R (need > 0); positive in fewer than 2 of 3 thirds; t -1.7 < 3.31 (bar for 415 tries; daily-clustered) |
| it-4h | config | 579 | 0.0833 | 1.72 | 0.0717 | 5.06 / 58.84 / -15.7 | newest third -0.0913 R (need > 0); t 0.83 < 3.31 (bar for 415 tries; daily-clustered) |
| it-12h | config | 183 | 0.4617 | 4.12 | 0.455 | 40.08 / 30.28 / 14.13 | 183 trades (need 300); t 1.76 < 3.31 (bar for 415 tries; daily-clustered) |
| it-1d | config | 86 | 0.5554 | 3.87 | 0.5508 | 19.68 / 13.22 / 14.87 | 86 trades (need 300); t 2 < 3.31 (bar for 415 tries; daily-clustered) |
| rsi-macd-trend-12h | config | 262 | 0.2894 | 3.39 | 0.2828 | 28.24 / 19.14 / 28.45 | 262 trades (need 300); t 1.94 < 3.31 (bar for 415 tries; daily-clustered) |
| trend-pullback-1h | config | 495 | -0.0286 | -0.61 | -0.0482 | -21.03 / -4.99 / 11.88 | average -0.0482 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t -0.61 < 3.31 (bar for 415 tries; daily-clustered) |
| harmonic | config | 311 | -0.0867 | -0.96 | -0.1807 | -23.1 / -1.9 / -1.98 | average -0.1807 R at 1.5× costs (need > 0); newest third -0.0218 R (need > 0); positive in fewer than 2 of 3 thirds; t -0.96 < 3.31 (bar for 415 tries; daily-clustered) |
| krown-jewel-1h | config | 3444 | -0.0671 | -2.83 | -0.093 | -83.67 / -67.87 / -79.66 | average -0.093 R at 1.5× costs (need > 0); newest third -0.0701 R (need > 0); positive in fewer than 2 of 3 thirds; t -2.83 < 3.31 (bar for 415 tries; daily-clustered) |
| krown-jewel-2h | config | 1774 | -0.0378 | -1.15 | -0.0552 | 35 / -39.38 / -62.62 | average -0.0552 R at 1.5× costs (need > 0); newest third -0.1099 R (need > 0); positive in fewer than 2 of 3 thirds; t -1.15 < 3.31 (bar for 415 tries; daily-clustered) |
| wyckoff-spring-4h | config | 427 | 0.0092 | 0.12 | -0.0128 | 2.37 / 3.96 / -2.38 | average -0.0128 R at 1.5× costs (need > 0); newest third -0.0161 R (need > 0); t 0.1 < 3.31 (bar for 415 tries; daily-clustered) |
| pivot-matrix-4h | config | 834 | -0.0586 | -1.39 | -0.0728 | 13.32 / -45.98 / -16.18 | average -0.0728 R at 1.5× costs (need > 0); newest third -0.056 R (need > 0); positive in fewer than 2 of 3 thirds; t -1.39 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-engulfing-1h | config | 4213 | -0.2187 | -10.58 | -0.2816 | -361.49 / -335.64 / -224.34 | average -0.2816 R at 1.5× costs (need > 0); newest third -0.1594 R (need > 0); positive in fewer than 2 of 3 thirds; t -10.58 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-engulfing-4h | config | 1087 | -0.1154 | -2.86 | -0.144 | -82.32 / -9.77 / -33.39 | average -0.144 R at 1.5× costs (need > 0); newest third -0.0979 R (need > 0); positive in fewer than 2 of 3 thirds; t -2.86 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-star-4h | config | 601 | -0.0586 | -0.99 | -0.1183 | -50.25 / 12.44 / 2.61 | average -0.1183 R at 1.5× costs (need > 0); t -0.99 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-morning-star-4h | config | 174 | -0.1244 | -1.27 | -0.1461 | -17.78 / 2.35 / -6.21 | 174 trades (need 300); average -0.1461 R at 1.5× costs (need > 0); newest third -0.0928 R (need > 0); positive in fewer than 2 of 3 thirds; t -1.27 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-piercing-1h | config | 1054 | -0.1039 | -2.44 | -0.1572 | -23.05 / -23.22 / -63.19 | average -0.1572 R at 1.5× costs (need > 0); newest third -0.1795 R (need > 0); positive in fewer than 2 of 3 thirds; t -2.44 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-piercing-4h | config | 255 | -0.0828 | -0.99 | -0.1084 | -2.15 / -2.11 / -16.86 | 255 trades (need 300); average -0.1084 R at 1.5× costs (need > 0); newest third -0.1703 R (need > 0); positive in fewer than 2 of 3 thirds; t -0.99 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-soldiers-1h | config | 94 | -0.1012 | -1.01 | -0.1242 | -7.89 / -8.27 / 6.64 | 94 trades (need 300); average -0.1242 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t -1.01 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-soldiers-4h | config | 21 | -0.0547 | -0.24 | -0.0667 | -2.81 / 2.48 / -0.82 | 21 trades (need 300); average -0.0667 R at 1.5× costs (need > 0); newest third -0.0913 R (need > 0); positive in fewer than 2 of 3 thirds; t -0.26 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-tweezer-4h | config | 1044 | -0.0819 | -1.87 | -0.1228 | -31.25 / -60.27 / 6.04 | average -0.1228 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t -1.87 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-doji-4h | config | 66 | -0.0613 | -0.36 | -0.0872 | -1.81 / -1.67 / -0.56 | 66 trades (need 300); average -0.0872 R at 1.5× costs (need > 0); newest third -0.031 R (need > 0); positive in fewer than 2 of 3 thirds; t -0.36 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-marubozu-1h | config | 461 | 0.0081 | 0.13 | -0.026 | 8.05 / -25.03 / 20.71 | average -0.026 R at 1.5× costs (need > 0); t 0.08 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-marubozu-4h | config | 125 | 0.1853 | 1.56 | 0.1698 | 10.98 / 14.84 / -2.66 | 125 trades (need 300); newest third -0.0618 R (need > 0); t 1.28 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-three-inside-1h | config | 230 | -0.1959 | -2.39 | -0.2336 | -11.88 / -27.74 / -5.44 | 230 trades (need 300); average -0.2336 R at 1.5× costs (need > 0); newest third -0.0777 R (need > 0); positive in fewer than 2 of 3 thirds; t -2.39 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-three-inside-4h | config | 51 | -0.2893 | -1.84 | -0.3102 | -9.46 / 4.21 / -9.5 | 51 trades (need 300); average -0.3102 R at 1.5× costs (need > 0); newest third -0.559 R (need > 0); positive in fewer than 2 of 3 thirds; t -1.84 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-three-outside-4h | config | 581 | -0.0601 | -1.16 | -0.0826 | -27.02 / 17.97 / -25.86 | average -0.0826 R at 1.5× costs (need > 0); newest third -0.1312 R (need > 0); positive in fewer than 2 of 3 thirds; t -1.16 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-three-methods-1h | config | 43 | 0.303 | 1.48 | 0.2734 | 2.41 / 0.18 / 10.43 | 43 trades (need 300); t 1.3 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-three-methods-4h | config | 11 | -0.2013 | -0.67 | -0.2133 | -0.18 / -2.12 / 0.09 | 11 trades (need 300); average -0.2133 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t -0.77 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-doji-star-1h | config | 146 | -0.1914 | -1.82 | -0.2329 | -18.42 / 1.74 / -11.26 | 146 trades (need 300); average -0.2329 R at 1.5× costs (need > 0); newest third -0.2619 R (need > 0); positive in fewer than 2 of 3 thirds; t -1.82 < 3.31 (bar for 415 tries; daily-clustered) |
| candle-doji-star-4h | config | 36 | 0.4284 | 1.77 | 0.4114 | 4.53 / 5.58 / 5.31 | 36 trades (need 300); t 1.76 < 3.31 (bar for 415 tries; daily-clustered) |
| adaptive-score-12h | config | 295 | -0.0577 | -0.74 | -0.0677 | -22.89 / -5.06 / 10.95 | 295 trades (need 300); average -0.0677 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t -0.74 < 3.31 (bar for 415 tries; daily-clustered) |
| ma-retest-4h-golden | config | 188 | 0.1112 | 1.15 | 0.1026 | 0.18 / 0.66 / 20.07 | 188 trades (need 300); t 0.95 < 3.31 (bar for 415 tries; daily-clustered) |
| ma-retest-12h-golden-fib | config | 37 | 0.9448 | 2.86 | 0.9408 | 9.46 / 22.69 / 2.81 | 37 trades (need 300); t 2.28 < 3.31 (bar for 415 tries; daily-clustered) |
| ma-retest-1d-golden | config | 0 | — | — | — |  | 0 trades (need 300); average undefined R at 1.5× costs (need > 0); newest third undefined R (need > 0); positive in fewer than 2 of 3 thirds; t undefined < 3.31 (bar for 415 tries) |
