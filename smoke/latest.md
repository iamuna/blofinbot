# Swarm smoke run

Recorded 8.0 minutes (2026-10-20T13:45:29.987Z → 2026-10-20T13:53:30.080Z).

| Type | Messages |
|---|---|
| account | 99 |
| event.window | 1 |
| exec.fill | 6 |
| feat.bar | 36 |
| guard.status | 64 |
| idea | 7 |
| intent | 3 |
| md.bar | 287 |
| md.book | 16033 |
| md.funding | 186 |
| md.ticker | 7434 |
| md.trade | 2596 |
| order | 3 |
| ref.bar | 288 |
| ref.flow | 467 |
| ref.liq | 94 |
| ref.mark | 47 |
| risk.decision | 3 |
| risk.state | 155 |
| shadow.trade | 2 |
| sys.alert | 31 |
| sys.heartbeat | 1420 |
| trade.closed | 3 |

| Coin | BloFin bars | books | trades | tickers | median spread bps | Binance bars | flow secs | liqs | guard |
|---|---|---|---|---|---|---|---|---|---|
| AAVE | 8 | 429 | 95 | 205 | 1.33 | 8 | 355 | 0 | tradable |
| ADA | 8 | 429 | 31 | 205 | 9.21 | 8 | 298 | 0 | tradable |
| ARB | 8 | 429 | 34 | 206 | 1.06 | 8 | 416 | 1 | tradable |
| ASTER | 8 | 461 | 40 | 208 | 2.84 | 8 | 160 | 0 | tradable |
| BCH | 8 | 461 | 77 | 205 | 0.73 | 8 | 296 | 0 | tradable |
| BNB | 8 | 463 | 77 | 207 | 0.27 | 8 | 389 | 0 | tradable |
| BTC | 8 | 462 | 829 | 208 | 0.02 | 8 | 466 | 21 | tradable |
| CRV | 8 | 462 | 43 | 208 | 8.08 | 8 | 261 | 0 | tradable |
| DASH | 8 | 462 | 59 | 207 | 4.05 | 8 | 254 | 3 | tradable |
| DOGE | 8 | 463 | 63 | 207 | 2.51 | 8 | 375 | 3 | tradable |
| DOT | 8 | 429 | 46 | 208 | 1.75 | 8 | 368 | 0 | tradable |
| ENA | 8 | 429 | 68 | 205 | 2.10 | 8 | 453 | 1 | tradable |
| ETH | 8 | 463 | 489 | 208 | 0.13 | 8 | 467 | 11 | tradable |
| HBAR | 8 | 430 | 68 | 207 | 3.64 | 8 | 279 | 0 | tradable |
| HYPE | 8 | 463 | 323 | 206 | 1.39 | 8 | 437 | 1 | tradable |
| INJ | 8 | 429 | 72 | 204 | 4.63 | 8 | 411 | 2 | tradable |
| LINK | 8 | 429 | 76 | 205 | 1.66 | 8 | 344 | 0 | tradable |
| LTC | 8 | 429 | 75 | 208 | 3.39 | 8 | 248 | 1 | tradable |
| NEAR | 8 | 463 | 100 | 207 | 4.24 | 8 | 463 | 3 | tradable |
| NIL | 8 | 461 | 8 | 206 | 3.43 | 8 | 276 | 1 | tradable |
| PENGU | 8 | 430 | 20 | 206 | 2.64 | 8 | 317 | 0 | tradable |
| PUMP | 8 | 342 | 80 | 205 | 4.50 | 8 | 390 | 0 | tradable |
| Q | 8 | 462 | 149 | 206 | 0.71 | 8 | 451 | 1 | tradable |
| QNT | 8 | 342 | 51 | 205 | 1.56 | 8 | 337 | 0 | tradable |
| SAND | 8 | 461 | 8 | 204 | 3.49 | 8 | 296 | 0 | tradable |
| SOL | 8 | 463 | 103 | 209 | 1.91 | 8 | 446 | 2 | tradable |
| SUI | 8 | 463 | 101 | 206 | 2.99 | 8 | 433 | 2 | tradable |
| TAO | 8 | 461 | 68 | 207 | 1.88 | 8 | 441 | 1 | tradable |
| TRX | 8 | 462 | 23 | 208 | 0.30 | 8 | 345 | 1 | tradable |
| UNI | 8 | 461 | 88 | 206 | 4.15 | 8 | 415 | 3 | tradable |
| WLD | 8 | 462 | 51 | 207 | 3.61 | 8 | 460 | 4 | tradable |
| XLM | 8 | 461 | 67 | 208 | 1.13 | 8 | 286 | 0 | tradable |
| XMR | 8 | 461 | 84 | 206 | 1.47 | 8 | 322 | 0 | tradable |
| XRP | 8 | 463 | 128 | 209 | 1.54 | 8 | 395 | 5 | tradable |
| ZEC | 8 | 463 | 299 | 206 | 0.43 | 8 | 466 | 24 | tradable |
| ZRO | 7 | 430 | 39 | 206 | 5.42 | 8 | 456 | 3 | tradable |

| Agent | Status | Why | Metrics |
|---|---|---|---|
| accountant | ok |  | {"equity":9997.1,"positions":1} |
| binance-feed | ok |  | {"opens":1,"msgs":141458,"flowMsgs":458,"liqOther":235,"liqs":93,"lastMsgAgeMs":1,"coins":36,"sockets":"1/1","bars":288,"oiErrors":1} |
| blofin-feed | ok |  | {"opens":6,"msgs":218203,"trades":3980,"coins":36,"sockets":"3/3","lastMsgAgeMs":8,"bars":287,"closes":3,"restBars":4} |
| brain | ok |  | {"coins":36,"warmedCoins":36,"bars_binance":288,"ideas_probe":3,"ideas_trend-pullback":4} |
| coordinator | ok |  | {"riskMode":"normal","budgetScale":1,"risk_approve":3,"orders":3,"lastCycleMs":2,"ideasShadow":4} |
| events | ok |  | {"windows":0} |
| guard | ok |  | {"lagMedMs":388,"tradable":"36/36"} |
| guardian | ok |  | {"riskHash":"00fb82bc38ee8f7f","signed":"unsigned","account":"paper"} |
| herald | degraded | no Telegram token/chat id: messages are only logged | {"messages":1} |
| recorder | ok |  | {"lines":28789,"bytes":8676237} |
| state-sync | ok |  | {} |
| strategy:crowd-squeeze | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:dip-reversal | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:harmonic | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:intraday-trend | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:it-45-hold16 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:it-45-hold32 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:it-45-long | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:leader-follow | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:ma-21-200 | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:noise-breakout | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:overshoot-fade | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:probe | ok |  | {"mode":"trade","ideas":3,"rejected":0,"errors":0,"open":1,"pending":0,"shadowTrades":2,"shadowSumR":-0.18,"unfilled":0} |
| strategy:rsi-macd | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:session-drive | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:squeeze-ride | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:trend-pullback | ok |  | {"mode":"shadow","ideas":4,"rejected":0,"errors":0,"open":1,"pending":3,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| trader | ok |  | {"orders":3,"entries":3,"exit_target":2} |
| universe | ok |  | {"coins":36,"source":"binance archive (API unreachable)"} |
| watchdog | ok |  | {"diskFreePct":59.5,"memFreeMb":14942,"down":"none"} |

Feature bars: 5m binance 36
Ideas: {"probe":3,"trend-pullback":4}; shadow trades: {"probe":"2 (sum R -0.18)"}; unfilled: {}
Event windows: none this week

Trade path (paper): 3 risk decisions (approve,approve,approve), 3 orders, 6 fills, 3 closed trades (target -0.06R, target -0.08R, target -0.09R), 0 ended unfilled
Account: equity $9995.28, 3 trades, fees $12

BloFin data check: 36/36 coins produced bars and books (need 18).
Trade path check: 3 probe ideas → 6 fills; 0 unsigned messages dropped.
