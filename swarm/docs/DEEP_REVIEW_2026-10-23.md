# Deep review of every strategy (2026-10-23)

Ibrahim asked for a deep analytical test of all strategies, to improve or fix them. **Bottom line: the losers cannot be
fixed, because they carry no directional information. Five slow trend strategies hold up in every sample. And the
six strategies switched to paper trading on 2026-10-23 (on 48 hours of shadow R) are among the worst in the repo.**

## Method

- **Data.** 136 variants: every plugin family at 1h, 2h, 4h, 12h and 1d, the 14 candle patterns separately, with the
  5-year sweep's settings. Hourly bars 2020-01 → 2026-10, on research-data (today's top 20) and validation-data
  (30 other coins, delisted ones included).
- **Code path.** The live FeatureState (hourly bars fed to its per-timeframe `close`), the regime's hourly bias,
  StrategyHost, and ExecSim with one-hour bars. BloFin costs, funding charged.
- **Cross-check.** The harness reproduces the minute-data sweep closely: `ma-retest@720` +0.16 R here vs +0.14,
  `intraday-trend@240` +0.048 vs +0.056.
- **Three samples, chosen in advance.** IS = research 2020–2023 (diagnose and choose fixes here only). OOS-time =
  research 2024–2026. OOS-coins = validation 2020–2026. A fix counts only if it holds in both OOS samples.
- **t-stats.** On daily sums: trades opened the same day move together.
- **What is not covered.** The regime's 15-minute state stays "mixed" (no minute data); `oi-flush` needs open
  interest, which the history lacks. The sub-hour frames are already settled by the 5-year sweep: every strategy
  loses there after costs.
- Scripts are in the scratch folder `deep/` (harness, analyze, fixes, portfolio), not in the repo.

## What makes a strategy lose here

- **No signal.** For the reversal and pattern families (all 14 candle patterns, Wyckoff, Krown jewel, harmonic,
  RSI-MACD reversal, overshoot fade, pivot-matrix), the average move in favour after entry equals the average move
  against (MFE ≈ MAE ≈ 1.0–1.2 R). Before costs they are near zero: −0.1 to +0.03 R. A 2:1 target needs about 34%
  hits to break even after costs; they get 27–30%.
- **Costs.** At 1h, costs are 0.04–0.21 R a trade (candle-star@60 0.21, candle-hammer@60 0.22); at 12h, 0.02–0.03 R.
  Slower frames therefore help only strategies that have a small edge, and they have no edge to keep.
- **Exits are not the problem.** For the winners, trades that reach +1 R end at +1.05 to +1.13 R on average. The
  trailing version (`ma-pullback-ride`) is no better than the 2:1 target.

## Fixes tried

- **Trade only with the coin's trend** (hourly regime bias · side ≥ 0.3), and reversal patterns only as pullbacks
  within the trend. Applied to all 136 variants as a filter (a screen):
  - none of the losers becomes clearly positive;
  - 3 variants flip to marginally positive in all samples (+0.00 to +0.04 R, or a few dozen trades);
  - 11 improve in-sample and then fail out of sample: what curve-fitting looks like. **Rejected.**
- **Slower timeframes.** This is what separates the strategies that work from the rest (table below). It is the one
  "fix" with evidence, and it applies only to the trend families.
- **PIVOT-MATRIX** ([PIVOT_MATRIX_2026-10-23.md](PIVOT_MATRIX_2026-10-23.md)): before costs −0.005 R at 1h and
  −0.004 R at 4h, with MFE ≈ MAE. No setting change can give it a direction it does not have.

## Positive in all three samples (avg R, t; IS | OOS-time | OOS-coins)

| Variant | IS | OOS-time | OOS-coins | In config |
|---|---|---|---|---|
| ma-retest@720 | +0.186 (2.2) | +0.147 (1.9) | +0.236 (4.0) | `ma-retest-12h` (shadow) |
| ma-retest@1440 | +0.095 (0.8) | +0.091 (0.9) | +0.278 (3.1) | `ma-retest-1d` (shadow) |
| rsi-macd-trend@720 | +0.154 (2.6) | +0.119 (1.6) | +0.124 (2.7) | `rsi-macd-trend-12h` (shadow) |
| ma-retest@240 | +0.058 (1.2) | +0.053 (1.0) | +0.075 (2.2) | **added: `ma-retest-4h` (shadow)** |
| ma-pullback@720 | +0.021 (0.4) | +0.010 (0.2) | +0.074 (2.1) | **added: `ma-pullback-12h` (shadow)** |
| intraday-trend@240 / @720 / @1440 | +0.01 / +0.07 / +0.08 | +0.08 / +0.11 / +0.19 | +0.02 / +0.03 / +0.01 | `it-4h` (shadow) |
| donchian-60@720, donchian-20@1440 | +0.05, +0.01 | +0.01, +0.05 | +0.04, +0.02 | `donchian-12h-60` (long only), `donchian-1d-20` (shadow) |
| ma-retest@120, ma-pullback-ride@120, trend-pullback@60, rsi-macd-trend@240 | +0.02 to +0.07 | ≈ 0 to +0.04 | +0.02 to +0.04 | — (too thin to trade after costs) |

The first five together, as one book of R:

| | IS 2020–23 | OOS-time 2024–26 | OOS-coins 2020–26 |
|---|---|---|---|
| Robust five | +281 R, Sharpe 1.09, max DD 74 R | +267 R, Sharpe 0.92, max DD 114 R | +1,235 R, Sharpe 1.41, max DD 225 R |
| The six on paper since 2026-10-23 (intraday-trend at 1h as a stand-in for its 45m default, wyckoff 1h, candle engulfing 1h and 4h, harami 4h, three-outside 1h) | −4,081 R, Sharpe −4.9 | −4,575 R, Sharpe −5.5 | −12,584 R, Sharpe −4.8 |

The six lose in every year of every sample. Their good two days of shadow were shorts in a falling market
([LIVE_REVIEW_2026-10-23.md](LIVE_REVIEW_2026-10-23.md)).

## Recommendations

1. **Paper trading:** move the six back to shadow and trade the robust trend set instead (`ma-retest-12h`,
   `ma-retest-1d`, `rsi-macd-trend-12h`, `ma-retest-4h`, `ma-pullback-12h`). This is Ibrahim's call (`/mode`, or a
   `control.json` on `swarm-state`). The trend sleeve (PR #4) is the same idea built as a portfolio, with the best
   evidence of all.
2. **Retire:** noise-breakout (−0.6 R at 1h: by far the worst), the candle patterns at 1h and 2h (every one negative,
   most t < −3), overshoot-fade, and harmonic below 12h. Keeping them in shadow costs only CPU; it adds noise to the
   reports.
3. **Do not search parameters on the losers.** With no edge before costs, the best of many settings is luck; the
   factory's t bar (2 + 0.5·log10(tries)) exists for that.
