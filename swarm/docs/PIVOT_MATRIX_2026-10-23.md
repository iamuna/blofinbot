# PIVOT-MATRIX v1.3: analysis and backtests (2026-10-23)

Ibrahim asked for this strategy to be analysed and added (spec: "PIVOT-MATRIX v1.3", tiered-pivot price action with
a correlation-aware portfolio layer, Python + Pine). It is now the plugin
[src/strategies/pivot_matrix.js](../src/strategies/pivot_matrix.js), in shadow as `pivot-matrix-1h` and
`pivot-matrix-4h`. **Every backtest loses, before and after costs; it is not a trading candidate.**

## What the strategy is

- Pivots: fractal highs/lows (2 bars each side), filtered ZigZag-style (a new swing must be 1.5 ATR from the last).
- Bias: EMA 50 vs EMA 200 on a higher timeframe.
- Setup A, break of structure: close through the last swing high/low + 0.1 ATR, with the bias. Stop 0.5 ATR beyond
  the opposite swing.
- Setup B, sweep (swing failure): the bar trades through the last swing and closes back inside, in the reversal
  direction. Stop 0.75 ATR beyond the sweep.
- Exits: target at the previous opposing swing, stop trailed to each new swing.
- Portfolio layer: 1% risk a trade, up to 100 positions, correlation blocks (ρ > 0.85), a 6% cluster-risk cap,
  25% "soft trims" when two open positions become correlated, and funding charged at settlements.

## Problems in the spec's own backtester (its numbers would be too good)

1. **Higher-timeframe look-ahead.** `resample(df, htf)` labels each 4h bar by its start, then `reindex(..., ffill)`
   gives every 15m bar inside it the EMA of that 4h bar's **close**, up to 3¾ hours in the future.
2. **ZigZag look-ahead.** The pivot list is built over the whole history first, and a later, more extreme pivot
   *replaces* the earlier one in the list. During the replay the earlier pivot, which was confirmed and would have
   been traded live, never appears.
3. **Fills and exits.** Entries fill at the signal bar's own close, and a bar that touches both the target and the
   stop is counted as a target.
4. **Optimiser.** It maximises profit factor on 1,500-bar windows over 5 parameters with 40 trials each. That is a
   lot of tries per window, and nothing raises the bar for them.
5. **Portfolio risk.** 100 positions at 1% risk is up to 100% of equity at stake; the correlation layer only limits
   how *similar* they are. In the swarm, `config/risk.json` decides instead: 6% total open risk, 4× gross, 2× net
   BTC exposure, a per-coin notional cap, and the loss ladders. That covers what the correlation blocks and trims
   are for, so they are not ported (they would also be protected risk code).

The plugin fixes 1 and 2: each pivot is judged when it is confirmed, with what was known then, and only closed
higher-timeframe bars count. Entries are taker at the next open. The swarm's trader cannot trail a stop to each new
swing, so the plugin uses the trader's ATR trail (3 ATR once +1 R is reached) and a 192-bar time stop. The spec's
own exits were also tested separately (below).

## Backtests

Costs: taker 6 bps + slippage 1.5 bps per side, funding charged. R is the result over the distance to the stop.

**Factory data** (31 coins, 2026-04 → 2026-10, 1-minute bars, the live code path):

| Variant | Trades | Avg R | t | Avg R at 1.5× costs | Thirds (sum R) |
|---|---|---|---|---|---|
| 15m, 4h bias (the spec's default) | 15,623 | −0.129 | −12.9 | −0.199 | −480 / −980 / −557 |
| 1h, 12h bias | 3,885 | −0.067 | −3.4 | −0.099 | −174 / −129 / +44 |
| 4h, 1d bias | 834 | −0.059 | −1.4 | −0.073 | +13 / −46 / −16 |
| 1h, break of structure only | 2,129 | −0.037 | −1.7 | −0.056 | −30 / −66 / +18 |
| 1h, sweep only | 4,901 | −0.084 | −4.4 | −0.125 | −232 / −102 / −78 |

**6.8 years, hourly bars** (2020-01 → 2026-10; research-data = today's top 20, validation-data = 30 other coins,
delisted ones included; same plugin and exec simulator with 1-hour bars):

| Variant | research: trades / avg R / t | before costs (bps a trade) | validation: trades / avg R / t | before costs (bps) |
|---|---|---|---|---|
| 1h | 22,997 / −0.082 / −9.7 | −8.6 | 36,967 / −0.059 / −8.8 | −0.5 |
| 4h | 5,767 / −0.058 / −3.6 | −11.2 | 9,102 / −0.030 / −2.3 | +1.2 |
| 1h break of structure | 12,990 / −0.041 / −4.3 | −4.3 | 20,910 / −0.019 / −2.6 | +2.4 |
| 1h sweep | 29,628 / −0.103 / −12.9 | −9.7 | 47,673 / −0.090 / −14.3 | −9.0 |

Losing in almost every calendar year on both coin sets; longs and shorts both lose.

**The spec's own exits** (trail to each new swing, fill at the signal close, target before stop, 6 bps fee +
2 bps slippage a side, no funding), on the look-ahead-free signals:

| | research: trades / avg R / t (before costs) | validation |
|---|---|---|
| 1h | 37,510 / −0.092 / −15.3 (−0.027 R) | 59,306 / −0.075 / −15.8 (−0.015 R) |
| 4h | 8,989 / −0.014 / −1.0 (+0.017 R) | 14,592 / −0.031 / −3.2 (−0.003 R) |

## Verdict

There is no edge before costs (−11 to +2 bps a trade, within noise of zero), so costs make every version a clear
loser. That holds for both setups, at 15m, 1h and 4h, in 2026 and over 2020–2026, on survivors and on the
validation coins, with the plugin's exits and with the spec's own. The sweep setup is the worst part. This agrees
with the 5-year sweep: the candle and Wyckoff price-action strategies had no edge either. The spec's portfolio
layer cannot add an edge; it can only limit how much a strategy with none loses at once.

It is in shadow, as Ibrahim asked, so its live record can be compared with these numbers; shadow costs nothing.
Note: the promotion gate's out-of-sample route (150 shadow trades with t ≥ 2) could still move a variant to
`trade` on paper after a lucky run. With these backtests, `/mode pivot-matrix-1h off` is the safer setting.

Tries logged on `swarm-factory` (cff248f): 7 (the 5 factory variants and the 2 spec-exit variants; the hourly runs
reuse the factory variants' parameters, so they are not new tries). 266 tries in all.

Scripts used (scratch, not in the repo): the factory run is `backtest()` from `src/backtest/run.js` with the five
variants above, `warmupDays` 21. The hourly harness drives the plugin through `StrategyHost` and `ExecSim`, with the
bar length set to one hour.
