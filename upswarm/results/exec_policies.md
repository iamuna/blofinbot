# Entry policies for the slow strategies

The same strategies, four ways to enter. 6.5 months × 31 coins (branch swarm-data), live code path, BloFin costs. Produced by `node upswarm/tools/trades_run.js --set exec` and `trade_stats.js`. Policies: `cur` = as configured; `chase3cancel` = post at the best price, follow it, cancel after 3 minutes; `chase30taker` = the same for 30 minutes, then a market order; `taker` = market order at the next bar.

| Variant | Ideas | Unfilled | Trades | Avg R | t | Sum R | Avg cost bps |
|---|---|---|---|---|---|---|---|
| ma-retest-4h · entry cur | 316 | 0 | 308 | 0.0228 | 0.3 | 7.03 | 10.15 |
| ma-retest-4h · entry chase3cancel | 316 | 0 | 308 | 0.0228 | 0.3 | 7.03 | 10.15 |
| ma-retest-4h · entry chase30taker | 316 | 0 | 308 | 0.0228 | 0.3 | 7.03 | 10.15 |
| ma-retest-4h · entry taker | 316 | 0 | 308 | 0.0087 | 0.11 | 2.68 | 15.65 |
| ma-retest-12h · entry cur | 58 | 1 | 54 | 0.5571 | 2.81 | 30.08 | 17.26 |
| ma-retest-12h · entry chase3cancel | 58 | 1 | 54 | 0.5571 | 2.81 | 30.08 | 17.26 |
| ma-retest-12h · entry chase30taker | 57 | 0 | 54 | 0.5563 | 2.8 | 30.04 | 17.64 |
| ma-retest-12h · entry taker | 57 | 0 | 54 | 0.5522 | 2.78 | 29.82 | 23.12 |
| ma-pullback-12h · entry cur | 187 | 1 | 160 | 0.1368 | 1.27 | 21.89 | 18.29 |
| ma-pullback-12h · entry chase3cancel | 187 | 1 | 160 | 0.1368 | 1.27 | 21.89 | 18.29 |
| ma-pullback-12h · entry chase30taker | 186 | 0 | 160 | 0.1366 | 1.26 | 21.85 | 18.42 |
| ma-pullback-12h · entry taker | 186 | 0 | 160 | 0.1306 | 1.21 | 20.89 | 23.91 |
| rsi-macd-trend-12h · entry cur | 268 | 3 | 262 | 0.2894 | 3.39 | 75.82 | 11.58 |
| rsi-macd-trend-12h · entry chase3cancel | 268 | 3 | 262 | 0.2894 | 3.39 | 75.82 | 11.58 |
| rsi-macd-trend-12h · entry chase30taker | 266 | 0 | 263 | 0.2974 | 3.49 | 78.22 | 11.68 |
| rsi-macd-trend-12h · entry taker | 267 | 0 | 264 | 0.2996 | 3.5 | 79.11 | 17.24 |
| it-4h · entry cur | 617 | 0 | 579 | 0.0833 | 1.72 | 48.21 | 10.87 |
| it-4h · entry chase3cancel | 617 | 2 | 577 | 0.087 | 1.8 | 50.18 | 10.87 |
| it-4h · entry chase30taker | 617 | 0 | 579 | 0.0833 | 1.72 | 48.21 | 10.87 |
| it-4h · entry taker | 619 | 0 | 581 | 0.0765 | 1.59 | 44.45 | 16.39 |
| donchian-12h-60 · entry cur | 210 | 0 | 207 | 0.2891 | 3.9 | 59.85 | 17.47 |
| donchian-12h-60 · entry chase3cancel | 211 | 1 | 207 | 0.2891 | 3.9 | 59.84 | 17.47 |
| donchian-12h-60 · entry chase30taker | 210 | 0 | 207 | 0.2891 | 3.9 | 59.85 | 17.47 |
| donchian-12h-60 · entry taker | 210 | 0 | 207 | 0.2877 | 3.87 | 59.55 | 22.99 |
| donchian-1d-20 · entry cur | 454 | 0 | 440 | 0.0599 | 1.36 | 26.37 | 13.25 |
| donchian-1d-20 · entry chase3cancel | 455 | 2 | 439 | 0.0587 | 1.33 | 25.75 | 13.25 |
| donchian-1d-20 · entry chase30taker | 454 | 0 | 440 | 0.0599 | 1.36 | 26.37 | 13.25 |
| donchian-1d-20 · entry taker | 454 | 0 | 440 | 0.0559 | 1.27 | 24.6 | 18.78 |

## Robustness

| Variant | Trades | Avg R | Sum R | 5 best trades | Without them | Median trade | Positive months | Longs / shorts (R) | Exits |
|---|---|---|---|---|---|---|---|---|---|
| ma-retest-4h · entry cur | 308 | +0.023 | +7.0 | +10.2 | -3.1 | -1.01 | 3/6 | -4.0 / +11.0 | target 85, stop 176, time 47 |
| ma-retest-4h · entry chase3cancel | 308 | +0.023 | +7.0 | +10.2 | -3.1 | -1.01 | 3/6 | -4.0 / +11.0 | target 85, stop 176, time 47 |
| ma-retest-4h · entry chase30taker | 308 | +0.023 | +7.0 | +10.2 | -3.1 | -1.01 | 3/6 | -4.0 / +11.0 | target 85, stop 176, time 47 |
| ma-retest-4h · entry taker | 308 | +0.009 | +2.7 | +10.1 | -7.4 | -1.02 | 3/6 | -5.8 / +8.5 | target 85, stop 176, time 47 |
| ma-retest-12h · entry cur | 54 | +0.557 | +30.1 | +10.0 | +20.1 | +0.68 | 3/4 | +33.1 / -3.0 | target 27, stop 24, time 3 |
| ma-retest-12h · entry chase3cancel | 54 | +0.557 | +30.1 | +10.0 | +20.1 | +0.68 | 3/4 | +33.1 / -3.0 | target 27, stop 24, time 3 |
| ma-retest-12h · entry chase30taker | 54 | +0.556 | +30.0 | +10.0 | +20.1 | +0.68 | 3/4 | +33.0 / -3.0 | target 27, stop 24, time 3 |
| ma-retest-12h · entry taker | 54 | +0.552 | +29.8 | +10.0 | +19.9 | +0.67 | 3/4 | +32.9 / -3.1 | target 27, stop 24, time 3 |
| ma-pullback-12h · entry cur | 160 | +0.137 | +21.9 | +10.0 | +11.9 | -0.98 | 2/4 | +39.2 / -17.3 | stop 86, target 53, time 21 |
| ma-pullback-12h · entry chase3cancel | 160 | +0.137 | +21.9 | +10.0 | +11.9 | -0.98 | 2/4 | +39.2 / -17.3 | stop 86, target 53, time 21 |
| ma-pullback-12h · entry chase30taker | 160 | +0.137 | +21.8 | +10.0 | +11.8 | -0.98 | 2/4 | +39.1 / -17.3 | stop 86, target 53, time 21 |
| ma-pullback-12h · entry taker | 160 | +0.131 | +20.9 | +10.0 | +10.9 | -0.98 | 2/4 | +38.6 / -17.7 | stop 86, target 53, time 21 |
| rsi-macd-trend-12h · entry cur | 262 | +0.289 | +75.8 | +10.1 | +65.7 | -0.29 | 3/6 | +60.4 / +15.4 | stop 125, target 95, time 42 |
| rsi-macd-trend-12h · entry chase3cancel | 262 | +0.289 | +75.8 | +10.1 | +65.7 | -0.29 | 3/6 | +60.4 / +15.4 | stop 125, target 95, time 42 |
| rsi-macd-trend-12h · entry chase30taker | 263 | +0.297 | +78.2 | +10.1 | +68.1 | -0.25 | 3/6 | +60.4 / +17.8 | stop 125, target 96, time 42 |
| rsi-macd-trend-12h · entry taker | 264 | +0.300 | +79.1 | +10.1 | +69.0 | -0.22 | 3/6 | +61.1 / +18.0 | stop 125, target 97, time 42 |
| it-4h · entry cur | 579 | +0.083 | +48.2 | +26.1 | +22.1 | -0.12 | 3/7 | +72.2 / -24.0 | stop 245, time 334 |
| it-4h · entry chase3cancel | 577 | +0.087 | +50.2 | +26.1 | +24.1 | -0.12 | 3/7 | +73.3 / -23.1 | stop 244, time 333 |
| it-4h · entry chase30taker | 579 | +0.083 | +48.2 | +26.1 | +22.1 | -0.12 | 3/7 | +72.2 / -24.0 | stop 245, time 334 |
| it-4h · entry taker | 581 | +0.077 | +44.5 | +25.8 | +18.6 | -0.13 | 3/7 | +70.5 / -26.0 | stop 245, time 336 |
| donchian-12h-60 · entry cur | 207 | +0.289 | +59.8 | +19.6 | +40.3 | -0.05 | 3/6 | +59.8 / +0.0 | stop 207 |
| donchian-12h-60 · entry chase3cancel | 207 | +0.289 | +59.8 | +19.6 | +40.3 | -0.05 | 3/6 | +59.8 / +0.0 | stop 207 |
| donchian-12h-60 · entry chase30taker | 207 | +0.289 | +59.8 | +19.6 | +40.3 | -0.05 | 3/6 | +59.8 / +0.0 | stop 207 |
| donchian-12h-60 · entry taker | 207 | +0.288 | +59.5 | +19.6 | +40.0 | -0.05 | 3/6 | +59.5 / +0.0 | stop 207 |
| donchian-1d-20 · entry cur | 440 | +0.060 | +26.4 | +20.9 | +5.5 | -0.21 | 4/7 | +31.3 / -4.9 | stop 439, time 1 |
| donchian-1d-20 · entry chase3cancel | 439 | +0.059 | +25.7 | +20.9 | +4.9 | -0.21 | 4/7 | +30.6 / -4.9 | stop 438, time 1 |
| donchian-1d-20 · entry chase30taker | 440 | +0.060 | +26.4 | +20.9 | +5.5 | -0.21 | 4/7 | +31.3 / -4.9 | stop 439, time 1 |
| donchian-1d-20 · entry taker | 440 | +0.056 | +24.6 | +20.9 | +3.7 | -0.22 | 4/7 | +30.4 / -5.8 | stop 439, time 1 |

