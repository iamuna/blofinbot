# Selection rules compared (2026-05-25 → 2026-10-21, 21 weeks)

64 strategies, every one traded on its own in the backtest (the live code path, BloFin costs). Each rule picks, every Monday, which strategies trade that week, using only trades that closed before. R = the sum of the R of the trades entered that week by the picked strategies (equal risk per trade).

"Quality of picks" = the whole-period average R a trade of the strategies a rule had trading, weighted by weeks picked — did it choose good strategies, whatever the luck of the weeks it held them.

| Rule | Weeks positive | Total R | Avg R / week | Worst week | Best week | Trades | Avg R / trade | Strategies trading (avg) | Quality of picks |
|---|---|---|---|---|---|---|---|---|---|
| avgR±0.7 (4 days) | 6 of 13 | -65.4 | -3.1 | -79.9 | 62.8 | 912 | -0.072 | 2.1 | +0.159 R |
| avgR±0.7 (all) | 5 of 8 | 13.5 | 0.6 | -3.0 | 5.8 | 34 | 0.398 | 0.5 | +0.289 R |
| 48h ΣR ≥ +10 | 1 of 16 | -1003.3 | -47.8 | -163.9 | 30.8 | 6058 | -0.166 | 2.7 | -0.073 R |
| rolling 30d avgR > 0 | 6 of 21 | -745.8 | -35.5 | -159.5 | 174.4 | 8752 | -0.085 | 18.9 | +0.094 R |
| clustered t ≥ 2 (live record only) | 0 of 3 | -34.9 | -1.7 | -14.0 | 0.0 | 51 | -0.685 | 0.6 | +0.353 R |
| prior + live veto (proposed) | 10 of 21 | 124.6 | 5.9 | -29.8 | 104.8 | 1362 | 0.091 | 4.8 | +0.194 R |
| everything | 0 of 21 | -17605.9 | -838.4 | -1225.9 | -192.0 | 97282 | -0.181 | 64.0 | -0.047 R |
| pre-registered set (reference) | 13 of 21 | 161.0 | 7.7 | -31.2 | 80.7 | 879 | 0.183 | 5.0 | +0.259 R |

## Week by week (R)

| Week from | avgR±0.7 (4 days) | avgR±0.7 (all) | 48h ΣR ≥ +10 | rolling 30d avgR > 0 | clustered t ≥ 2 (live record only) | prior + live veto (proposed) | everything | pre-registered set (reference) |
|---|---|---|---|---|---|---|---|---|
| 2026-05-25 | 20.3 (5) | 2.1 (1) | -105.5 (4) | 14.7 (12) | 0.0 (0) | 12.5 (5) | -707.1 (64) | 16.0 (5) |
| 2026-06-01 | -6.0 (2) | 1.8 (1) | -163.9 (2) | -59.2 (16) | 0.0 (0) | 17.7 (5) | -949.9 (64) | 7.1 (5) |
| 2026-06-08 | -22.9 (6) | 0.0 (2) | -40.7 (9) | -100.4 (23) | 0.0 (0) | -3.6 (5) | -833.6 (64) | -4.8 (5) |
| 2026-06-15 | -10.4 (5) | -0.1 (1) | -161.0 (3) | -90.1 (19) | 0.0 (0) | -1.2 (4) | -907.2 (64) | 3.1 (5) |
| 2026-06-22 | 0.0 (0) | 0.0 (0) | 0.0 (0) | -17.4 (18) | 0.0 (0) | 5.9 (4) | -708.7 (64) | 0.7 (5) |
| 2026-06-29 | 0.0 (0) | 0.0 (0) | -49.4 (1) | -70.5 (21) | 0.0 (0) | -0.3 (5) | -988.0 (64) | -0.5 (5) |
| 2026-07-06 | -59.5 (1) | 0.0 (0) | -66.9 (4) | -26.6 (18) | 0.0 (0) | -20.7 (5) | -881.1 (64) | -13.8 (5) |
| 2026-07-13 | 0.0 (0) | 0.0 (0) | 0.0 (0) | -75.2 (16) | 0.0 (0) | -12.8 (5) | -1067.5 (64) | 2.5 (5) |
| 2026-07-20 | 0.0 (0) | 0.0 (0) | 0.0 (0) | 1.5 (11) | 0.0 (0) | 11.1 (5) | -866.2 (64) | 2.7 (5) |
| 2026-07-27 | 0.0 (0) | 0.0 (0) | -22.3 (4) | 21.1 (16) | 0.0 (0) | -29.8 (5) | -1017.0 (64) | -2.4 (5) |
| 2026-08-03 | 3.6 (2) | 0.0 (0) | -22.1 (1) | -78.1 (18) | 0.0 (0) | 4.0 (4) | -1035.3 (64) | 1.0 (5) |
| 2026-08-10 | 5.1 (2) | 5.8 (1) | 0.0 (0) | -49.0 (15) | 0.0 (0) | -5.7 (5) | -915.6 (64) | -2.4 (5) |
| 2026-08-17 | 28.9 (2) | 4.2 (1) | 0.0 (0) | -23.4 (12) | 0.0 (0) | 104.8 (5) | -192.0 (64) | 61.2 (5) |
| 2026-08-24 | -79.9 (8) | 3.7 (1) | -64.8 (6) | -103.3 (22) | 0.0 (0) | -6.5 (5) | -877.6 (64) | -7.9 (5) |
| 2026-08-31 | 0.0 (0) | 0.0 (0) | -21.3 (6) | 38.8 (17) | 0.0 (0) | 12.8 (5) | -533.5 (64) | 32.0 (5) |
| 2026-09-07 | 4.0 (2) | 0.0 (0) | -44.6 (2) | -52.8 (22) | 0.0 (0) | -7.3 (5) | -1225.9 (64) | 0.0 (5) |
| 2026-09-14 | 0.0 (0) | 0.0 (0) | -145.8 (3) | 174.4 (21) | 0.0 (0) | 58.9 (4) | -643.5 (64) | 80.7 (5) |
| 2026-09-21 | 62.8 (5) | 0.0 (0) | 30.8 (5) | 101.3 (23) | 0.0 (1) | 12.0 (4) | -730.1 (64) | 12.4 (5) |
| 2026-09-28 | -10.6 (3) | -3.0 (1) | -7.9 (2) | -136.2 (26) | -14.0 (3) | -14.1 (5) | -833.4 (64) | -31.2 (5) |
| 2026-10-05 | -1.0 (1) | -1.0 (1) | -53.1 (2) | -56.1 (25) | -8.1 (4) | -15.9 (5) | -819.4 (64) | -5.3 (5) |
| 2026-10-12 | 0.0 (0) | 0.0 (0) | -64.6 (3) | -159.5 (26) | -12.8 (4) | 2.6 (5) | -873.3 (64) | 9.8 (5) |

In brackets: how many strategies the rule had trading that week.

Prior (5-year sweep, 2021-10 → 2025-12 only): ma-retest-4h +279 R, 3/4 years positive; ma-retest-12h +221 R, 4/4 years positive; ma-retest-1d +99 R, 2/4 years positive; ma-pullback-12h +215 R, 2/4 years positive; rsi-macd-trend-12h +561 R, 3/4 years positive; it-4h +520 R, 4/4 years positive; it-12h -147 R, 1/4 years positive; it-1d -108 R, 1/4 years positive; trend-pullback-1h +452 R, 4/4 years positive; intraday-trend -3401 R, 0/4 years positive; trend-pullback -29578 R, 0/4 years positive; session-drive -1753 R, 0/4 years positive; dip-reversal -4047 R, 0/4 years positive; squeeze-ride -112 R, 0/4 years positive; overshoot-fade -25110 R, 0/4 years positive; crowd-squeeze -129 R, 2/4 years positive; noise-breakout -108912 R, 0/4 years positive; harmonic -635 R, 0/4 years positive; rsi-macd -9575 R, 0/4 years positive; ma-21-200 -6010 R, 0/4 years positive.

**avgR±0.7 (4 days)** picked: ma-retest-12h (6 wk, +0.557 R over 54 trades); donchian-12h-60 (5 wk, +0.289 R over 207 trades); it-45-long (4 wk, +0.141 R over 721 trades); it-4h (3 wk, +0.083 R over 579 trades); it-12h (3 wk, +0.462 R over 183 trades); donchian-1d-20 (3 wk, +0.060 R over 440 trades); squeeze-ride (3 wk, +0.185 R over 110 trades); pivot-matrix-4h (2 wk, -0.059 R over 834 trades); krown-jewel-1h (2 wk, -0.067 R over 3444 trades); session-drive (2 wk, -0.173 R over 951 trades); it-45-hold32 (2 wk, +0.019 R over 1333 trades); crowd-squeeze (1 wk, -0.089 R over 26 trades); candle-piercing-4h (1 wk, -0.083 R over 255 trades); ma-retest-4h (1 wk, +0.023 R over 308 trades); candle-marubozu-1h (1 wk, +0.008 R over 461 trades); candle-three-methods-1h (1 wk, +0.303 R over 43 trades); candle-piercing-1h (1 wk, -0.104 R over 1054 trades); candle-doji-1h (1 wk, -0.234 R over 351 trades); it-45-hold16 (1 wk, +0.014 R over 1269 trades); donchian-1d-150 (1 wk, -0.024 R over 30 trades).

**48h ΣR ≥ +10** picked: candle-tweezer-1h (5 wk, -0.249 R over 4030 trades); candle-engulfing-1h (4 wk, -0.219 R over 4213 trades); rsi-macd (4 wk, -0.107 R over 3962 trades); pivot-matrix-1h (4 wk, -0.067 R over 3885 trades); candle-three-outside-1h (3 wk, -0.150 R over 2487 trades); it-45-hold32 (3 wk, +0.019 R over 1333 trades); candle-tweezer-4h (3 wk, -0.082 R over 1044 trades); krown-jewel-1h (3 wk, -0.067 R over 3444 trades); ma-21-200 (2 wk, -0.108 R over 6523 trades); krown-jewel-2h (2 wk, -0.038 R over 1774 trades); donchian-1d-20 (2 wk, +0.060 R over 440 trades); it-4h (2 wk, +0.083 R over 579 trades); it-12h (2 wk, +0.462 R over 183 trades); candle-engulfing-4h (2 wk, -0.115 R over 1087 trades); candle-piercing-1h (2 wk, -0.104 R over 1054 trades); candle-harami-1h (2 wk, -0.169 R over 1883 trades); wyckoff-spring-1h (2 wk, -0.143 R over 1750 trades); it-45-long (2 wk, +0.141 R over 721 trades); dip-reversal (2 wk, -0.121 R over 3777 trades); intraday-trend (1 wk, -0.121 R over 7899 trades); pivot-matrix-4h (1 wk, -0.059 R over 834 trades); leader-follow (1 wk, -0.292 R over 1589 trades); trend-pullback (1 wk, -0.172 R over 11726 trades); donchian-12h-60 (1 wk, +0.289 R over 207 trades); candle-star-4h (1 wk, -0.059 R over 601 trades).

**clustered t ≥ 2 (live record only)** picked: ma-retest-12h (4 wk, +0.557 R over 54 trades); donchian-12h-60 (3 wk, +0.289 R over 207 trades); rsi-macd-trend-12h (3 wk, +0.289 R over 262 trades); ma-pullback-12h (2 wk, +0.137 R over 160 trades).

**prior + live veto (proposed)** picked: ma-retest-12h (21 wk, +0.557 R over 54 trades); it-4h (21 wk, +0.083 R over 579 trades); rsi-macd-trend-12h (21 wk, +0.289 R over 262 trades); ma-retest-4h (19 wk, +0.023 R over 308 trades); trend-pullback-1h (18 wk, -0.029 R over 495 trades).

