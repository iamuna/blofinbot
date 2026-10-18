# HANDOFF — BTC 1-Minute BloFin Bot

**Prepared:** 2026-09-20  
**Handoff branch:** `handoff-ready`  
**Technical base:** `data-gap-fill` / draft PR #1  
**Target:** BTC-USDT perpetual execution on BloFin, with a continuously updated 1-minute research database and a controlled strategy-learning loop.

## 1. Read this first

This repository is **not yet a proven profitable live-trading bot**. It is a working historical-data, TA-map, risk-governor and strategy-research foundation.

The correct next step is **paper execution and measurement**, not live deployment.

Do not weaken the independent risk governor in order to make a backtest look better. Do not let the learner directly edit live code, risk caps, API permissions, or wallet/exchange controls.

## 2. Current implemented state

The current development base contains:

- resumable import of the supplied Binance BTCUSDT 1-minute ZIP into SQLite;
- Binance gap-repair and latest-closed-candle synchronization;
- explicit continuity checking with no invented/synthetic candles;
- 1m features: EMA20/50/200, RSI14, ATR14, MACD, Bollinger width, ROC, relative volume, trend/momentum/structure scores and regime;
- candlestick patterns and price-action swing/structure state;
- heuristic harmonic and Elliott **candidate** recognition;
- 3m/5m/15m/30m/1h/4h/1d materialized context;
- forward-return + MFE/MAE labels;
- versioned strategy DNA and champion/challenger experiments;
- validation/test promotion gates;
- trade-experience / mistake / knowledge tables;
- independent dynamic risk governor with drawdown, heat, loss-streak and position-count controls;
- ATR/structure initial stop and break-even / ATR-swing trailing logic;
- CLI and offline tests.

Important files:

- `btc_bot/db.py` — schema / persistence.
- `btc_bot/ingest.py`, `btc_bot/binance.py` — historical/live Binance tape.
- `btc_bot/features.py`, `btc_bot/patterns.py`, `btc_bot/mtf.py` — market map.
- `btc_bot/outcomes.py` — forward labels.
- `btc_bot/learning.py`, `btc_bot/engine.py`, `btc_bot/knowledge.py` — controlled learning.
- `btc_bot/risk.py` — hard risk layer.
- `btc_bot/cli.py` — operator commands.
- `tests/test_engine.py` — current offline coverage.

## 3. Real dataset findings

The supplied ZIP was successfully imported as **4,278,671 1-minute candles** covering:

- first candle: **2017-08-17 04:00 UTC**
- ZIP terminal candle: **2025-10-11 11:02 UTC**

The source ZIP contains **35 historical discontinuities**. They must stay explicit unless the exchange returns real candles for those intervals.

The ZIP's terminal `2025-10-11 11:02` candle was captured before the minute finalized. Binance's finalized candle preserves the price structure but has larger cumulative volume/trade fields. The synchronization logic therefore permits the final source candle to be replaced only when the fetched candle is a valid cumulative extension; older overlap mismatches abort.

A real recent-window derivation produced:

- 150,001 TA snapshots;
- 112,553 pattern events;
- 149,761 outcome labels.

The first baseline/challenger strategy experiment was unprofitable after modeled trading costs, so **nothing was promoted**. Preserve this behavior. The learning system must be willing to conclude that it has no tradeable strategy.

## 4. Critical data caveat

Long-history training data is **Binance spot BTCUSDT**. The target product is **BloFin BTC-USDT perpetual**.

Use the spot history for broad market structure, regime and pattern research, but do not assume a 1-minute spot edge transfers directly to the perpetual venue.

Before promotion to demo/live, collect and compare BloFin perpetual data for:

- last / mark / index price;
- bid/ask spread;
- spot-perp basis;
- funding;
- available depth;
- realized entry slippage;
- order acknowledgement/fill latency;
- TP/SL trigger behavior;
- rejected / partially resolved orders.

Backtests used for execution decisions should eventually use the same venue/product or explicitly model the differences.

## 5. What to carry forward from `iamuna/bot`

The old 30-timeframe bot contains several good operational patterns even though its strategy/risk defaults should not be copied.

**Keep/adapt:**

1. **BloFin API adapter**
   - HMAC signing;
   - compact JSON body;
   - UUID nonce + timestamp;
   - GET retry/backoff for 418/429/5xx;
   - instrument/ticker/candles/account/positions/order-detail/leverage/order/close endpoints;
   - tick/lot quantization from instrument metadata.

2. **Multi-position lifecycle**
   - Hedge Mode + Multi-Position must be confirmed before independent positions;
   - opening a new independent position omits `positionId`;
   - closing an independent position uses its `positionId`;
   - reserve risk for accepted-but-not-yet-reconciled orders;
   - reconcile `positionId` from Order Detail and/or fresh position snapshots;
   - never lose track of an accepted order just because the initial response lacks a final `positionId`.

3. **Execution rejection layer**
   - spread ceiling;
   - stale-entry / ATR displacement check;
   - exchange position limit;
   - portfolio risk reservation before order placement;
   - minimum/lot/tick validation;
   - duplicate closed-candle signal prevention;
   - circuit breaker on operational uncertainty.

4. **Observability**
   - separate trade log and structured event log;
   - log rejections, not only trades;
   - performance reports include P&L, PF, win/loss, per-strategy/timeframe results and rejection reasons;
   - expose unresolved-order count and planned open risk.

5. **UI/operator design**
   - local-only dashboard is a good default;
   - PAPER / DEMO / LIVE must be visually distinct;
   - live requires explicit local environment unlock plus an interactive confirmation;
   - one clear emergency stop/close path;
   - show current risk, strategy version and why a trade was accepted/rejected.

6. **Testing philosophy**
   - signing route tests;
   - quantization tests;
   - paper-position tests;
   - constructed-candle closure tests;
   - reporting math;
   - position-mode behavior;
   - synthetic directional market tests.

See `docs/BLOFIN_EXECUTION_SPEC.md` and `docs/LESSONS_FROM_BOT_AND_RESEARCH.md`.

## 6. What NOT to carry forward unchanged

Do **not** copy these old-bot defaults into the 1-minute learner:

- 1.45% risk per new position;
- 7x leverage as a strategy default;
- 45% max margin allocation;
- 11.5% total planned portfolio risk;
- permissive quality/confluence thresholds;
- unlimited trade frequency;
- the assumption that every timeframe may independently fire a position;
- raw correlated-timeframe voting as evidence of independent confirmation.

Those values were configuration choices, not validated edge.

Also do not treat Elliott counts or harmonic matches as ground truth. Store alternative interpretations, invalidation levels and confidence. They should be features/context, not unquestionable labels.

## 7. Next build sequence

### P0 — Data correctness

1. Run `sync` in a networked environment and fill 2025-10-11 → present.
2. Run `repair-gaps`; preserve unresolved exchange outages as gaps.
3. Rebuild recent features/outcomes incrementally.
4. Add BloFin-perpetual 1m capture alongside Binance spot.
5. Add automated continuity and stale-data alarms.

### P1 — Paper execution

1. Port a **minimal** BloFin client from `iamuna/bot`.
2. Define a broker interface so paper/demo/live share the same state machine.
3. Connect only a frozen champion strategy to paper trading.
4. Put `RiskGovernor` between strategy intent and broker order creation.
5. Implement signal idempotency key: strategy-version + closed-candle timestamp + side.
6. Persist order intent before submission and broker response after submission.
7. Reconcile unresolved orders until terminal state.
8. Feed closed trades into `trade_experiences`.

### P2 — Measurement

Track actual:

- spread at signal and submit;
- signal-to-submit latency;
- submit-to-ack latency;
- fill/mark difference;
- MFE/MAE;
- fees/funding;
- stop/TP execution difference;
- reject reason;
- expected R vs realized R.

### P3 — Dashboard

Keep the first UI simple:

- mode: PAPER / DEMO / LIVE;
- history freshness;
- BTC market/regime;
- champion strategy version;
- current signal + reasons;
- open position(s);
- equity / day P&L / drawdown;
- risk used / available;
- current stop / target / trailing state;
- learning status: champion, challengers, last cycle;
- latest rejection/error events;
- emergency stop.

### P4 — Demo qualification

Require a predefined paper/demo evidence window before live consideration. Do not promote because of one profitable day or one favorable regime.

## 8. Non-negotiable invariants

- Only **closed candles** may create durable signals.
- Historical/feature code must not use future information.
- Risk limits are not strategy parameters.
- No martingale or automatic loss-recovery sizing.
- No averaging down unless explicitly designed, tested and separately approved.
- No live self-modifying strategy code.
- Strategy promotion requires chronological out-of-sample evidence.
- Accepted-but-unresolved exchange orders reserve risk.
- New live orders stop when market data is stale or exchange state is uncertain.
- Live credentials must never be committed.
- Use API keys with trading permissions only; no transfer/withdrawal permissions.
- Main must not receive unstable execution work.

## 9. Definition of a handoff-complete next milestone

The next milestone is complete when:

1. historical data is current;
2. BloFin 1m capture runs continuously;
3. paper broker and BloFin demo broker implement the same order lifecycle;
4. every order is idempotent and recoverable after process restart;
5. risk reservations survive unresolved order states;
6. a frozen champion can paper trade for a meaningful sample;
7. all entries/exits/rejections are persisted;
8. backtest assumptions can be compared with measured execution costs;
9. dashboard makes state/risk obvious;
10. tests cover order reconciliation, restart recovery and risk gates.

Do not call the bot profitable until this evidence exists.
