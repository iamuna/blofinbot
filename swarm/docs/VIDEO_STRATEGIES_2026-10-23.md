# Strategies from Mitch Ray TA's videos, and what they do for the swarm's own strategies (2026-10-23)

Ibrahim sent `4_strat.zip` (four Mitch Ray TA videos with transcripts, screenshots and auto-generated reports) and
asked for (1) trading strategies built from it, (2) an analysis of the swarm's strategies with new or improved
ones, and (3) the results written down here. Branch `new-strats`. Every table: [VIDEO_STRATEGIES_2026-10-23_TABLES.md](VIDEO_STRATEGIES_2026-10-23_TABLES.md).

## Bottom line

1. **Built as taught, the four video methods have no edge.** The "mixing bowl" confluence reversal, the Fibonacci
   golden-zone pull-back, the AB=CD pattern and the wedge break lose or sit near zero after costs, at 4h, 12h and
   1d. That repeats the deep review's finding for every reversal and pattern family (no direction: the move for
   and against after entry are the same size).
2. **One of Mitch's rules is a real improvement to the swarm's best strategy.** "A pull-back is not a real swing
   until it reaches the golden zone": take the 21/200 EMA retest only when the pull-back retraced **at least 38.2%**
   of the impulse before it. At 4h this doubles the average trade and holds in all three samples:

   | 4h retest, avg R per trade (t) | IS 2020–23 | OOS-time 2024–26 | OOS-coins 2020–26 |
   |---|---|---|---|
   | `ma-retest-4h` (in shadow today) | +0.054 (1.0) | +0.048 (0.8) | +0.071 (1.8) |
   | **`ma-retest-4h-golden`** (new) | **+0.139 (2.3)** | **+0.189 (3.0)** | **+0.111 (2.7)** |

   Pooled over all 50 coins: 3,689 trades, +0.132 R, t 3.73 (the bar for ~439 tries is 3.32), +0.117 R at 2×
   costs, positive in every full year 2021–2026, max drawdown 47 R instead of 127 R, and more total R (488 vs 373)
   from fewer trades. Swapped into the "robust five" trend book it lifts the book's Sharpe in every sample
   (0.99 → 1.19, 0.98 → 1.34, 1.41 → 1.50) and cuts its drawdowns.
3. **Added to config in shadow:** `ma-retest-4h-golden` (recommended to replace `ma-retest-4h` once its shadow
   record agrees), and two watches, `ma-retest-12h-golden-fib` and `ma-retest-1d-golden`. The four video plugins are
   in the repo and in config, switched off, with their results in their notes. Nothing is in trade mode: that stays
   your call (`/mode`).

## What was in the zip

Four videos by Mitch Ray (TA with Mitch Ray), each with `transcript.txt`, `source.mp4`, 30 screenshots and an
auto-generated `analysis_report.md` (no vision or OCR findings in it — the transcript and screenshots were read
directly for this work).

| Video | Date, length | What it teaches (the parts that can be made into rules) |
|---|---|---|
| HOW TO Fibonacci! Trading Bitcoin and Cryptocurrency | 2019-04-24, 16:07 | 23.6% = the retrace that confirms a swing ("can't anchor a swing high until we've hit a 23% retrace"); 38.2% and 50% moderate; 61.8% "golden retrace"; **38.2–61.8% = golden zone**, where most reversals happen; 78.6% / 88.6% = harmonic entries; draw left to right only, wick-to-wick or close-to-close, never mixed; uptrend: swing low → swing high gives retrace targets; extensions 1.272 / 1.414 / 1.618, confluence of two fibs = the pattern completion zone; **falling wedge: targets 50% and 61.8% of the pattern's high → low**; "Fibonacci is like an oscillator — never use it alone": divergence on MACD and RSI. |
| HOW TO SWING TRADE! SECRETS TO SUCCESS! | 2020-06-18, 15:38 | The **"cake-baking" method**: mixing bowl = the overall trend (trade with it); flour = divergence (classic or hidden, "try to have it at all times"); sugar = critical support "looking left" (old highs / lows); eggs = a pattern (broadening wedge, triangle, harmonic); butter / oil = time-scale hopping (the same signal on the daily as on the 4h); baking powder = the Fibonacci golden zone. Measure before baking: **3:1 reward to risk** (then 33% winners break even), **2–5% of the portfolio per trade**, consistent sizing. Daily / weekly agreeing is best; the entry is taken on the 4h. Example: Target (TGT) 4h, stop below the critical support, 3.48:1. |
| HOW TO TRADE the Bearish ABCD Pattern! | 2019-05-01, 7:35 | **AB=CD**: one impulse A→B; B→C retraces ~61.8% (58–60% in practice, up to 78.6%); C→D runs to the 1.272 extension of BC, possibly 1.618; CD proportional to AB (symmetry); at D look for bearish divergence; short; **targets 38.2 / 50 / 61.8% of A→D, layer out at each**. Example: Tesla 4h. |
| How to Trade Bitcoin and Cryptocurrency Effectively | 2019-03-25, 14:56 | A trading strategy = **entry + why, stop + why, exits + why**, decided before the trade. Ingredients: pattern development, divergence on multiple time scales, divergence on multiple oscillators, critical support / resistance, critical fib nodes. Stop: ~3:1 and **moderately beyond critical support, not where everyone's stop is** (no "running stop"). Exits at fib nodes (38.2%, 61.8%, 100%); watch for opposite divergence and for BTC. Examples: BTC bearish Cipher (4h), bullish Gartley at 78.6% with a falling wedge and a double bottom with RSI + MACD divergence on the 4h and the daily. |

## The strategies built from them

All are strategy plugins (pure functions of the bars, pass `plugin_check`), registered in
`src/strategies/index.js`, tested in `test/video_strategies.test.js`.

| Plugin | File | Rules (the video's words → code) |
|---|---|---|
| `mixing-bowl` | [mixing_bowl.js](../src/strategies/mixing_bowl.js) | At each confirmed swing low (long) / high (short): 7 ingredients scored — RSI divergence (classic or hidden), MACD divergence, look-left support (≥ 2 older pivots within 0.5 ATR), pattern (double bottom or falling / rising wedge), Fibonacci golden zone of the last impulse, divergence on the higher timeframe (1d), the higher timeframe's trend (bowl). Enter when ≥ 4 including a divergence. Stop 0.5 ATR beyond the lower of the swing and the support; target the first of 38.2 / 61.8 / 100% of the drop that pays ≥ 3:1, else no trade. |
| `fib-golden` | [fib_golden.js](../src/strategies/fib_golden.js) | Zigzag swings confirmed by a 23.6% retrace; higher highs and higher lows (longs); after a swing high, wait for price to enter the golden zone (≤ 38.2% level) and a bar to close up above the 61.8% level; stop past 78.6%; target the 1.272 extension. Shorts mirrored. |
| `abcd` | [abcd.js](../src/strategies/abcd.js) | A, B, C from the same 23.6% zigzag; BC 55–81% of AB; D zone at 1.272–1.618 × BC (CD/AB 0.7–1.3); in the zone, the first bar that turns enters if RSI diverges from B; stop past the 1.618; target 50% of A→D (the middle of the 38.2 / 50 / 61.8 layers). Bullish mirrored. A `limit` mode rests an order at the 1.272. |
| `wedge-break` | [wedge_break.js](../src/strategies/wedge_break.js) | Three falling highs and three falling lows, highs falling faster (converging); the first close above the upper line, RSI higher at the last low; stop under the wedge; target 50% of the wedge's high → low. Rising wedge → short. |
| `ma-retest-plus` | [ma_retest_plus.js](../src/strategies/ma_retest_plus.js) | The swarm's `ma-21-200` retest **unchanged** (a test proves identical trades with every switch off) plus Mitch's checks as switches: `noDiv` (no trade against a fresh RSI divergence), `htf` (time-scale hopping: the 1d 21/200 must agree), `zone` (the pull-back's depth as a fraction of the impulse), `tgtMode: 'fib'` (target the 1.272 extension instead of 2R). |

Not codable as a plugin: position sizing (2–5% per trade — the swarm's allocator risks 0.25–1% and should keep
doing so), "layer out" at several targets (ExecSim and the traders support one target; 50% of A→D stands in for
the three layers), and "exit early when opposite divergence develops" (exits belong to the trader, not to plugins —
a possible trader feature, untested).

## Method

The deep review's method, now kept in the repo as [tools/hourly_backtest.js](../tools/hourly_backtest.js): hourly
bars from `research-data` (today's top 20) and `validation-data` (30 other coins, LUNA / FTT / SRM / WAVES
included) through the live code path — FeatureState (1h, 2h, 4h, 12h, 1d bars), the regime's hourly bias,
StrategyHost, ExecSim on one-hour bars, BloFin fees + slippage + funding. Three samples fixed in advance: IS =
research 2020-03 → 2023, OOS-time = research 2024 → 2026-10, OOS-coins = validation 2020-03 → 2026-10. t-stats on
daily sums.

Check of the harness against the deep review (same samples): `ma-retest@720` +0.165 / +0.141 / +0.233 R here vs
+0.186 / +0.147 / +0.236 there; `rsi-macd-trend@720` +0.135 / +0.129 / +0.128 vs +0.154 / +0.119 / +0.124;
`ma-retest@240` +0.054 / +0.048 / +0.071 vs +0.058 / +0.053 / +0.075.

Order of work (so the tries are honest): round 1 = the four video plugins with defaults written before any
backtest; round 2 = each `ma-retest-plus` switch on its own; then one descriptive table (retest trades bucketed by
pull-back depth), read on IS first; round 3 = the rule that table suggested, one combination, ABCD on wider
swings. **38 new tries**, so the factory's count goes from 401 to ~439 and its t bar to **3.32**.

## Results

### Round 1 — the video strategies as taught (avg R per trade, t)

| Variant | IS 2020–23 | OOS-time 2024–26 | OOS-coins 2020–26 |
|---|---|---|---|
| mixing-bowl 4h / 12h / 1d | −0.053 / +0.119 / −0.211 | −0.166 / +0.050 / −0.030 | −0.106 (t −2.6) / −0.057 / −0.261 (t −2.8) |
| fib-golden 4h / 12h / 1d | +0.042 / +0.031 / −0.232 | +0.097 / +0.012 / −0.129 | +0.059 / +0.064 / +0.005 |
| abcd 4h / 12h / 1d | −0.21 (12 trades) / −0.96 (3) / +0.04 (2) | +0.14 (13) / −0.06 (9) / −0.55 (6) | −0.09 (35) / −0.05 (9) / +0.05 (12) |
| wedge-break 4h / 12h / 1d | −0.013 / −0.138 / +0.78 (10) | −0.015 / +0.479 (34) / −0.24 (9) | −0.209 (t −2.2) / +0.086 / −0.436 |

- **mixing-bowl:** the only positive cell set (12h) fails on unseen coins.
- **fib-golden 4h** is positive in all three but never significant (t < 1), and its years swing from −0.14 to +0.39.
- **abcd** is rare: of 528 valid A-B-C setups on six coins at 4h, 35 ever reached the D zone. With wider swings
  (2.5 ATR, round 3) it trades more and still loses: 1h −0.04 / +0.03 / −0.06, 4h −0.19 / +0.08 / −0.13.
- **wedge-break** is rare and inconsistent.

### Which ingredients carry information? (every 4h mixing-bowl setup — about 31,600 — with no score floor)

Average R with the ingredient minus without it, 4h (12h in the tables file):

| Ingredient | IS | OOS-time | OOS-coins |
|---|---|---|---|
| RSI divergence | −0.037 | +0.044 | +0.040 |
| MACD divergence | −0.009 | +0.008 | −0.006 |
| look-left support | −0.014 | −0.058 | −0.025 |
| pattern (double bottom / wedge) | −0.055 | +0.003 | −0.010 |
| **Fibonacci golden zone** | **+0.029** | **+0.018** | **+0.020** |
| 1d divergence | +0.007 | +0.024 | −0.012 |
| bowl (1d trend agrees) | +0.085 | −0.000 | +0.042 |

Every setup loses on average (−0.03 to −0.06 R) and **more ingredients do not help**: score 1 −0.05, score 4 −0.03
to +0.01, score 5 −0.02 to −0.11. Only two ingredients lean the right way everywhere or nearly: the golden zone and
the trend. Both are about *where in a trend* you are, not about the reversal itself — which pointed to round 2.

### Round 2 — Mitch's checks on the 21/200 retest, one at a time

| Variant | IS | OOS-time | OOS-coins |
|---|---|---|---|
| ma-retest-4h (today) | +0.054 | +0.048 | +0.071 |
| + noDiv | +0.052 | +0.047 | +0.065 |
| + htf (1d agrees) | +0.126 | −0.016 | +0.124 |
| + zone 38.2–78.6% | **+0.114** | **+0.208** | **+0.087** |
| + fib target 1.272 | +0.048 | −0.010 | +0.077 |
| ma-retest-12h (today) | +0.165 | +0.141 | +0.233 |
| + zone 38.2–78.6% | +0.235 | +0.144 | +0.245 |
| + fib target 1.272 | +0.221 | +0.144 | +0.269 |
| ma-retest-1d (today) | +0.134 | +0.085 | +0.272 |
| + zone 38.2–78.6% | +0.202 | +0.391 | +0.151 |

The divergence check does nothing; the 1d agreement helps in-sample and fails out of time; the zone helps at 4h
in all three samples.

### The pull-back depth table (4h retest, avg R per trade)

| Pull-back, % of the impulse | IS | OOS-time | OOS-coins |
|---|---|---|---|
| under 23.6% | −0.132 (78) | −0.093 (117) | +0.008 (343) |
| 23.6–38.2% | −0.045 (391) | −0.044 (491) | −0.022 (1,388) |
| 38.2–50% | +0.195 (218) | +0.187 (274) | +0.111 (783) |
| 50–61.8% | +0.104 (135) | +0.135 (151) | +0.168 (449) |
| 61.8–78.6% | +0.115 (80) | +0.241 (99) | +0.094 (229) |
| 78.6–100% | +0.665 (25) | +0.067 (25) | +0.378 (98) |
| deeper than the impulse | +0.046 (82) | +0.093 (96) | +0.277 (302) |

At 4h the line is at 38.2%, in every sample: shallow retests lose, every deeper bucket wins. In IS alone the
rule reads "at least 38.2%, no upper limit", so round 3 used exactly that — `zone: [0.382, null]`. At 12h and 1d
the table is noisy (shallow 12h retests are *positive* on unseen coins), so there the rule is a watch, not a fix.

### Round 3 — the golden-zone minimum

| Variant | IS | OOS-time | OOS-coins | All 50 coins: avg R, t, sum R, max DD |
|---|---|---|---|---|
| **ma-retest-4h-golden** | **+0.139 (2.3)** | **+0.189 (3.0)** | **+0.111 (2.7)** | **+0.132, t 3.73, 488 R, 47 R** |
| ma-retest-4h (today) | +0.054 (1.0) | +0.048 (0.8) | +0.071 (1.8) | +0.063, t 1.76, 373 R, 127 R |
| ma-retest-12h-golden-fib | +0.267 (2.2) | +0.190 (1.6) | +0.233 (2.9) | +0.229, t 3.26, 248 R, 66 R |
| ma-retest-12h-golden | +0.231 (2.3) | +0.130 (1.3) | +0.226 (3.0) | +0.206, t 3.26, 230 R, 68 R |
| ma-retest-12h (today) | +0.165 (1.7) | +0.141 (1.6) | +0.233 (3.5) | +0.201, t 3.43, 344 R, 86 R |
| ma-retest-1d-golden | +0.326 (2.1) | +0.265 (2.0) | +0.225 (2.0) | +0.253, t 2.84, 133 R, 47 R |
| ma-retest-1d (today) | +0.134 (1.0) | +0.085 (0.7) | +0.272 (2.8) | +0.198, t 2.44, 167 R, 35 R |
| pull-back mode + golden, 4h / 12h / 1d | +0.073 / +0.069 / +0.153 | +0.014 / −0.008 / −0.000 | +0.071 / +0.072 / +0.058 | (the pull-back mode stays weak) |

By year, `ma-retest-4h-golden` (all 50 coins): 2020 −0.077 (warm-up year; today's version −0.176), 2021 +0.259,
2022 +0.149, 2023 +0.202, 2024 +0.102, 2025 +0.078 (today's: −0.042), 2026 +0.145. At 2× costs +0.117 R.
Long +0.169, short +0.163 (research coins): it works both ways.

### The book

The deep review's "robust five" (ma-retest-12h, ma-retest-1d, rsi-macd-trend-12h, ma-retest-4h, ma-pullback-12h)
as one book of R, then with the 4h retest replaced by the golden version:

| Book | IS: sum R, Sharpe, max DD | OOS-time | OOS-coins |
|---|---|---|---|
| robust five (today) | 261 R, 0.99, 81 R | 284 R, 0.98, 120 R | 1,246 R, 1.41, 226 R |
| robust five, 4h → golden | **296 R, 1.19, 68 R** | **368 R, 1.34, 94 R** | **1,242 R, 1.50, 179 R** |

## What is on the branch

| File | What |
|---|---|
| `src/strategies/mixing_bowl.js`, `fib_golden.js`, `abcd.js`, `wedge_break.js` | the four video strategies (config: off, results in their notes) |
| `src/strategies/ma_retest_plus.js` | the 21/200 retest with the confluence switches |
| `src/strategies/index.js` | the five new plugin names |
| `config/swarm.json` → `strategies` | shadow: `ma-retest-4h-golden`, `ma-retest-12h-golden-fib`, `ma-retest-1d-golden`; off: `ma-retest-plus`, `mixing-bowl`, `fib-golden`, `abcd`, `wedge-break` |
| `test/video_strategies.test.js` | 7 tests: plugin check, identical trades with switches off, the golden-zone switch, each pattern on a synthetic chart |
| `tools/hourly_backtest.js` | the deep review's harness, kept this time |
| `tools/video_research.js` | re-runs this whole study and prints every table (~2 minutes) |
| `docs/VIDEO_STRATEGIES_2026-10-23*.md` | this write-up and every table |

`npm test`: 99 of 99 pass. If this branch is merged into `main`, the PC installs the plugins, config and docs on
its own; the test file and the two tools wait for `approve.ps1` like any other code.

## Recommendations

1. **Run `ma-retest-4h-golden` in shadow next to `ma-retest-4h`** (it is in config). When its shadow record agrees
   with the backtest, trade it *instead of* `ma-retest-4h` — they take many of the same trades, so not both.
2. **Watch `ma-retest-12h-golden-fib` and `ma-retest-1d-golden`.** Better per trade, but fewer trades and not a
   clear win over today's 12h / 1d versions out of sample. Shadow decides.
3. **Do not trade the video patterns as stand-alone strategies** (mixing bowl, AB=CD, wedges, fib pull-backs).
   Mitch's checklist is useful as a *filter on a strategy that already has a direction*, not as a source of
   direction. This matches every reversal / pattern test in the repo so far.
4. Keep the swarm's sizing (0.25–1% risk per trade), not the videos' 2–5%.
5. Possible next steps, untested: the golden-zone minimum on other trend entries (`it-4h`, `trend-pullback-1h`,
   `donchian-*` re-entries); a trader feature to exit when opposite divergence appears (Mitch's exit rule).

## Caveats

- Hourly bars: a 4h idea's entry, stop and target are filled on one-hour candles (stop first when both are hit in
  one hour), as in the deep review. Minute data would be slightly more exact.
- The regime's 15-minute state stays "mixed" (no minute data); none of the new plugins use it.
- No look-ahead: swing pivots are known only `pivotK` bars after the extreme, zigzag swings only after the 23.6%
  turn, the higher timeframe only from closed bars, the golden zone from bars up to the entry bar.
- research-data is today's top 20 (survivorship); that is why OOS-coins (with dead coins) is part of every verdict.
- 2020 is a warm-up year for the 200-bar averages on 4h–1d bars; every variant is weakest there.

## Reproduce

```
git archive origin/research-data | tar -x -C ../rd ; git archive origin/validation-data | tar -x -C ../vd
node swarm/tools/video_research.js --research ../rd --validation ../vd
node swarm/tools/hourly_backtest.js --data ../rd --variants <variants.json> --split 2024-01-01 --out out   # any variant list
```
