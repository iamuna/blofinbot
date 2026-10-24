# Weekly shape of the four strategies rule v2 trades today

ma-retest-12h, it-4h, rsi-macd-trend-12h, ma-retest-4h, each trade risking 0.25% of a fixed account, each strategy on its own with no shared limits (so the size of the numbers is not realistic — the *shape* is the point). 6.5 months × 31 coins, branch swarm-data. `node upswarm/tools/weekly_scoreboard.js --trades <config trades.json> --names ma-retest-12h,it-4h,rsi-macd-trend-12h,ma-retest-4h`

### Trades: ma-retest-12h, it-4h, rsi-macd-trend-12h, ma-retest-4h at 0.25% risk each

183 days, Sharpe 2.45. Theory (normal returns) for this Sharpe: a positive week 63% of the time, month 76%, quarter 89%.

| Period | Count | Positive | Average | Median | Worst | 5th percentile | Best | Longest run without a gain |
|---|---|---|---|---|---|---|---|---|
| Week | 27 | 37% | +1.65% | -0.80% | -6.10% | -4.63% | +27.54% | 5 weeks |
| Month | 7 | 57% | +6.29% | +0.34% | -9.90% | -9.90% | +24.82% | 1 months |
| Quarter | 3 | 67% | +14.68% | +15.60% | -6.77% | -6.77% | +35.22% | 1 quarters |

