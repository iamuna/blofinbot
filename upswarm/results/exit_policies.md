# Exit policies for the slow strategies

The same entries, four ways to exit (stop distance unchanged, so R is comparable). 6.5 months × 31 coins (branch swarm-data), live code path, BloFin costs. Produced by `node upswarm/tools/trades_run.js --set exits` and `trade_stats.js`. Policies: `cur` = as configured (ma-21-200 and rsi-macd: target 2R; intraday-trend: 3 ATR trail after +1R; donchian: trail half the channel); `noTarget` = no target, exit on the stop or the time stop; `chandelier3` = no target, trail 3 ATR behind the best close once +1R; `trail1R` = no target, trail at the initial risk distance from the start.

**Read with care:** 6.5 months of one market phase, on coins chosen by today's volume (they rose ~80% on average: long tails are flattered). The extra R of `noTarget` comes mostly from a few long trades — check the "5 best trades" and "Without them" columns. Not a result to trade on before the 5-year sweep (dead coins included) confirms it.

| Variant | Ideas | Unfilled | Trades | Avg R | t | Sum R | Avg cost bps |
|---|---|---|---|---|---|---|---|
| ma-retest-4h · exit cur | 316 | 0 | 308 | 0.0228 | 0.3 | 7.03 | 10.15 |
| ma-retest-4h · exit noTarget | 262 | 0 | 254 | 0.6184 | 1.43 | 157.07 | 13.24 |
| ma-retest-4h · exit chandelier3 | 314 | 0 | 307 | -0.0058 | -0.06 | -1.78 | 12 |
| ma-retest-4h · exit trail1R | 394 | 0 | 390 | -0.0226 | -0.43 | -8.81 | 11.37 |
| ma-retest-12h · exit cur | 58 | 1 | 54 | 0.5571 | 2.81 | 30.08 | 17.26 |
| ma-retest-12h · exit noTarget | 48 | 1 | 44 | 1.3221 | 2.66 | 58.17 | 29.65 |
| ma-retest-12h · exit chandelier3 | 58 | 1 | 54 | 0.5439 | 1.89 | 29.37 | 19.22 |
| ma-retest-12h · exit trail1R | 74 | 0 | 71 | 0.275 | 2.04 | 19.52 | 16.09 |
| ma-pullback-12h · exit cur | 187 | 1 | 160 | 0.1368 | 1.27 | 21.89 | 18.29 |
| ma-pullback-12h · exit noTarget | 156 | 2 | 127 | 0.3861 | 1.71 | 49.03 | 26.44 |
| ma-pullback-12h · exit chandelier3 | 190 | 2 | 163 | 0.209 | 1.56 | 34.06 | 20.54 |
| ma-pullback-12h · exit trail1R | 249 | 1 | 223 | 0.1131 | 1.65 | 25.22 | 17.08 |
| rsi-macd-trend-12h · exit cur | 268 | 3 | 262 | 0.2894 | 3.39 | 75.82 | 11.58 |
| rsi-macd-trend-12h · exit noTarget | 251 | 3 | 244 | 0.7217 | 2.43 | 176.1 | 17.52 |
| rsi-macd-trend-12h · exit chandelier3 | 262 | 3 | 256 | 0.5351 | 3.88 | 136.98 | 15.5 |
| rsi-macd-trend-12h · exit trail1R | 321 | 3 | 315 | 0.181 | 2.54 | 57.01 | 12.84 |
| it-4h · exit cur | 617 | 0 | 579 | 0.0833 | 1.72 | 48.21 | 10.87 |
| it-4h · exit noTarget | 617 | 0 | 579 | 0.0833 | 1.72 | 48.21 | 10.87 |
| it-4h · exit chandelier3 | 617 | 0 | 579 | 0.0833 | 1.72 | 48.21 | 10.87 |
| it-4h · exit trail1R | 644 | 0 | 605 | 0.054 | 1.3 | 32.67 | 10.64 |
| donchian-12h-60 · exit cur | 210 | 0 | 207 | 0.2891 | 3.9 | 59.85 | 17.47 |
| donchian-12h-60 · exit noTarget | 210 | 0 | 207 | 0.2891 | 3.9 | 59.85 | 17.47 |
| donchian-12h-60 · exit chandelier3 | 151 | 0 | 137 | 0.4992 | 3.86 | 68.38 | 27.95 |
| donchian-12h-60 · exit trail1R | 180 | 0 | 174 | 0.3247 | 3.41 | 56.49 | 20.87 |
| donchian-1d-20 · exit cur | 454 | 0 | 440 | 0.0599 | 1.36 | 26.37 | 13.25 |
| donchian-1d-20 · exit noTarget | 454 | 0 | 440 | 0.0599 | 1.36 | 26.37 | 13.25 |
| donchian-1d-20 · exit chandelier3 | 237 | 0 | 209 | 0.3183 | 2.25 | 66.53 | 21.68 |
| donchian-1d-20 · exit trail1R | 362 | 0 | 342 | 0.1684 | 2.45 | 57.6 | 15.99 |

## Robustness

| Variant | Trades | Avg R | Sum R | 5 best trades | Without them | Median trade | Positive months | Longs / shorts (R) | Exits |
|---|---|---|---|---|---|---|---|---|---|
| ma-retest-4h · exit cur | 308 | +0.023 | +7.0 | +10.2 | -3.1 | -1.01 | 3/6 | -4.0 / +11.0 | target 85, stop 176, time 47 |
| ma-retest-4h · exit noTarget | 254 | +0.618 | +157.1 | +180.3 | -23.2 | -1.01 | 4/6 | +167.0 / -9.9 | stop 159, time 95 |
| ma-retest-4h · exit chandelier3 | 307 | -0.006 | -1.8 | +42.0 | -43.8 | -0.95 | 4/6 | +26.5 / -28.3 | stop 271, time 36 |
| ma-retest-4h · exit trail1R | 390 | -0.023 | -8.8 | +22.9 | -31.7 | -0.40 | 2/6 | +3.3 / -12.1 | stop 375, time 15 |
| ma-retest-12h · exit cur | 54 | +0.557 | +30.1 | +10.0 | +20.1 | +0.68 | 3/4 | +33.1 / -3.0 | target 27, stop 24, time 3 |
| ma-retest-12h · exit noTarget | 44 | +1.322 | +58.2 | +44.4 | +13.8 | -0.97 | 3/4 | +67.2 / -9.0 | stop 23, time 21 |
| ma-retest-12h · exit chandelier3 | 54 | +0.544 | +29.4 | +28.2 | +1.1 | -0.30 | 2/4 | +34.5 / -5.1 | stop 52, time 2 |
| ma-retest-12h · exit trail1R | 71 | +0.275 | +19.5 | +16.2 | +3.3 | -0.10 | 3/4 | +19.6 / -0.1 | stop 70, time 1 |
| ma-pullback-12h · exit cur | 160 | +0.137 | +21.9 | +10.0 | +11.9 | -0.98 | 2/4 | +39.2 / -17.3 | stop 86, target 53, time 21 |
| ma-pullback-12h · exit noTarget | 127 | +0.386 | +49.0 | +50.5 | -1.4 | -0.99 | 2/4 | +74.5 / -25.4 | stop 73, time 54 |
| ma-pullback-12h · exit chandelier3 | 163 | +0.209 | +34.1 | +32.5 | +1.6 | -0.30 | 2/4 | +47.9 / -13.9 | stop 144, time 19 |
| ma-pullback-12h · exit trail1R | 223 | +0.113 | +25.2 | +20.2 | +5.0 | -0.16 | 2/4 | +31.2 / -6.0 | stop 217, time 6 |
| rsi-macd-trend-12h · exit cur | 262 | +0.289 | +75.8 | +10.1 | +65.7 | -0.29 | 3/6 | +60.4 / +15.4 | stop 125, target 95, time 42 |
| rsi-macd-trend-12h · exit noTarget | 244 | +0.722 | +176.1 | +107.5 | +68.6 | -0.98 | 4/6 | +157.9 / +18.2 | stop 126, time 118 |
| rsi-macd-trend-12h · exit chandelier3 | 256 | +0.535 | +137.0 | +48.9 | +88.1 | -0.28 | 3/6 | +109.9 / +27.1 | stop 197, time 59 |
| rsi-macd-trend-12h · exit trail1R | 315 | +0.181 | +57.0 | +28.1 | +28.9 | -0.24 | 3/6 | +51.7 / +5.3 | stop 307, time 8 |
| it-4h · exit cur | 579 | +0.083 | +48.2 | +26.1 | +22.1 | -0.12 | 3/7 | +72.2 / -24.0 | stop 245, time 334 |
| it-4h · exit noTarget | 579 | +0.083 | +48.2 | +26.1 | +22.1 | -0.12 | 3/7 | +72.2 / -24.0 | stop 245, time 334 |
| it-4h · exit chandelier3 | 579 | +0.083 | +48.2 | +26.1 | +22.1 | -0.12 | 3/7 | +72.2 / -24.0 | stop 245, time 334 |
| it-4h · exit trail1R | 605 | +0.054 | +32.7 | +23.8 | +8.9 | -0.20 | 3/7 | +63.6 / -30.9 | stop 428, time 177 |
| donchian-12h-60 · exit cur | 207 | +0.289 | +59.8 | +19.6 | +40.3 | -0.05 | 3/6 | +59.8 / +0.0 | stop 207 |
| donchian-12h-60 · exit noTarget | 207 | +0.289 | +59.8 | +19.6 | +40.3 | -0.05 | 3/6 | +59.8 / +0.0 | stop 207 |
| donchian-12h-60 · exit chandelier3 | 137 | +0.499 | +68.4 | +23.8 | +44.6 | +0.42 | 4/6 | +68.4 / +0.0 | stop 137 |
| donchian-12h-60 · exit trail1R | 174 | +0.325 | +56.5 | +20.2 | +36.3 | -0.14 | 3/6 | +56.5 / +0.0 | stop 174 |
| donchian-1d-20 · exit cur | 440 | +0.060 | +26.4 | +20.9 | +5.5 | -0.21 | 4/7 | +31.3 / -4.9 | stop 439, time 1 |
| donchian-1d-20 · exit noTarget | 440 | +0.060 | +26.4 | +20.9 | +5.5 | -0.21 | 4/7 | +31.3 / -4.9 | stop 439, time 1 |
| donchian-1d-20 · exit chandelier3 | 209 | +0.318 | +66.5 | +44.1 | +22.5 | -0.59 | 4/7 | +65.1 / +1.4 | stop 204, time 5 |
| donchian-1d-20 · exit trail1R | 342 | +0.168 | +57.6 | +23.4 | +34.2 | -0.30 | 4/7 | +62.7 / -5.1 | stop 341, time 1 |

