# Swarm smoke run

Recorded 8.0 minutes (2026-10-23T15:38:49.118Z → 2026-10-23T15:46:49.278Z).

| Type | Messages |
|---|---|
| account | 98 |
| event.window | 1 |
| exec.fill | 5 |
| feat.bar | 140 |
| guard.status | 28 |
| idea | 3 |
| intent | 3 |
| md.bar | 279 |
| md.book | 13735 |
| md.funding | 199 |
| md.ticker | 7289 |
| md.trade | 1845 |
| order | 3 |
| ref.bar | 280 |
| ref.flow | 475 |
| ref.liq | 60 |
| ref.mark | 48 |
| regime.state | 1 |
| risk.decision | 3 |
| risk.state | 159 |
| shadow.trade | 2 |
| sys.alert | 32 |
| sys.heartbeat | 3897 |
| trade.closed | 2 |

| Coin | BloFin bars | books | trades | tickers | median spread bps | Binance bars | flow secs | liqs | guard |
|---|---|---|---|---|---|---|---|---|---|
| AAVE | 8 | 356 | 58 | 207 | 2.04 | 8 | 237 | 1 | tradable |
| AERO | 8 | 170 | 9 | 207 | 2.71 | 8 | 341 | 0 | tradable |
| ARB | 8 | 356 | 45 | 207 | 1.68 | 8 | 308 | 0 | tradable |
| ASTER | 8 | 239 | 20 | 209 | 1.41 | 8 | 180 | 0 | tradable |
| AVAX | 8 | 470 | 60 | 207 | 2.20 | 8 | 260 | 0 | tradable |
| BCH | 8 | 240 | 62 | 209 | 0.70 | 8 | 278 | 0 | tradable |
| BNB | 8 | 473 | 35 | 209 | 0.27 | 8 | 354 | 0 | tradable |
| BTC | 8 | 471 | 147 | 209 | 0.04 | 8 | 457 | 6 | tradable |
| DOGE | 8 | 359 | 74 | 209 | 2.50 | 8 | 295 | 0 | tradable |
| ENA | 8 | 473 | 61 | 209 | 2.95 | 8 | 394 | 2 | tradable |
| ETH | 8 | 473 | 119 | 207 | 0.08 | 8 | 468 | 4 | tradable |
| HBAR | 8 | 426 | 55 | 207 | 2.54 | 8 | 216 | 0 | tradable |
| HYPE | 8 | 359 | 77 | 209 | 0.26 | 8 | 373 | 0 | tradable |
| INJ | 8 | 470 | 352 | 208 | 2.56 | 8 | 319 | 1 | tradable |
| IOST | 8 | 470 | 108 | 208 | 5.25 | 8 | 431 | 21 | tradable |
| LIT | 8 | 470 | 126 | 208 | 0.60 | 8 | 465 | 0 | tradable |
| LITE | 8 | 229 | 41 | 209 | 1.93 | 8 | 275 | 0 | tradable |
| PENGU | 8 | 170 | 21 | 208 | 3.74 | 8 | 242 | 0 | tradable |
| PUMP | 8 | 470 | 73 | 208 | 4.40 | 8 | 296 | 3 | tradable |
| Q | 8 | 473 | 21 | 207 | 1.73 | 8 | 381 | 6 | tradable |
| QNT | 8 | 470 | 44 | 210 | 2.21 | 8 | 320 | 1 | tradable |
| SOL | 8 | 471 | 45 | 210 | 1.92 | 8 | 367 | 2 | tradable |
| SOXS | 8 | 473 | 21 | 211 | 3.88 | 8 | 437 | 0 | tradable |
| SUI | 8 | 470 | 59 | 207 | 2.03 | 8 | 297 | 2 | tradable |
| TAO | 8 | 470 | 59 | 208 | 1.16 | 8 | 297 | 0 | tradable |
| TRX | 8 | 407 | 11 | 208 | 0.61 | 8 | 149 | 1 | tradable |
| UNI | 8 | 356 | 60 | 208 | 2.83 | 8 | 319 | 0 | tradable |
| USELESS | 8 | 469 | 51 | 208 | 4.83 | 8 | 353 | 0 | tradable |
| VVV | 8 | 184 | 65 | 209 | 1.16 | 8 | 287 | 0 | tradable |
| WLD | 8 | 473 | 11 | 209 | 3.78 | 8 | 351 | 1 | tradable |
| XLM | 8 | 414 | 55 | 208 | 1.14 | 8 | 216 | 0 | tradable |
| XMR | 8 | 356 | 93 | 207 | 1.49 | 8 | 354 | 1 | tradable |
| XRP | 7 | 462 | 71 | 209 | 2.29 | 8 | 384 | 3 | tradable |
| ZEC | 8 | 473 | 135 | 208 | 0.73 | 8 | 468 | 5 | tradable |
| ZRO | 8 | 170 | 20 | 208 | 1.66 | 8 | 318 | 0 | tradable |

| Agent | Status | Why | Metrics |
|---|---|---|---|
| accountant | ok |  | {"equity":9984.32,"positions":1} |
| binance-feed | ok |  | {"opens":1,"msgs":72393,"flowMsgs":475,"liqOther":468,"lastMsgAgeMs":2,"coins":35,"sockets":"1/1","bars":280,"liqs":59,"oiErrors":1} |
| blofin-feed | ok |  | {"opens":6,"msgs":191795,"trades":2363,"coins":35,"sockets":"3/3","lastMsgAgeMs":50,"bars":279,"closes":3,"restBars":4} |
| brain | ok |  | {"coins":35,"seededBars":158919,"warmedCoins":35,"rssMb":207,"bars_binance":280,"ideas_probe":3} |
| coordinator | ok |  | {"inflight":0,"riskMode":"normal","budgetScale":1,"risk_approve":2,"orders":3,"lastCycleMs":2,"risk_trim":1} |
| events | ok |  | {"windows":0} |
| guard | ok |  | {"lagMedMs":464,"tradable":"35/35"} |
| guardian | ok |  | {"riskHash":"00fb82bc38ee8f7f","signed":"unsigned","account":"paper"} |
| herald | degraded | no Telegram token/chat id: messages are only logged | {"messages":1} |
| recorder | ok |  | {"lines":28500,"bytes":8464448} |
| state-sync | ok |  | {} |
| strategy:adaptive-score-12h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-doji-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-doji-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-doji-star-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-doji-star-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-engulfing-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-engulfing-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-hammer-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-hammer-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-harami-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-harami-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-marubozu-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-marubozu-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-morning-star-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-morning-star-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-piercing-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-piercing-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-soldiers-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-soldiers-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-star-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-star-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-three-inside-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-three-inside-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-three-methods-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-three-methods-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-three-outside-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-three-outside-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-tweezer-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:candle-tweezer-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:crowd-squeeze | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:dip-reversal | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:donchian-12h-60 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:donchian-1d-150 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:donchian-1d-20 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:donchian-1d-60 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:funding-fade-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:harmonic | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:intraday-trend | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:it-12h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:it-1d | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:it-45-hold16 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:it-45-hold32 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:it-45-long | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:it-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:krown-jewel-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:krown-jewel-2h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:leader-follow | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:ma-21-200 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:ma-pullback-12h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:ma-retest-12h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:ma-retest-1d | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:ma-retest-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:noise-breakout | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:oi-flush | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:overshoot-fade | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:pivot-matrix | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:pivot-matrix-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:pivot-matrix-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:probe | ok |  | {"mode":"trade","ideas":3,"rejected":0,"errors":0,"open":0,"pending":1,"shadowTrades":2,"shadowSumR":-0.65,"unfilled":0} |
| strategy:rsi-macd | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:rsi-macd-trend-12h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:session-drive | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:squeeze-ride | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:trend-pullback | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:trend-pullback-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:wyckoff-spring-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:wyckoff-spring-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| trader | ok |  | {"orders":3,"entries":3,"exit_time":2} |
| universe | ok |  | {"coins":35,"source":"binance archive (API unreachable)"} |
| watchdog | ok |  | {"diskFreePct":59.5,"memFreeMb":14916,"memTotalMb":15990,"rssMb":207,"down":"none"} |

Feature bars: 15m binance 35, 45m binance 35, 5m binance 70
Ideas: {"probe":3}; shadow trades: {"probe":"2 (sum R -0.65)"}; unfilled: {}
Event windows: none this week

Trade path (paper): 3 risk decisions (approve,approve,trim), 3 orders, 5 fills, 2 closed trades (time -0.27R, time -0.34R), 0 ended unfilled
Account: equity $9984.32, 2 trades, fees $11.99

BloFin data check: 35/35 coins produced bars and books (need 18).
Trade path check: 3 probe ideas → 5 fills; 0 unsigned messages dropped.
