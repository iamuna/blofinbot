# Research log

The researcher's notebook (newest first). Every idea, why it might work, how it was tested, and the verdict. Tries
counted in `swarm-factory/trials.jsonl` — the multiple-testing bar for the backtest gate is 2 + 0.5·log10(tries).

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
5. **More squeezes** — the squeeze signal fires 0.6 times a day; a lower bar (z 2.5, open interest −1%) would show
   whether the effect has breadth or was a handful of big days.

## 2026-10-20 00:40 — the six starting strategies (from docs/BACKTEST_2026-10-20.md)

None of intraday-trend, trend-pullback, session-drive, overshoot-fade, leader-follow, crowd-squeeze, noise-breakout
or 23 variants made money after costs; most had no edge before costs. Best: it-45-long (+0.14 R, t 2.5) — best of
29 tries, long-only in a rising universe: kept in shadow, not trusted. Longer holds did better at every step.
