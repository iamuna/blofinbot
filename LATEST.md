# Strategy factory — latest test

Tested 2026-10-20T06:52Z on 31 coins, 2026-04-01 → 2026-10-18. Variants tried so far: 63 → t-stat bar 2.90.

| Strategy | Origin | Trades | Avg R | t | Avg R at 1.5× costs | Thirds (sum R) | Backtest gate |
|---|---|---|---|---|---|---|---|
| intraday-trend | config | 7794 | -0.1181 | -9.96 | -0.1639 | -347.22 / -342.48 / -230.89 | average -0.1639 R at 1.5× costs (need > 0); newest third -0.0873 R (need > 0); positive in fewer than 2 of 3 thirds; t -9.96 < 2.90 (bar for 63 tries) |
| trend-pullback | config | 11593 | -0.1729 | -16.26 | -0.2502 | -642.3 / -793.31 / -568.7 | average -0.2502 R at 1.5× costs (need > 0); newest third -0.1398 R (need > 0); positive in fewer than 2 of 3 thirds; t -16.26 < 2.90 (bar for 63 tries) |
| session-drive | config | 917 | -0.1732 | -5.01 | -0.2138 | -33.05 / -76.63 / -49.11 | average -0.2138 R at 1.5× costs (need > 0); newest third -0.198 R (need > 0); positive in fewer than 2 of 3 thirds; t -5.01 < 2.90 (bar for 63 tries) |
| overshoot-fade | config | 4700 | -0.3528 | -14.2 | -0.5493 | -618.84 / -379 / -660.2 | average -0.5493 R at 1.5× costs (need > 0); newest third -0.3185 R (need > 0); positive in fewer than 2 of 3 thirds; t -14.2 < 2.90 (bar for 63 tries) |
| leader-follow | config | 1543 | -0.2833 | -11.86 | -0.4547 | -152.1 / -124.13 / -160.95 | average -0.4547 R at 1.5× costs (need > 0); newest third -0.2495 R (need > 0); positive in fewer than 2 of 3 thirds; t -11.86 < 2.90 (bar for 63 tries) |
| crowd-squeeze | config | 26 | -0.0885 | -0.33 | -0.1268 | 7.47 / -1.15 / -8.63 | 26 trades (need 300); average -0.1268 R at 1.5× costs (need > 0); newest third -0.7188 R (need > 0); positive in fewer than 2 of 3 thirds; t -0.33 < 2.90 (bar for 63 tries) |
| noise-breakout | config | 32524 | -0.302 | -46.53 | -0.4171 | -3388.32 / -3289.07 / -3143.29 | average -0.4171 R at 1.5× costs (need > 0); newest third -0.2711 R (need > 0); positive in fewer than 2 of 3 thirds; t -46.53 < 2.90 (bar for 63 tries) |
| it-45-long | config | 716 | 0.1406 | 2.52 | 0.124 | 3.62 / -21 / 118.03 | t 2.52 < 2.90 (bar for 63 tries) |
| it-45-hold32 | config | 1328 | 0.0208 | 0.61 | 0.0034 | -11.8 / -35.21 / 74.57 | positive in fewer than 2 of 3 thirds; t 0.61 < 2.90 (bar for 63 tries) |
| it-45-hold16 | config | 1264 | 0.0145 | 0.52 | -0.0026 | -0.06 / -29 / 47.37 | average -0.0026 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t 0.52 < 2.90 (bar for 63 tries) |
| squeeze-ride | config | 104 | 0.2175 | 2.8 | 0.1946 | 6.39 / 4.63 / 11.6 | 104 trades (need 300); t 2.8 < 2.90 (bar for 63 tries) |
