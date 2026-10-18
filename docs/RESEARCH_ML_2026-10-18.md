# ML layer experiment (2026-10-18) — not adopted

**Question.** Can a gradient-boosted model (scikit-learn HistGradientBoosting, LightGBM-style) trained on the engine's own daily state — the vote of every timeframe from 1h to 3M, volatility, cross-coin rank, 1/7/30-day returns, 3-day funding and BTC's big-picture vote — improve on the plain vote system?

**Answer: no.** Out-of-sample predictive power for next-day returns is essentially zero (daily rank correlation between prediction and outcome −0.05 to +0.02), and every way of combining the model with the vote system was worse than the vote system alone on the top-20.

## Method

- Panels: `lab/mtf/export_daily.js` (one row per coin per UTC day, known at the day's close). Top-20: 28,922 coin-days; 30 validation coins: 55,020.
- Walk-forward by calendar year 2023–2026: the model for year Y is trained only on days before Y. Three set-ups: trained and tested on the top-20; trained and tested on the validation coins; trained on the top-20 and tested on the validation coins.
- Same daily simulator for all variants (25% portfolio volatility target on trailing 60 days, gross ≤ 3×, 5.9 bps per unit of turnover). Daily rebalancing is a coarser version of the live hourly engine, so absolute Sharpe ratios here are lower than in RESEARCH_MTF; only the comparison between variants matters.

## Results

| Coin set | Variant | 2023–26 Sharpe | Return | Max DD | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|
| top-20 | Plain vote system | 1.19 | 123.6% | 16.1% | 1.07 | 2.29 | 0.26 | 0.58 |
| top-20 | ML only (long/short by prediction) | 0.27 | 3.4% | 6.6% | -0.59 | 1.39 | 0.02 | 0.26 |
| top-20 | Vote system × (1 + 0.5·ML rank) | 1.01 | 98.7% | 17.5% | 0.99 | 2.02 | 0.24 | 0.46 |
| top-20 | Vote system, cut where ML disagrees | 1.1 | 88.3% | 16.1% | 0.71 | 2.04 | 0.48 | 0.53 |
| val-30 (model trained on val-30 past) | Plain vote system | -0.09 | -12.9% | 27.0% | -0.12 | 0.51 | -1.08 | -0.04 |
| val-30 (model trained on val-30 past) | ML only (long/short by prediction) | 0.35 | 3.3% | 4.9% | -1.13 | 1.66 | 0.46 | 1.29 |
| val-30 (model trained on val-30 past) | Vote system × (1 + 0.5·ML rank) | -0.03 | -8.8% | 26.6% | 0.03 | 0.59 | -1.13 | -0.02 |
| val-30 (model trained on val-30 past) | Vote system, cut where ML disagrees | -0.12 | -9.3% | 16.4% | -0.69 | 0.51 | -0.54 | 0.03 |
| val-30 (model trained on top-20 only) | Plain vote system | -0.09 | -12.9% | 27.0% | -0.12 | 0.51 | -1.08 | -0.04 |
| val-30 (model trained on top-20 only) | ML only (long/short by prediction) | 0.7 | 6.8% | 4.0% | 2.98 | 0.94 | 0.97 | -0.12 |
| val-30 (model trained on top-20 only) | Vote system × (1 + 0.5·ML rank) | -0.17 | -18.1% | 26.3% | -0.3 | 0.41 | -1.06 | -0.09 |
| val-30 (model trained on top-20 only) | Vote system, cut where ML disagrees | 0.16 | 4.1% | 10.8% | 0.58 | 0.59 | -0.52 | -0.53 |

| Year | Trained on | Tested on | Daily rank IC |
|---|---|---|---|
| 2023 | top-20 | top-20 | -0.0147 |
| 2023 | val-30 | val-30 | -0.0452 |
| 2023 | top-20 | val-30 | -0.0051 |
| 2024 | top-20 | top-20 | 0.0013 |
| 2024 | val-30 | val-30 | 0.0113 |
| 2024 | top-20 | val-30 | 0.0111 |
| 2025 | top-20 | top-20 | 0.0127 |
| 2025 | val-30 | val-30 | 0.0207 |
| 2025 | top-20 | val-30 | 0.0105 |
| 2026 | top-20 | top-20 | 0.0071 |
| 2026 | val-30 | val-30 | 0.0183 |
| 2026 | top-20 | val-30 | -0.0217 |

## Conclusion

The trend votes already capture what is predictable at these horizons; a learned layer on top mostly fits noise. The live bot keeps the plain, research-backed vote system. ML can be revisited with different information the votes do not contain (order-book depth, open interest, liquidations) once that data is being recorded — the GPU PC would train those models.

Code: `lab/mtf/export_daily.js`, `lab/mtf/ml_overlay.py`. Results: `research_out/ml/ml_overlay.json`.
