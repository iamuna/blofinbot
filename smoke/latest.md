# Swarm smoke run

Recorded 8.0 minutes (2026-10-20T16:26:39.314Z → 2026-10-20T16:34:39.505Z).

| Type | Messages |
|---|---|
| account | 98 |
| event.window | 1 |
| exec.fill | 5 |
| feat.bar | 144 |
| guard.status | 62 |
| idea | 3 |
| intent | 3 |
| md.bar | 288 |
| md.book | 13584 |
| md.funding | 231 |
| md.ticker | 7516 |
| md.trade | 2292 |
| order | 3 |
| ref.bar | 288 |
| ref.flow | 477 |
| ref.liq | 49 |
| ref.mark | 48 |
| regime.state | 1 |
| risk.decision | 3 |
| risk.state | 159 |
| shadow.trade | 2 |
| sys.alert | 32 |
| sys.heartbeat | 968 |
| trade.closed | 2 |

| Coin | BloFin bars | books | trades | tickers | median spread bps | Binance bars | flow secs | liqs | guard |
|---|---|---|---|---|---|---|---|---|---|
| AAVE | 8 | 391 | 114 | 207 | 1.97 | 8 | 375 | 1 | tradable |
| ARB | 8 | 392 | 24 | 208 | 1.60 | 8 | 446 | 0 | tradable |
| ASTER | 8 | 361 | 56 | 210 | 2.80 | 8 | 184 | 0 | tradable |
| AVAX | 8 | 392 | 70 | 208 | 2.08 | 8 | 376 | 1 | tradable |
| BAT | 8 | 250 | 7 | 209 | 2.85 | 8 | 441 | 4 | tradable |
| BCH | 8 | 259 | 74 | 209 | 0.72 | 8 | 307 | 0 | tradable |
| BNB | 8 | 395 | 54 | 208 | 0.27 | 8 | 373 | 1 | tradable |
| BTC | 8 | 346 | 301 | 208 | 0.02 | 8 | 461 | 8 | tradable |
| CRV | 8 | 472 | 45 | 210 | 5.27 | 8 | 238 | 0 | tradable |
| DASH | 8 | 472 | 56 | 209 | 4.01 | 8 | 230 | 0 | tradable |
| DOGE | 8 | 394 | 200 | 208 | 2.48 | 8 | 418 | 1 | tradable |
| DOT | 8 | 472 | 37 | 207 | 1.72 | 8 | 370 | 1 | tradable |
| ETH | 8 | 471 | 192 | 208 | 0.08 | 8 | 468 | 14 | tradable |
| HBAR | 8 | 281 | 52 | 210 | 2.39 | 8 | 295 | 0 | tradable |
| HYPE | 8 | 474 | 90 | 209 | 0.50 | 8 | 427 | 0 | tradable |
| ICP | 8 | 361 | 9 | 210 | 6.96 | 8 | 251 | 0 | tradable |
| LINK | 8 | 392 | 80 | 210 | 1.63 | 8 | 368 | 1 | tradable |
| LIT | 8 | 361 | 90 | 209 | 2.56 | 8 | 399 | 0 | tradable |
| LITE | 8 | 472 | 47 | 207 | 1.81 | 8 | 305 | 0 | tradable |
| NEAR | 8 | 475 | 91 | 209 | 4.12 | 8 | 457 | 4 | tradable |
| PENGU | 8 | 361 | 23 | 209 | 2.58 | 8 | 312 | 0 | tradable |
| PONS | 8 | 383 | 32 | 209 | 7.28 | 8 | 258 | 0 | tradable |
| Q | 8 | 385 | 24 | 207 | 0.81 | 8 | 433 | 1 | tradable |
| QNT | 8 | 392 | 55 | 210 | 1.03 | 8 | 334 | 0 | tradable |
| S | 8 | 339 | 3 | 211 | 3.54 | 8 | 296 | 0 | tradable |
| SOL | 8 | 469 | 173 | 209 | 1.89 | 8 | 455 | 2 | tradable |
| SUI | 8 | 263 | 107 | 210 | 2.96 | 8 | 425 | 0 | tradable |
| TAO | 8 | 339 | 82 | 207 | 2.23 | 8 | 421 | 1 | tradable |
| TIA | 8 | 339 | 25 | 208 | 4.76 | 8 | 392 | 0 | tradable |
| TRX | 8 | 361 | 11 | 210 | 0.30 | 8 | 265 | 0 | tradable |
| UNI | 8 | 343 | 57 | 209 | 2.75 | 8 | 383 | 0 | tradable |
| VVV | 8 | 361 | 72 | 209 | 1.19 | 8 | 376 | 0 | tradable |
| XLM | 8 | 361 | 77 | 209 | 1.11 | 8 | 348 | 0 | tradable |
| XMR | 8 | 392 | 78 | 209 | 0.96 | 8 | 353 | 0 | tradable |
| XRP | 8 | 350 | 94 | 208 | 1.51 | 8 | 424 | 4 | tradable |
| ZEC | 8 | 263 | 272 | 209 | 0.34 | 8 | 476 | 5 | tradable |

| Agent | Status | Why | Metrics |
|---|---|---|---|
| accountant | ok |  | {"equity":9987.57,"positions":1} |
| binance-feed | ok |  | {"opens":1,"msgs":111861,"flowMsgs":477,"lastMsgAgeMs":2,"coins":36,"sockets":"1/1","bars":288,"liqs":49,"liqOther":116,"oiErrors":1} |
| blofin-feed | ok |  | {"opens":6,"msgs":191606,"trades":2873,"coins":36,"sockets":"3/3","lastMsgAgeMs":4,"bars":288,"closes":3} |
| brain | ok |  | {"coins":36,"seededBars":65367,"warmedCoins":36,"bars_binance":288,"ideas_probe":3} |
| coordinator | ok |  | {"riskMode":"normal","budgetScale":1,"risk_approve":3,"orders":3,"lastCycleMs":2} |
| events | ok |  | {"windows":0} |
| guard | ok |  | {"lagMedMs":349,"tradable":"36/36"} |
| guardian | ok |  | {"riskHash":"00fb82bc38ee8f7f","signed":"unsigned","account":"paper"} |
| herald | degraded | no Telegram token/chat id: messages are only logged | {"messages":1} |
| recorder | ok |  | {"lines":26234,"bytes":7896171} |
| state-sync | ok |  | {} |
| strategy:it-4h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:ma-retest-12h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:ma-retest-1d | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:probe | ok |  | {"mode":"trade","ideas":3,"rejected":0,"errors":0,"open":0,"pending":1,"shadowTrades":2,"shadowSumR":-0.39,"unfilled":0} |
| strategy:rsi-macd-trend-12h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| strategy:trend-pullback-1h | ok |  | {"mode":"shadow","ideas":0,"rejected":0,"errors":0,"open":0,"pending":0,"shadowTrades":0,"shadowSumR":0,"unfilled":0} |
| trader | ok |  | {"orders":3,"entries":3,"exit_time":1,"exit_target":1} |
| universe | ok |  | {"coins":36,"source":"binance archive (API unreachable)"} |
| watchdog | ok |  | {"diskFreePct":58.9,"memFreeMb":14993,"down":"none"} |

Feature bars: 15m binance 36, 30m binance 36, 45m binance 36, 5m binance 36
Ideas: {"probe":3}; shadow trades: {"probe":"2 (sum R -0.39)"}; unfilled: {}
Event windows: none this week

Trade path (paper): 3 risk decisions (approve,approve,approve), 3 orders, 5 fills, 2 closed trades (time -0.24R, target -0.11R), 0 ended unfilled
Account: equity $9987.57, 2 trades, fees $10

BloFin data check: 36/36 coins produced bars and books (need 18).
Trade path check: 3 probe ideas → 5 fills; 0 unsigned messages dropped.
