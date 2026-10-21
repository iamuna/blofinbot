# Research log

The researcher's notebook (newest first). Every idea, why it might work, how it was tested, and the verdict. Tries
counted in `swarm-factory/trials.jsonl` — the multiple-testing bar for the backtest gate is 2 + 0.5·log10(tries).

## 2026-10-21 03:40 — verdicts on the 1h/4h retail set; new try: funding-crowd fade (4h, 12h)

**Tries: 240 (factory `trials.jsonl`, run 2026-10-21 02:41) → t bar 3.19.** Nothing passes the backtest gate.

Factory verdicts (6.5 months × 31 coins) on the strategies added 2026-10-20/21 (all in shadow at Ibrahim's request,
none from a researcher candidate file, so nothing to move to `rejected/`):

- **Japanese candlesticks (14 families × 1h/4h, 28 tries)**: 23 of 28 lose; the 1h versions lose everywhere
  (hammer −0.36 R, star −0.30, doji −0.26, tweezer −0.25, engulfing −0.22, all t < −2). Positive only on tiny counts:
  marubozu-4h +0.20 R (121 trades, t 1.67), doji-star-4h +0.43 (36), three-methods-1h +0.30 (43). Noise-level;
  candidates for retirement when the agent manager sees their shadow record.
- **Krown-style EMA + stoch RSI**: 1h −0.07 R (t −2.95), 2h −0.03 R. No edge.
- **Wyckoff spring/upthrust**: 1h −0.13 R (t −3.4), 4h +0.01 R (426 trades, negative at 1.5× costs). No edge.
- **Earlier slow ones on the 6.5-month data**: rsi-macd-trend-12h +0.30 R, t 3.55, 259 trades, positive in all
  thirds — misses only on trade count (300); ma-retest-12h +0.56 R on 54 trades (t 2.81); it-4h +0.08 R (t 1.75).
  All already in shadow. These agree with the 5-year sweep (rsi-macd-trend@12h +0.09 R, ma-retest@12h +0.14 R).
- Lesson: chart-pattern families on 1h are a cost machine; the 4h versions are less bad but not good. Nothing in
  this batch earns a 5-year sweep run before its shadow record says otherwise.

**Sweep** (swarm-reports history/LATEST.md, 2026-10-20): unchanged since yesterday's entry below — walk-forward
Sharpe 0.49 (t 0.97), best single ma-retest@12h; the slow edges are mostly short.

### New try (2 sweep variants + 1 factory candidate): `funding-fade`

- **Mechanism**: when funding stays high for days, leveraged longs are crowded and paying to hold. Once price breaks
  down, the most leveraged hit liquidation or cut, and that forced selling extends the move; the short also collects
  the funding. Mirror: deeply negative funding for days, shorts crowded, break up → long. This is the first slow
  strategy that uses information the candle tests never had (funding history), and it lines up with our finding
  that the slow edge is mostly short.
- **Source**: Schmeling, Schrimpf & Todorov, "Crypto carry" (BIS Working Paper 1087, 2023; Management Science):
  high crypto carry (futures premium / funding) predicts crash risk and long liquidations. Different from
  `crowd-squeeze` (5/15-minute breakout with OI rising, 26 trades in 6.5 months): this needs a 72-hour funding
  average, works on 4h/12h bars and holds for days.
- **Rule** (declared before any result, one parameter set): average of the last settled funding sampled each bar
  over 72h ≥ 0.03%/8h and the latest rate ≥ 0.03% (or both ≤ −0.03%); the bar closes past the previous 3 bars'
  low (high); stop 0.5 ATR beyond the 3-bar extreme; no target; time stop 12 bars (2 days on 4h, 6 days on 12h).
- **Tests**: plugin `swarm/src/strategies/funding_fade.js` + `test/funding_fade.test.js`; factory candidate
  `funding-fade-4h`; 5-year sweep group `funding-fade` @240 and @720 (`history/sweep.js`, rerun started by this
  push). Judge it on the sweep: 6.5 months will hold only a few dozen trades. Promotion only if the sweep shows it
  positive at 1.5× costs in most years and on both the long and the short side being explained.
- Not built today (one idea is enough): OI-trend divergence on daily bars; the liquidation/book ideas still need
  weeks of home-PC recordings.

## 2026-10-20 15:45 — 5-year sweep: every strategy × every timeframe (1m → 1d), walk-forward

Ibrahim: rethink timeframe selection, trade only the highest return-per-risk combinations, test on 3–5 years.
101 variants (13 strategies × 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 12h, 1d) on Binance USD-M 2021-10 → 2026-09,
point-in-time universe (665 coins ever in it, ~80 a day, dead coins included), live code path and costs. Report:
`swarm-reports` history/2026-10-20/REPORT.md (code: `history/`). 98 tries logged (199 in total).

- **Timeframe**: every variant on 1m–30m loses (Sharpe −0.3 to −50); positive ones only on 1h–1d. Best per chart:
  1h +0.51 (trend-pullback), 2h +0.55 (intraday-trend), 4h +0.61 (intraday-trend), 12h +1.28 (ma-retest), 1d +0.84
  (ma-retest).
- **Walk-forward** (declared before: 12-month window, top 5 by Sharpe, quarterly): 2022-10 → 2026-09 +679 R, Sharpe
  0.49, t 0.97, max DD 658 R — ≈ +5%/year sized for a 20% worst drawdown. 2023 lost, 2025 won. Best 5 in hindsight
  Sharpe 0.92: half of the hindsight edge is luck. Robustness grid (6/12/24 months × top 3/5/10): Sharpe 0.25–0.65.
  Ranking by last year's Sharpe chases last year's lucky variants — not a usable selector on its own.
- **Best single**: ma-retest@12h (21/200 EMA retest, Ibrahim's idea): 1,657 trades, +0.14 R, positive every year
  2022–2026, +229 R even at 1.5× costs. Best of 101 → treat as a candidate, not a result.
- **The edge is mostly short**: ma-retest@12h long +80 / short +156 R; @1d −18 / +135; intraday-trend@4h +85 / +463;
  rsi-macd-trend@12h −120 / +440. Shorting altcoins in established downtrends (coins that fade after their volume
  peak, dead coins included) carries most of it. Needs its own check before trusting: BloFin listing of those
  coins, short squeezes, borrow/funding at extremes.
- Bug found and fixed in the sweep: R = net / (fill-to-stop distance) blows up when a limit fills at its stop
  (noise-breakout, leader-follow showed average R in the millions). The sweep now uses ≥ 10 bps of risk; the same
  fix is due in swarm/src/backtest/exec_sim.js (factory + live shadow; protected).

## 2026-10-20 09:20 — Ibrahim's retail strategies: RSI + MACD, Carney harmonics, 21/200 moving averages

Asked for by Ibrahim. Plugins `rsi-macd`, `harmonic`, `ma-21-200` (not configured to run). Same dataset, costs and
simulator as the factory; 38 tries logged (now 101 in total → t bar 3.0). 1h/4h runs added the timeframes in the
test script only (features TFS + plugin tfs), not in the live code.

| Strategy, best versions | Chart | Trades | Win | Avg R | t | Test (Sep–Oct) n / avg R |
|---|---|---|---|---|---|---|
| RSI+MACD oversold bounce, maker | 15m | 3,840 | 40% | −0.05 | −2.5 | 1,087 / −0.07 |
| RSI+MACD, 10 other versions (5m–4h, trend/reversal, trailing exits) | | | | −0.06 to −0.40 | | all negative |
| Harmonic (Gartley/Bat/Butterfly/Crab), limit at D, waits 12h | 15m | 615 | 35% | −0.06 | −0.9 | 161 / +0.09 |
| Harmonic, confirmation entry | 15m | 425 | 52% | −0.16 | −3.2 | 100 / −0.09 |
| Harmonic | 1h | 100 | 41% | +0.12 | 0.8 | 15 / +0.77 |
| 21/200 cross | 15m | 4,548 | 31% | −0.28 | −13.1 | 1,188 / −0.23 |
| 21/200 retest (cross, pull back to the 21, hold) | 15m | 6,395 | 36% | −0.11 | −6.3 | 1,698 / −0.02 |
| 21/200 pullback (any time in trend) | 1h | 3,700 | 36% | −0.06 | −2.8 | 955 / 0.00 |
| 21/200 retest | 4h | 240 | 41% | +0.03 | 0.3 | 49 / +0.50 |
| 21/200 pullback, trailing ride | 4h | 809 | 41% | +0.04 | 0.8 | 244 / +0.12 |

- **RSI + MACD has no edge on any chart, 5m to 4h**; trailing exits made it worse. Rejected.
- **Harmonics**: a small reaction at the D zone before costs on 15m (+13 bps gross) that costs eat. Confirmation
  entries raise the win rate (52%) but lose more (worse price, same stop). 1h is positive on 100 trades: noise-level.
- **21/200**: entering on the cross is late (−0.28 R); the pull-back retest is much better, and on 4h it turns
  slightly positive (+0.02 to +0.04 R, t < 1), positive in 2 of 3 thirds and in the test period. Long-biased in a
  rising universe. Lesson again: longer holds and bigger charts do better because costs shrink against the move.
- **Next (if Ibrahim agrees)**: 3–5 years of 1h/4h bars from Binance's public archive to test 21/200 4h and
  harmonics 1h/4h across bull and bear markets — as a slow sleeve, not part of the 1–45 minute swarm.

## 2026-10-20 — open-interest moves and funding settlements

**Tries so far: 59 before today's backtests** (10 factory runs + 19 variant backtests run outside the factory on
2026-10-20 00:40, backfilled + 30 exploratory study cells below) → bar 2.89.

### Exploratory event studies (31 coins × 6.5 months, 1-minute bars, open interest every 5 minutes)

Counted as tries: one per condition (not per horizon). t-stats average across coins at each timestamp first, so a
market-wide move counts once.

**Funding settlements** (12 tries: 6 funding buckets × before/after). No robust effect. Across all buckets the
45 minutes around settlements drift up 1–14 bps depending on the hour, mostly in August–September (t ≤ 2.3).
The one striking cell: after a settlement with funding below −0.03% (shorts paying), the next 45 minutes averaged
**−25 bps** (173 settlements, t −2.6) — but concentrated in SAND, ZEC, INJ, BCH, and the mirror case (funding above
+0.03%) does not show the opposite. Not built; worth watching on live data.

**15-minute moves by open-interest change** (18 tries: 3 sizes × 6 conditions). Forward returns in bps:

| After a 15-minute move of ≥ 3.5 standard deviations | Next 15 min | 30 min | 45 min | 60 min |
|---|---|---|---|---|
| Drop, any open interest (3,525 times) | +3 | +13 | +23 | **+28 (t 5.2)** |
| Drop, open interest up (new shorts) | +8 | +17 | +21 | +25 (t 3.8) |
| Drop, open interest down 1.5%+ (long flush) | −15 | +2 | +21 | +25 (t 1.2) |
| Jump, open interest down 1.5%+ (short squeeze, 241 times) | +45 | +65 | +77 | **+78 (t 2.5)** |
| Jump, open interest up (new longs) | +7 | +10 | +9 | +6 (t 1.2) |

Checks on the two lines that look tradable:
- Dip reversal holds after removing the whole market's move (+22 bps, t 4.4), in 6 of 7 months; it is almost all in
  coins outside the majors (+36 bps vs +3 bps for BTC, ETH, SOL, XRP, BNB, DOGE, ADA, LINK, LTC, BCH, AVAX, DOT).
- The squeeze line is weaker after removing the market's move (+48 bps, t 1.6) and leans on September.
- Big caveat for both: long-only, in coins chosen by today's volume that rose ~80% on average over the period.

Built: `dip-reversal` (buy a 15-minute drop of 3.5+ sd, hold 60 min, stop one drop-length lower) and `squeeze-ride`
(buy a 15-minute jump of 3.5+ sd while open interest falls 1.5%+, hold 60 min, stop at the jump's start), each with
a maker and a taker entry (4 tries).

### Backtests (same code as live, costs and fill rules of the execution simulator)

Tries after these: 63 (bar 2.90).

| Variant | Trades | Per day | Win rate | Avg net bps | Avg R | t | Avg R at 1.5× costs | Thirds (sum R) | Sep–Oct test: n / avg R / t |
|---|---|---|---|---|---|---|---|---|---|
| squeeze-ride, maker entry | 104 | 0.58 | 54% | +62.2 | **+0.218** | 2.80 | +0.195 | +6.4 / +4.6 / +11.6 | 31 / +0.287 / 1.76 |
| squeeze-ride, taker entry | 104 | 0.58 | 52% | +58.6 | +0.212 | 2.65 | +0.176 | +6.6 / +3.6 / +11.8 | 31 / +0.308 / 1.82 |
| dip-reversal, maker entry | 3,729 | 20.7 | 47% | −13.1 | −0.123 | −10.56 | −0.163 | −143 / −233 / −83 | 1,082 / −0.074 / −3.35 |
| dip-reversal, taker entry | 3,764 | 20.9 | 45% | −16.5 | −0.157 | −13.26 | −0.221 | −189 / −284 / −116 | 1,087 / −0.098 / −4.31 |

- **Dip reversal fails once it has a stop.** Trades that reached their 60-minute exit made +32 bps net, but 23% kept
  falling and hit the stop one drop-length lower (−164 bps). The event study's +28 bps came from holding through
  further crashes into the rebound — that is unlimited risk, not an edge we can size. Lesson: an event study's
  average return is not a strategy's; test with the exits it will really have.
- **Squeeze ride is the first 1–45 minute strategy with a positive backtest after costs**: +62 bps a trade net,
  +0.22 R, positive in 6 of 7 months and spread over many coins (ZEC 11 trades, PEPE 9, ETH 7, SOL 7, …), most
  trades end at the 60-minute exit. But only 104 trades (gate needs 300) and t 2.8 is below the bar of 2.90;
  long-only in a rising universe. **Added to shadow as a "watch" strategy (maker entry)**: it trades only if its live
  record earns it — the out-of-sample route needs 150 shadow trades (~8–9 months at this rate) with t ≥ 2.

## Ideas queue

1. **Funding reset** — short after a settlement with funding below −0.03%, hold 45 min. Needs live evidence first.
2. **Liquidation intensity** — Binance liquidation stream (recorded live from day 1): does a burst of forced longs
   closing mark the bottom better than open interest does? Needs ~2 weeks of recordings.
3. **Book imbalance** — BloFin top-5 book (recorded live): imbalance before 1–5 minute moves. Needs recordings.
4. **Dip reversal with room to breathe** — a stop 3× the drop (or none, with small fixed size) and the rebound
   window of 60–120 min; outside the majors only. Every one of these is fitting to the same data: one try, then judge.
5. **Funding-fade variants** — only after the sweep verdict: a 0.05% bar, a 7-day average, or funding relative to
   the coin's own history. Each is another try.
6. **More squeezes** — the squeeze signal fires 0.6 times a day; a lower bar (z 2.5, open interest −1%) would show
   whether the effect has breadth or was a handful of big days.

## 2026-10-20 00:40 — the six starting strategies (from docs/BACKTEST_2026-10-20.md)

None of intraday-trend, trend-pullback, session-drive, overshoot-fade, leader-follow, crowd-squeeze, noise-breakout
or 23 variants made money after costs; most had no edge before costs. Best: it-45-long (+0.14 R, t 2.5) — best of
29 tries, long-only in a rising universe: kept in shadow, not trusted. Longer holds did better at every step.
