# Daily review — 2026-10-21 (run 05:42 UTC)

## Money and risk
- Account **PAPER**: equity $10,000 (start $10,000), drawdown 0.0 %, today 0.00 %, 0 paper trades, fees $0, funding $0. No open positions or working orders.
- Risk mode **normal**, budget scale 1, signed limits hash 00fb82bc38ee8f7f (guardian: signed). No pause in `control.json` (file absent) — nothing broken enough to pause.
- News windows today: **0** (events agent).

## Home PC (state 05:38 UTC)
- **67/67 agents ok.** Processes restarted 04:58 UTC (the approved /status update, 99c031e, appears installed — herald ok, 15 messages).
- Brain: 70 coins, **seededBars 126,331**, 70/70 warmed — the 1h–1d seeding works.
- Data: guard median lag 278 ms, 69/70 tradable (WLFI: wide spread). Recorder ~81 MB in this run, 19 files compressed. Watchdog: disk 74.6 % free, 2.2 of 4.0 GB RAM free.
- Every strategy is in **shadow**; none trades. overshoot-fade and trend-pullback show mode `off` on the PC.

## Shadow record so far (since 2026-10-20 08:05 UTC — about 21 hours, far too short to judge)
| Strategy | Shadow trades | Avg R | Note |
|---|---|---|---|
| trend-pullback (5m, now off) | 72 | −0.63 | worse than backtest |
| overshoot-fade (1m, now off) | 44 | −0.88 | worse than backtest |
| leader-follow | 50 | −0.18 | |
| intraday-trend | 11 | −0.76 | |
| dip-reversal | 8 | −0.01 | all time stops 10-20 15:15 |
| session-drive | 4 | +1.54 | one burst 10-20 14:00, same direction on 4 coins — one event, not 4 independent wins |
| candle-star-1h | 2 | −1.38 | VVV and HYPE shorts stopped within 7 min; HYPE stop was only 26 bps so fees+slip made it −1.57 R |

Slow (1h–1d) strategies: first ideas arrived today at 05:00 UTC after the restart — candle-star-1h (HYPE short, stopped), krown-jewel-1h (PEPE long, open), candle-three-outside-1h (STRK and ZEC shorts, open). ma-retest-12h/1d, it-4h, rsi-macd-trend-12h and trend-pullback-1h: no ideas yet (expected — they trade rarely; judge on weeks).

## Live gate
Ready for real money: **none** (0 demo trades; the gate needs ≥ 200 demo trades, avg R > 0 with t ≥ 2).

## Factory (tested 03:47 UTC, 241 tries → t bar 3.19)
No strategy passes the backtest gate. New from the researcher today: funding-fade plugin (in shadow) and funding-fade-4h factory candidate (backtest −0.32 R — not configured).

## Agent manager — NOT run this session
The sandbox's auto-mode classifier blocked running `agent_manager.js` (with and without `--apply`), so `swarm.json` is unchanged. Applying its auto-retire rule (backtest n ≥ 300, avg R < 0, t ≤ −3, not trading, no positive 100+ trade shadow record) by hand to the factory results, it **would retire 20 strategies**: noise-breakout, trend-pullback, overshoot-fade, leader-follow, intraday-trend, session-drive, dip-reversal, ma-21-200, rsi-macd, wyckoff-spring-1h, and candle-doji-1h, candle-engulfing-1h, candle-hammer-1h, candle-hammer-4h, candle-harami-1h, candle-harami-4h, candle-morning-star-1h, candle-star-1h, candle-three-outside-1h, candle-tweezer-1h.

**Not applied on purpose as well:** Ibrahim asked last night (2026-10-21) for every retired strategy to run in shadow again. Shadow costs no money, so overriding his explicit request is not the reviewer's call. Decision for Ibrahim: keep them in shadow to collect a live record, or let the agent manager retire them (the backtest evidence for these 20 is decisively negative).

## Waiting for Ibrahim
1. Decide on the 20 retire-eligible strategies (above).
2. BloFin **demo key** still not installed — demo trading (and so the live gate) cannot start without it (`sudo swarm/deploy/enable-demo.sh` / Windows equivalent in docs/LAUNCH.md).
3. No pending approvals seen in state; live decisions: none due.
