# Era test 2026-10-23: Binance spot, 2017-08 → 2021-09, trades from 2018-03-01

Coins: BTC ETH BNB XRP ADA LTC LINK TRX XLM EOS ETC NEO. Spot: no funding. "+be" = stop to break-even at +1 R. Test column: trades from 2020-01-01.

Data 2017-08-17 → 2021-09-30, 12 coins; trades counted from 2018-03-01. Costs: maker 2 bps, taker 6 bps, slippage 1.5 bps per taker side, funding charged.

| Strategy | Trades | Per day | Win rate | Avg net bps | Avg R | t-stat | PF | Max DD (R) | Sharpe | Avg R at 1.5× costs | Thirds (sum R) | Test: n / avg R / t |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ma-retest-12h | 243 | 0.19 | 50% | 303.89 | 0.2966 | 3.38 | 1.6 | 17.63 | 1.38 | 0.2928 | -1.77 / 47.36 / 26.5 | 147 / 0.3413 / 3.01 |
| ma-retest-12h+be | 260 | 0.2 | 42% | 313.84 | 0.3097 | 3.95 | 1.81 | 16.61 | 1.61 | 0.3057 | 1.95 / 40.73 / 37.83 | 160 / 0.39 / 3.88 |
| ma-retest-1d | 145 | 0.12 | 30% | -379.94 | -0.1639 | -1.53 | 0.76 | 41.37 | -0.63 | -0.1669 | 13.87 / -24.77 / -12.87 | 100 / -0.3406 / -2.84 |
| ma-retest-1d+be | 156 | 0.13 | 26% | -260.71 | -0.0964 | -0.98 | 0.83 | 41.83 | -0.41 | -0.0994 | 13.84 / -22.91 / -5.96 | 106 / -0.2821 / -2.55 |
| ma-retest-4h | 774 | 0.59 | 42% | 53.34 | 0.1336 | 2.76 | 1.24 | 34.25 | 1.11 | 0.1254 | 24.46 / 41.16 / 37.76 | 431 / 0.1081 / 1.66 |
| ma-retest-4h+be | 832 | 0.64 | 35% | 47.52 | 0.1281 | 2.96 | 1.28 | 29.14 | 1.19 | 0.1197 | 23.62 / 45.54 / 37.42 | 469 / 0.1031 / 1.78 |
| ma-pullback-12h | 705 | 0.54 | 44% | 125.8 | 0.1524 | 3.05 | 1.29 | 48.91 | 1.14 | 0.1487 | 2.04 / 57.21 / 48.17 | 385 / 0.1064 / 1.58 |
| ma-pullback-12h+be | 743 | 0.57 | 38% | 145.98 | 0.1719 | 3.76 | 1.39 | 47.9 | 1.44 | 0.1681 | 11.16 / 59.84 / 56.71 | 408 / 0.109 / 1.77 |
| rsi-macd-trend-12h | 715 | 0.55 | 51% | 263.4 | 0.3716 | 7.2 | 1.8 | 21.53 | 2.49 | 0.3664 | 38.04 / 141.54 / 86.1 | 385 / 0.4003 / 5.66 |
| rsi-macd-trend-12h+be | 754 | 0.58 | 40% | 210.63 | 0.2995 | 6.49 | 1.77 | 18.1 | 2.22 | 0.2941 | 34.51 / 105.66 / 85.65 | 410 / 0.363 / 5.8 |
| donchian-1d-20 | 1080 | 0.83 | 42% | 99.2 | 0.1153 | 4.44 | 1.47 | 25.59 | 1.5 | 0.1115 | 34.02 / 68.64 / 21.89 | 604 / 0.1228 / 3.55 |
| donchian-1d-20+be | 1080 | 0.83 | 42% | 99.2 | 0.1153 | 4.44 | 1.47 | 25.59 | 1.5 | 0.1115 | 34.02 / 68.64 / 21.89 | 604 / 0.1228 / 3.55 |
| adaptive-score-4h | 4285 | 3.28 | 41% | 28.5 | 0.1093 | 5.21 | 1.18 | 79.36 | 1.53 | 0.096 | 137.97 / 103.76 / 226.65 | 2418 / 0.1093 / 3.93 |
| adaptive-score-4h+be | 4697 | 3.59 | 33% | 23.79 | 0.0927 | 5.16 | 1.19 | 69.12 | 1.54 | 0.0786 | 133.75 / 118.08 / 183.55 | 2658 / 0.0868 / 3.66 |
| adaptive-score-12h | 1270 | 0.98 | 44% | 87.47 | 0.1939 | 5.02 | 1.34 | 40.2 | 1.72 | 0.1867 | 17.49 / 90.77 / 138.04 | 787 / 0.2205 / 4.47 |
| adaptive-score-12h+be | 1367 | 1.05 | 35% | 71.49 | 0.1629 | 4.9 | 1.36 | 36.33 | 1.71 | 0.1552 | 26.82 / 70.4 / 125.44 | 848 / 0.1823 / 4.29 |

## Loss-streak rule (half size after 3 losses, skip after 6)

```
era/trades-adaptive-score-12h+be.csv: 1367 trades, win rate 35%, longest losing run 23 (≈ 14.5 expected by chance)
  without rule: 222.65 R, max DD 36.33 R, R/DD 6.13
  with rule:    149.12 R, max DD 29.35 R, R/DD 5.08 (296 trades at reduced size, 277 skipped)
era/trades-adaptive-score-12h.csv: 1270 trades, win rate 44%, longest losing run 18 (≈ 11.0 expected by chance)
  without rule: 246.3 R, max DD 40.2 R, R/DD 6.13
  with rule:    159.97 R, max DD 31.13 R, R/DD 5.14 (208 trades at reduced size, 175 skipped)
era/trades-adaptive-score-4h+be.csv: 4697 trades, win rate 33%, longest losing run 41 (≈ 18.2 expected by chance)
  without rule: 435.38 R, max DD 69.12 R, R/DD 6.3
  with rule:    338.27 R, max DD 70.24 R, R/DD 4.82 (789 trades at reduced size, 1221 skipped)
era/trades-adaptive-score-4h.csv: 4285 trades, win rate 41%, longest losing run 38 (≈ 14.1 expected by chance)
  without rule: 468.38 R, max DD 79.36 R, R/DD 5.9
  with rule:    360.29 R, max DD 88.75 R, R/DD 4.06 (640 trades at reduced size, 766 skipped)
era/trades-donchian-1d-20+be.csv: 1080 trades, win rate 42%, longest losing run 21 (≈ 11.3 expected by chance)
  without rule: 124.56 R, max DD 25.59 R, R/DD 4.87
  with rule:    100.42 R, max DD 17.09 R, R/DD 5.88 (176 trades at reduced size, 178 skipped)
era/trades-donchian-1d-20.csv: 1080 trades, win rate 42%, longest losing run 21 (≈ 11.3 expected by chance)
  without rule: 124.56 R, max DD 25.59 R, R/DD 4.87
  with rule:    100.42 R, max DD 17.09 R, R/DD 5.88 (176 trades at reduced size, 178 skipped)
era/trades-ma-pullback-12h+be.csv: 743 trades, win rate 38%, longest losing run 32 (≈ 11.9 expected by chance)
  without rule: 127.7 R, max DD 47.9 R, R/DD 2.67
  with rule:    110.49 R, max DD 18.65 R, R/DD 5.92 (122 trades at reduced size, 169 skipped)
era/trades-ma-pullback-12h.csv: 705 trades, win rate 44%, longest losing run 31 (≈ 9.9 expected by chance)
  without rule: 107.42 R, max DD 48.91 R, R/DD 2.2
  with rule:    93.31 R, max DD 20.21 R, R/DD 4.62 (90 trades at reduced size, 111 skipped)
era/trades-ma-retest-12h+be.csv: 260 trades, win rate 42%, longest losing run 19 (≈ 8.7 expected by chance)
  without rule: 80.51 R, max DD 16.61 R, R/DD 4.85
  with rule:    73.38 R, max DD 11.56 R, R/DD 6.35 (32 trades at reduced size, 26 skipped)
era/trades-ma-retest-12h.csv: 243 trades, win rate 50%, longest losing run 18 (≈ 7.0 expected by chance)
  without rule: 72.08 R, max DD 17.63 R, R/DD 4.09
  with rule:    73.99 R, max DD 11.56 R, R/DD 6.4 (17 trades at reduced size, 16 skipped)
era/trades-ma-retest-1d+be.csv: 156 trades, win rate 26%, longest losing run 33 (≈ 12.5 expected by chance)
  without rule: -15.04 R, max DD 41.83 R, R/DD -0.36
  with rule:    -4.74 R, max DD 19.14 R, R/DD -0.25 (33 trades at reduced size, 49 skipped)
era/trades-ma-retest-1d.csv: 145 trades, win rate 30%, longest losing run 32 (≈ 10.5 expected by chance)
  without rule: -23.77 R, max DD 41.37 R, R/DD -0.57
  with rule:    -13.43 R, max DD 25.3 R, R/DD -0.53 (15 trades at reduced size, 49 skipped)
era/trades-ma-retest-4h+be.csv: 832 trades, win rate 35%, longest losing run 17 (≈ 13.1 expected by chance)
  without rule: 106.58 R, max DD 29.14 R, R/DD 3.66
  with rule:    64.39 R, max DD 28.19 R, R/DD 2.28 (163 trades at reduced size, 144 skipped)
era/trades-ma-retest-4h.csv: 774 trades, win rate 42%, longest losing run 15 (≈ 10.5 expected by chance)
  without rule: 103.37 R, max DD 34.25 R, R/DD 3.02
  with rule:    68.4 R, max DD 35.22 R, R/DD 1.94 (124 trades at reduced size, 83 skipped)
era/trades-rsi-macd-trend-12h+be.csv: 754 trades, win rate 40%, longest losing run 16 (≈ 11.2 expected by chance)
  without rule: 225.82 R, max DD 18.1 R, R/DD 12.47
  with rule:    140.23 R, max DD 11.81 R, R/DD 11.87 (140 trades at reduced size, 154 skipped)
era/trades-rsi-macd-trend-12h.csv: 715 trades, win rate 51%, longest losing run 10 (≈ 8.3 expected by chance)
  without rule: 265.68 R, max DD 21.53 R, R/DD 12.34
  with rule:    230.98 R, max DD 17.06 R, R/DD 13.54 (105 trades at reduced size, 71 skipped)
```
