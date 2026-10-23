# Live review: the PC's paper run, 2026-10-21 04:58 → 2026-10-23 03:38 UTC (47 h)

Sources: branch `swarm-state` (state.json every 10 min, trades.jsonl, shadow.jsonl, decisions.jsonl, all appended),
`swarm-factory` (6.5-month backtests), `swarm-reports` (5-year sweep). Commands at the end.

## Bottom line

1. **Equity $10,278 (+2.8%), but that is one market bet, not an edge.** The account traded for only the last 8 hours
   (strategies switched to `trade` around 19:30 UTC on the 22nd). Realised P&L was **−$97.79** on 10 trades; the
   +$376 is unrealised, on 22 long altcoin positions opened into the bounce of the 23rd.
2. **A hard limit was broken.** At 22:38 UTC the account held 29 positions (27 long) at **5.07× gross** (limit 4×)
   and **6.8× net BTC exposure** at a typical alt beta of 1.5 (limit 2×). Cause: the code on the PC let every order of
   one bar close see the same room; orders in flight did not count. This is already fixed on `main` (`675c556`, "in-flight orders
   count in risk checks"). The fix is protected, so it waits for your approval on the PC. Replaying that night's 29
   positions through the fixed check: 15 kept, 14 rejected, **gross 1.87×, net BTC 2.00×**.
3. **All 12 strategies in `trade` lose in every backtest we have** (6.5-month factory: −0.11 to −0.36 R per trade,
   t −3 to −11). Their good-looking 2-day shadow numbers come from the market's direction: over these two days
   **shorts earned +0.48 R a trade and longs lost −0.57 R**, and nothing is significant once trades entered in the
   same hour are counted as one.
4. The strategies with positive evidence are not trading: `ma-retest-12h`, `rsi-macd-trend-12h`, `donchian-12h-60`
   (shadow), `it-4h` (off). The trend sleeve (PR #2) has the best evidence of all (Sharpe 0.84 on 30 unseen coins).

## The account

| UTC | Equity | Positions (long / short) | Gross | Stop risk |
|---|---|---|---|---|
| 21st 04:58 → 22nd 18:38 | $10,000 | 0 (everything in shadow) | 0 | 0 |
| 22nd 19:38 | $9,986 | 1 / 0 | 0.13× | 0.1% |
| 22nd 20:38 | $9,937 | 8 / 2 | 1.10× | 1.6% |
| **22nd 22:38** | **$9,878** | **27 / 2** | **5.06×** | 5.4% |
| 22nd 23:38 | $9,751 (low) | 24 / 2 | 4.70× | 4.1% |
| 23rd 02:38 | $10,309 (high) | 22 / 1 | 4.01× | 6.0% |
| 23rd 03:38 | $10,278 | 22 / 1 | 4.02× | 4.9% |

At 22:00:04 one decision cycle approved **20 orders** (ARB, BNB, DASH, DOGE, ETC, ETH, FIL, HBAR, HYPE, ICP, LINK, NIL,
OP, PENDLE, QNT, SEI, SHIB, TRX, XRP…). Each was trimmed only by book depth or its own coin's notional, never by
gross or BTC exposure. From 00:00 on, every new idea was rejected for "gross notional", then "net BTC exposure",
because the book was already far past both limits. The exposure was all in one direction: a long altcoin basket, about 6.8× BTC.

Closed trades (10): intraday-trend 4 (−$69.55, −2.65 R), wyckoff-spring-1h 2 (−$41.95, ICP shared with candle-engulfing-1h), dip-reversal 3
(+$8.86), candle-three-outside-1h 1 (+$25.63, target), candle-engulfing-1h 1 (shared ICP stop). Open P&L by
strategy: candle-engulfing-1h +$210, wyckoff-spring-1h +$88, candle-three-outside-1h +$40.

## Shadow trades (1,320 closed during this run, all strategies)

| | Trades | Avg R |
|---|---|---|
| Longs | 698 | **−0.567** |
| Shorts | 622 | **+0.483** |
| 21st: longs / shorts | 155 / 313 | −0.13 / +0.61 |
| 22nd: longs / shorts | 503 / 270 | −0.81 / +0.40 |
| 23rd: longs / shorts | 40 / 39 | +0.81 / +0.06 |

The market fell on the 21st–22nd and bounced on the 23rd; every strategy's result follows its long/short mix.
Trades opened in the same hour move together, so the honest t-stat counts each hour once ("t, by hour"):

| Strategy | Mode | Trades | Avg R | t | t, by hour | Long avg R | Short avg R | Factory backtest avg R (t) |
|---|---|---|---|---|---|---|---|---|
| intraday-trend | trade | 177 | +0.15 | 3.0 | **0.26** | −0.29 | +0.20 | −0.118 (−9.96) |
| candle-engulfing-1h | trade | 102 | +0.11 | 0.75 | 0.63 | −0.56 | +1.06 | −0.223 (−10.72) |
| wyckoff-spring-1h | trade | 52 | +0.62 | 2.2 | 1.43 | −0.60 | +1.21 | −0.130 (−3.43) |
| candle-three-outside-1h | trade | 42 | +0.72 | 3.1 | 1.08 | −0.24 | +1.20 | −0.147 (−5.65) |
| dip-reversal | trade | 36 | +0.19 | 2.4 | −0.05 | +0.19 | — | −0.123 (−10.56) |
| candle-engulfing-4h | trade | 15 | +0.75 | 1.8 | 0.89 | −1.21 | +1.05 | −0.112 (−2.75) |
| candle-harami-4h | trade | 13 | +1.45 | 4.5 | 1.78 (3 hours) | +1.96 | +1.41 | −0.233 (−3.90) |
| ma-21-200 (plugin default, not the 12h variant) | trade | 7 | +0.84 | 1.5 | 1.5 | — | +0.84 | −0.106 (−6.28) |
| session-drive | trade | 5 | −0.33 | −1.1 | −1.2 | −0.33 | — | −0.173 (−5.01) |
| candle-star-4h, morning-star-4h, piercing-4h | trade | 5, 4, 4 | +0.8 to +2.0 | — | 1–2 hours each | — | + | −0.06 to −0.12 |
| overshoot-fade | off | 155 | −0.36 | −2.7 | **−2.7** | −0.80 | +0.15 | −0.339 (−14.1) |
| candle-tweezer-1h | off | 116 | −0.28 | −2.2 | −0.99 | −0.72 | +0.87 | −0.251 (−11.31) |
| rsi-macd (default) | off | 102 | −0.69 | −6.5 | −1.67 | −0.69 | −0.36 | −0.102 (−4.86) |

The only result that holds up after grouping by hour is overshoot-fade's loss (already off). The live run agrees
with the backtests once direction is taken out: the 1h candle and Wyckoff strategies make money only on whichever side
the market happened to favour.

Mechanics look right: no strategy is stopped out instantly by a bug. The 1h and 4h strategies hold their stops
1–3% away (median), with costs 5–15% of R; the sub-hour ones (overshoot-fade, leader-follow, harmonic) pay about
0.3 R a trade in costs, which is why the sweep found nothing below 1h.

## Checked and ruled out

- **Betas too low for the BTC-exposure limit?** The brain measures betas on 1-minute returns, and very short returns
  can understate co-movement. Measured on research-data (12 alts, 5-minute returns over 1 day, averaged over 60 days)
  against 1-hour (14 days) and daily (60 days): 1.2–2.1 against 1.2–2.7 and 1.0–2.3, with no systematic
  understatement. The limit failed because orders in flight weren't counted, not because of the betas.

## What to do (yours: /mode on Telegram, approvals on the PC)

1. **Approve the pending protected update** (`swarm-approve` / approve.ps1). It contains the in-flight fix, which is
   what kept the gross and BTC limits from working.
2. **Put the 12 losing strategies back in shadow** (shadow costs nothing and keeps collecting evidence):
   `/mode intraday-trend shadow`, `/mode session-drive shadow`, `/mode dip-reversal shadow`, `/mode ma-21-200 shadow`,
   `/mode wyckoff-spring-1h shadow`, `/mode candle-engulfing-1h shadow`, `/mode candle-engulfing-4h shadow`,
   `/mode candle-star-4h shadow`, `/mode candle-morning-star-4h shadow`, `/mode candle-piercing-4h shadow`,
   `/mode candle-harami-4h shadow`, `/mode candle-three-outside-1h shadow`.
   Remove the typos the old /mode accepted: `/mode candel-harami-4h off`, `/mode candel-harami-1h off`,
   `/mode wykoff-spring off`, `/mode candle off` (the updated Herald removes a listed typo this way).
3. If you want paper trades in the meantime, use the slow strategies with evidence: `ma-retest-12h`,
   `rsi-macd-trend-12h`, `donchian-12h-60`, `it-4h`. None has passed the factory gate yet: too few trades in 6.5 months,
   or a t-stat below the 3.2 bar for 248 tries. They are the best the idea path has.
4. Review PR #2 (trend sleeve, shadow).
5. The open paper positions: 22 longs at ~4× gross. With the fix installed, nothing new opens until gross and BTC
   exposure fall back inside the limits; the existing ones run to their stops and targets. `/flatten` closes them now if
   you would rather start clean.

## Long/short test: should the slow strategies trade one side only? No.

The 5-year sweep's best variants earned most of their R on shorts (ma-retest-12h long +80 / short +156 R,
rsi-macd-trend-12h −120 / +440, it-4h +85 / +463), and the live shadow trades above favoured shorts too. Before
adding short-only variants I tested both sides separately on the factory data (31 coins, 2026-04 → 2026-10, live code
path and costs; `sides` filter of the strategy kit):

| Variant | Both sides: trades / avg R / t | Long only | Short only |
|---|---|---|---|
| it-4h | 579 / +0.083 / 1.72 | 349 / **+0.207 / 2.89** | 231 / −0.104 / −1.97 |
| rsi-macd-trend-12h | 262 / +0.289 / 3.39 | 189 / **+0.372 / 3.54** | 169 / −0.010 / −0.10 |
| ma-retest-12h | 54 / +0.557 / 2.81 | 45 / **+0.735 / 3.44** | 9 / −0.334 / −0.77 |
| donchian 12h × 60, with shorts | 279 / +0.215 / 3.43 | 207 / **+0.289 / 3.90** | 82 / +0.132 / 1.11 |
| ma-retest-1d | 0 trades (needs 200 daily bars; the factory warms up 21 days) | | |

In 2026 the longs carry these strategies and the shorts lose: the opposite of 2021–2026 as a whole. Which side pays
depends on the period, so a one-sided filter would be fitted to whichever period we looked at last. **No side filter
was added**; the strategies keep trading both sides, and the trend sleeve, whose shorts come only from 1d-and-slower
trends, is the structural answer. The variants are logged in `swarm-factory` trials.jsonl: 11 new tries, 259 in total, so the t-stat bar is now 3.21.

`ma-retest-1d` cannot be judged by the factory at all: it needs 200 daily bars, and the factory warms up 21 days.
Its only evidence is the 5-year sweep.

## Commands

    git archive origin/swarm-state | tar -x -C state        # the PC's published state
    node swarm/src/tools/review.js state --factory factory   # report cards
    # long/short test: swarm/src/backtest/run.js backtest() with variants {base, params: {..., sides: [1] | [-1]}}
    #                  on swarm-data, warmupDays 21 (the factory's settings)
