# Strategy factory — latest test

Tested 2026-10-20T16:10Z on 31 coins, 2026-04-01 → 2026-10-18. Variants tried so far: 204 → t-stat bar 3.15.

| Strategy | Origin | Trades | Avg R | t | Avg R at 1.5× costs | Thirds (sum R) | Backtest gate |
|---|---|---|---|---|---|---|---|
| ma-retest-12h | config | 54 | 0.5571 | 2.81 | 0.5526 | 9.82 / 3.82 / 16.44 | 54 trades (need 300); t 2.81 < 3.15 (bar for 204 tries) |
| ma-retest-1d | config | 0 | — | — | — |  | 0 trades (need 300); average undefined R at 1.5× costs (need > 0); newest third undefined R (need > 0); positive in fewer than 2 of 3 thirds; t undefined < 3.15 (bar for 204 tries) |
| it-4h | config | 577 | 0.0847 | 1.75 | 0.0732 | 7.08 / -9.75 / 51.54 | t 1.75 < 3.15 (bar for 204 tries) |
| rsi-macd-trend-12h | config | 259 | 0.3045 | 3.55 | 0.298 | 30.32 / 15.17 / 33.38 | 259 trades (need 300) |
| trend-pullback-1h | config | 478 | -0.0194 | -0.4 | -0.0389 | -21.03 / -4.99 / 16.75 | average -0.0389 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t -0.4 < 3.15 (bar for 204 tries) |
