# Deep review, second run (2026-10-24)

Ibrahim asked for another run of the deep checks on branch `new-strats` (main as of 09374f9 merged in, plus orb-retest
and the video strategies). **Bottom line: the robust trend set still holds, the golden-zone variants reproduce, and
everything new below one hour loses — orb-retest included, which has no edge even before costs. One bug was found and
fixed (orb-retest's zone finder). Three changes are worth making, all in shadow; the rest are Ibrahim's calls.**

## Method

Same as [DEEP_REVIEW_2026-10-23.md](DEEP_REVIEW_2026-10-23.md), plus a sub-hour run it could not do.

- **1h–1d (41 enabled variants):** [tools/hourly_backtest.js](../tools/hourly_backtest.js) on research-data (20
  coins) and validation-data (30 other coins, delisted ones included), 2020-01 → 2026-10. Samples fixed in advance:
  IS = research before 2024, OOS-time = research 2024 on, OOS-coins = validation.
- **5–45m (the 8 sub-hour variants + an orb-retest grid):** [tools/subhour_backtest.js](../tools/subhour_backtest.js)
  (new). IS = research-data 5m bars Oct 2024 → Aug 2025, OOS-time = Sep 2025 → Oct 2026 (20 coins), OOS-coins =
  swarm-data 1m bars Apr → Oct 2026 on the 13 coins not in research-data, through the live `onBar1m` path, with open
  interest. The 5m harness agrees with the 1m path on the 5 coins both have (Apr–Oct 2026): orb 603 vs 610 trades,
  −0.121 vs −0.114 R; intraday-trend −0.137 vs −0.134; it-45-long +0.103 vs +0.124.
- Costs as always (BloFin maker 2 / taker 6 bps, slippage 1.5 per taker side, funding). t on daily sums. "Before
  costs" = gross R.
- **Not covered:** oi-flush (no open interest in the hourly history), leader-follow (cross-coin). funding-fade-4h
  gets no trades in the hourly harness because it never feeds funding rates to the features; run on 5m bars it
  fires 47 times in two years on 20 coins, −0.04 R.

## Bug found: orb-retest's zone finder (fixed, plugin v2)

The first smoke run gave `orb-zone` 0 trades in three months of BTC. The demand/supply-zone search started one candle
too far back, so it never saw the newest zone, and it did not let the breakout candle be the last of the three strong
candles — the exact case in the video. Fixed in `src/strategies/orb_retest.js` (version 2, so its shadow record starts
over) and in `docs/pine/`; a new test covers the video's case. It does not change the verdict below: zone entries
are rare (41 of 11,190 trades) and the strategy has no edge either way.

## 1h–1d: what holds (avg R, t; IS | OOS-time | OOS-coins)

| Variant | IS | OOS-time | OOS-coins | Note |
|---|---|---|---|---|
| ma-retest-12h | +0.165 (1.7) | +0.141 (1.6) | +0.233 (3.6) | as on 10-23 (+0.186 / +0.147 / +0.236) |
| ma-retest-1d | +0.134 (1.0) | +0.085 (0.7) | +0.272 (2.8) | |
| rsi-macd-trend-12h | +0.135 (2.1) | +0.130 (1.6) | +0.128 (2.6) | |
| ma-retest-4h | +0.055 (1.0) | +0.048 (0.8) | +0.071 (1.8) | by year: 2024 +0.03, **2025 −0.04** |
| ma-pullback-12h | +0.019 (0.3) | +0.025 (0.4) | +0.078 (1.9) | |
| **ma-retest-4h-golden** | +0.139 (2.3) | +0.189 (3.0) | +0.111 (2.7) | reproduces docs/VIDEO_STRATEGIES exactly; beats ma-retest-4h every year 2021–2026 |
| ma-retest-12h-golden-fib | +0.267 (2.2) | +0.191 (1.6) | +0.233 (2.9) | reproduces |
| ma-retest-1d-golden | +0.326 (2.1) | +0.265 (2.0) | +0.225 (2.0) | reproduces; 2026 +0.06 |
| donchian-12h-60 (long only) | +0.096 (1.9) | +0.104 (1.8) | +0.045 (1.3) | |
| it-4h / it-12h / it-1d | +0.03 / +0.06 / +0.09 | +0.09 / +0.12 / +0.21 | +0.02 / +0.02 / +0.01 | thin on unseen coins |
| candle-soldiers-4h | +0.251 (1.1) | +0.248 (1.6) | +0.193 (1.7) | only ~50 trades a year; one of 28 candle variants: below the multiple-testing bar |

**Not driven by the crashes.** The OOS-coins sample includes LUNA, FTT, SRM and WAVES. They give 10% or less of the
trend family's R, and every variant stays positive without them (ma-retest-12h +0.218, ma-retest-1d +0.266,
ma-retest-4h-golden +0.111, rsi-macd-trend-12h +0.137).

**The donchian-1d shorts are a drag in every sample** (diagnosed in IS, holds in both OOS):

| | IS | OOS-time | OOS-coins |
|---|---|---|---|
| donchian-1d-60 long / short | +0.163 / −0.162 | +0.036 / −0.127 | +0.060 / −0.007 |
| donchian-1d-150 long / short | +0.048 / −0.236 | +0.239 / −0.338 | +0.125 / −0.139 |
| donchian-1d-20 long / short | +0.001 / −0.005 | +0.116 / −0.035 | −0.012 / +0.058 |

Long-only donchian-1d-60 and -150 are positive in all three samples; the 12h variant is already long-only for the
same reason. donchian-1d-20 has no edge on either side.

## 1h–1d: negative in all three samples (still enabled, in shadow)

| Variant | IS | OOS-time | OOS-coins |
|---|---|---|---|
| candle-engulfing-1h | −0.153 (−9.1) | −0.160 (−9.4) | −0.136 (−11.8) |
| candle-piercing-1h | −0.111 (−3.8) | −0.124 (−4.1) | −0.077 (−3.8) |
| candle-tweezer-4h | −0.107 (−3.3) | −0.110 (−3.3) | −0.108 (−4.8) |
| candle-star-4h | −0.194 (−4.6) | −0.114 (−2.6) | −0.117 (−4.0) |
| candle-engulfing-4h | −0.089 (−2.9) | −0.071 (−2.3) | −0.077 (−3.7) |
| krown-jewel-1h | −0.085 (−3.7) | −0.024 (−0.9) | −0.050 (−2.7) |
| pivot-matrix-4h | −0.040 (−1.4) | −0.077 (−2.8) | −0.032 (−1.6) |
| candle-doji-4h, candle-morning-star-4h, candle-piercing-4h, candle-doji-star-1h, candle-three-inside-1h, krown-jewel-2h | −0.01 to −0.24 | −0.03 to −0.12 | −0.03 to −0.11 |

No edge either way: wyckoff-spring-4h, adaptive-score-12h (+0.058 / −0.030 / +0.034), trend-pullback-1h (+0.02–0.03,
about 0.01 at 1.5× costs), donchian-1d-20, candle-marubozu, candle-soldiers-1h, candle-three-methods,
candle-three-outside-4h, candle-three-inside-4h, candle-doji-star-4h.

## 5–45m (avg R, t; IS | OOS-time | OOS-coins)

| Variant | IS | OOS-time | OOS-coins | Before costs (IS / OOS / coins) |
|---|---|---|---|---|
| **orb-retest** (default) | −0.210 (−5.3) | −0.119 (−3.5) | −0.134 (−2.5) | −0.11 / −0.01 / −0.01 |
| orb, range edge only | −0.205 | −0.113 | −0.140 | |
| orb, flip zone only | −0.193 | −0.115 | −0.148 | |
| orb, stop beyond the zone | −0.222 | −0.138 | −0.177 | |
| orb, 1.5R / 3R target | −0.188 / −0.224 | −0.107 / −0.119 | −0.140 / −0.137 | |
| orb, with the regime bias | −0.174 | −0.115 | −0.176 | |
| orb-chase (break taken at the close, no retest) | −0.205 | −0.138 | −0.133 | −0.08 / +0.01 / +0.03 |
| intraday-trend (15/30/45m) | −0.069 (−3.1) | −0.072 (−2.4) | −0.125 (−4.8) | |
| harmonic (5/15/30m) | −0.038 | −0.076 | −0.147 | |
| it-45-long | +0.186 (2.0) | +0.095 (1.3) | +0.174 (1.3) | +0.22 / +0.13 / +0.21 |
| it-45-hold32 | +0.132 (1.6) | +0.099 (1.3) | +0.029 (0.4) | |
| it-45-hold16 | +0.061 (1.1) | +0.087 (1.1) | −0.010 (−0.2) | |
| crowd-squeeze / squeeze-ride (1m only) | | | 12 tr −0.47 / 31 tr +0.25 (t 1.7) | |

- **orb-retest has no direction.** Before costs it is −0.11 to −0.01 R; costs (8 bps on a 93 bp risk) take
  another 0.09 R a trade. 60% of trades stop out, 25% reach 2R. Every setting loses in every sample, and the
  video's central claim — wait for the retest instead of chasing — makes no reliable difference (−0.157 vs −0.167 R
  over everything; the chase is slightly better before costs). The New York open is not a special moment for crypto.
- **it-45 is the one sub-hour family that makes money**, and only its longs (it-45-hold32: longs +0.164, t 2.6;
  shorts +0.06). But its settings were picked on the factory's Apr–Oct 2026 data (best of 29 tries), which overlaps
  this run's OOS-time and OOS-coins samples. The clean sample is IS (Oct 2024 → Aug 2025): it-45-long +0.186, t 2.0.
  Promising, not proven. The 5-year sweep never ran a 45-minute frame.

## The PC (swarm-state, 2026-10-24 07:13 UTC)

Paper equity $10,752 (start $10,000), drawdown 7.0%, 92 trades. Per PROGRESS (07:45) it trades it-4h,
ma-retest-12h, ma-retest-4h and rsi-macd-trend-12h: all four are positive in all three samples; ma-retest-4h and
it-4h are the thinnest. The PC has the it-45 trio **off**, although the config has them in shadow. Live strategy
records are too short to judge (at most 42 trades per strategy). The mode list still holds three misspelled names
from earlier `/mode` typos (`candel-harami-1h`, `candel-harami-4h`, `wykoff-spring`); `/mode <name> off` removes them.

## Recommendations

Shadow-only changes (install themselves after the tests pass):

1. **orb-retest → off.** No edge before costs, negative in every sample and setting.
2. **donchian-1d-60 and donchian-1d-150 → long only** (`shorts: false`). The shorts lose in all three samples.
3. **it-45-long back to shadow on the PC** (it is off there), so it builds a clean out-of-sample record. Not trade.

Ibrahim's calls:

4. **ma-retest-4h → ma-retest-4h-golden** as the 4h trade candidate once the golden variant has a live record. The
   plain 4h retest was flat in 2024–2025; rule v2 already flags it (+0.0275 R < 0.03).
5. **Retire the variants negative in all three samples**, starting with candle-engulfing-1h, candle-piercing-1h and
   krown-jewel-1h (t ≤ −2.7 on unseen coins). The 4h candles and pivot-matrix-4h are queued for the 5-year sweep;
   this run agrees with retiring them.
6. **Follow-up:** make tools/hourly_backtest.js feed funding rates to the features (funding-fade cannot be tested
   there now).

## Reproduce

    node swarm/tools/hourly_backtest.js --data <research-data> --variants v.json --from 2020-01-01 --split 2024-01-01 --out out/h-research
    node swarm/tools/hourly_backtest.js --data <validation-data> --variants v.json --from 2020-01-01 --out out/h-validation
    node swarm/tools/subhour_backtest.js --mode 5m --data <research-data> --variants v5m.json --split 2025-09-01 --out out/s5
    node swarm/tools/subhour_backtest.js --mode 1m --data <swarm-data> --variants v5m.json --coins AAVE,ADA,ALGO,ARB,AVAX,BCH,BNB,CRV,DOT,ICP,QNT,SAND,UNI --warmup-days 21 --out out/s1

v.json = every enabled config strategy at 1h or slower ({name, base, params} from config/swarm.json). v5m.json =
orb-retest with `{}`, `{level:'edge'}`, `{level:'flip'}`, `{level:'zone'}`, `{stop:'zone'}`, `{tgtR:1.5}`,
`{tgtR:3}`, `{withBias:true}`, base `orb-chase`, and intraday-trend, it-45-long, it-45-hold32, it-45-hold16,
harmonic with their config params (plus crowd-squeeze and squeeze-ride for the 1m run).
