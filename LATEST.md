# Strategy factory — latest test

Tested 2026-10-21T02:26Z on 31 coins, 2026-04-01 → 2026-10-18. Variants tried so far: 210 → t-stat bar 3.16.

| Strategy | Origin | Trades | Avg R | t | Avg R at 1.5× costs | Thirds (sum R) | Backtest gate |
|---|---|---|---|---|---|---|---|
| intraday-trend | config | 7794 | -0.1181 | -9.96 | -0.1639 | -347.22 / -342.43 / -230.89 | average -0.1639 R at 1.5× costs (need > 0); newest third -0.0873 R (need > 0); positive in fewer than 2 of 3 thirds; t -9.96 < 3.16 (bar for 210 tries) |
| trend-pullback | config | 11593 | -0.171 | -16.14 | -0.2475 | -642.08 / -775.25 / -565.54 | average -0.2475 R at 1.5× costs (need > 0); newest third -0.1391 R (need > 0); positive in fewer than 2 of 3 thirds; t -16.14 < 3.16 (bar for 210 tries) |
| session-drive | config | 917 | -0.1732 | -5.01 | -0.2138 | -33.05 / -76.63 / -49.11 | average -0.2138 R at 1.5× costs (need > 0); newest third -0.198 R (need > 0); positive in fewer than 2 of 3 thirds; t -5.01 < 3.16 (bar for 210 tries) |
| overshoot-fade | config | 4700 | -0.3385 | -14.1 | -0.5263 | -589.3 / -361.3 / -640.16 | average -0.5263 R at 1.5× costs (need > 0); newest third -0.3088 R (need > 0); positive in fewer than 2 of 3 thirds; t -14.1 < 3.16 (bar for 210 tries) |
| leader-follow | config | 1543 | -0.283 | -11.86 | -0.4543 | -152.07 / -124.13 / -160.49 | average -0.4543 R at 1.5× costs (need > 0); newest third -0.2488 R (need > 0); positive in fewer than 2 of 3 thirds; t -11.86 < 3.16 (bar for 210 tries) |
| crowd-squeeze | config | 26 | -0.0885 | -0.33 | -0.1268 | 7.47 / -1.15 / -8.63 | 26 trades (need 300); average -0.1268 R at 1.5× costs (need > 0); newest third -0.7188 R (need > 0); positive in fewer than 2 of 3 thirds; t -0.33 < 3.16 (bar for 210 tries) |
| noise-breakout | config | 32524 | -0.3 | -47.55 | -0.4142 | -3336.48 / -3278.53 / -3143.29 | average -0.4142 R at 1.5× costs (need > 0); newest third -0.2711 R (need > 0); positive in fewer than 2 of 3 thirds; t -47.55 < 3.16 (bar for 210 tries) |
| it-45-long | config | 716 | 0.1406 | 2.52 | 0.124 | 3.62 / -21 / 118.03 | t 2.52 < 3.16 (bar for 210 tries) |
| it-45-hold32 | config | 1328 | 0.0208 | 0.61 | 0.0034 | -11.8 / -35.21 / 74.57 | positive in fewer than 2 of 3 thirds; t 0.61 < 3.16 (bar for 210 tries) |
| it-45-hold16 | config | 1264 | 0.0145 | 0.52 | -0.0026 | -0.06 / -29 / 47.37 | average -0.0026 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t 0.52 < 3.16 (bar for 210 tries) |
| squeeze-ride | config | 104 | 0.2175 | 2.8 | 0.1946 | 6.39 / 4.63 / 11.6 | 104 trades (need 300); t 2.8 < 3.16 (bar for 210 tries) |
| ma-retest-12h | config | 54 | 0.5571 | 2.81 | 0.5526 | 9.82 / 3.82 / 16.44 | 54 trades (need 300); t 2.81 < 3.16 (bar for 210 tries) |
| ma-retest-1d | config | 0 | — | — | — |  | 0 trades (need 300); average undefined R at 1.5× costs (need > 0); newest third undefined R (need > 0); positive in fewer than 2 of 3 thirds; t undefined < 3.16 (bar for 210 tries) |
| it-4h | config | 577 | 0.0847 | 1.75 | 0.0732 | 7.08 / -9.75 / 51.54 | t 1.75 < 3.16 (bar for 210 tries) |
| rsi-macd-trend-12h | config | 259 | 0.3045 | 3.55 | 0.298 | 30.32 / 15.17 / 33.38 | 259 trades (need 300) |
| trend-pullback-1h | config | 478 | -0.0194 | -0.4 | -0.0389 | -21.03 / -4.99 / 16.75 | average -0.0389 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t -0.4 < 3.16 (bar for 210 tries) |
| dip-reversal | config | 3729 | -0.1232 | -10.56 | -0.1632 | -143.3 / -232.84 / -83.34 | average -0.1632 R at 1.5× costs (need > 0); newest third -0.0628 R (need > 0); positive in fewer than 2 of 3 thirds; t -10.56 < 3.16 (bar for 210 tries) |
| harmonic | config | 307 | -0.0717 | -0.79 | -0.1654 | -17.01 / -9.84 / 4.83 | average -0.1654 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t -0.79 < 3.16 (bar for 210 tries) |
| ma-21-200 | config | 6395 | -0.106 | -6.28 | -0.1566 | -244.98 / -335.68 / -97.07 | average -0.1566 R at 1.5× costs (need > 0); newest third -0.047 R (need > 0); positive in fewer than 2 of 3 thirds; t -6.28 < 3.16 (bar for 210 tries) |
| rsi-macd | config | 3901 | -0.1019 | -4.86 | -0.188 | -77.55 / -113.18 / -206.72 | average -0.188 R at 1.5× costs (need > 0); newest third -0.1522 R (need > 0); positive in fewer than 2 of 3 thirds; t -4.86 < 3.16 (bar for 210 tries) |
| krown-jewel-1h | config | 3396 | -0.0702 | -2.95 | -0.0961 | -86.28 / -169.67 / 17.54 | average -0.0961 R at 1.5× costs (need > 0); positive in fewer than 2 of 3 thirds; t -2.95 < 3.16 (bar for 210 tries) |
| krown-jewel-2h | config | 1741 | -0.0254 | -0.76 | -0.0428 | 36.19 / -77.74 / -2.62 | average -0.0428 R at 1.5× costs (need > 0); newest third -0.0047 R (need > 0); positive in fewer than 2 of 3 thirds; t -0.76 < 3.16 (bar for 210 tries) |
