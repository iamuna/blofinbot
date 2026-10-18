# Consolidated Lessons — Research + `iamuna/bot`

## Purpose

This document records the useful conclusions from:

- reverse-engineering `iamuna/bot`;
- analysis of the supplied BTC 1-minute history;
- building the current historical/learning core;
- the first strategy-learning experiment;
- current BloFin Open API documentation checked on 2026-09-20.

It is intentionally a design record, not a trading-performance claim.

## Market-analysis lessons

### 1. A 1-minute bot still needs higher-timeframe context

The 1m candle is the execution clock, not the full market model.

Useful higher-timeframe information includes:

- trend vs range;
- volatility expansion/compression;
- important swing structure;
- proximity to major support/resistance;
- whether the 1m setup aligns with or fights larger context.

The current repo materializes 3m/5m/15m/30m/1h/4h/1d. These should be treated as context features, not 7 independent votes.

### 2. Correlated indicators should not become fake confidence

EMA, MACD, RSI, ROC and price slope often describe overlapping information. Likewise, nearby timeframes are highly correlated.

Do not treat five correlated bullish measurements as five independent confirmations.

Prefer feature families:

- trend;
- momentum;
- structure;
- volatility;
- flow/liquidity;
- pattern/context.

Then measure whether a family adds out-of-sample value beyond the others.

### 3. Elliott and harmonics are hypotheses

Algorithmic Elliott counts and harmonic patterns are ambiguous by nature. The correct representation is:

- candidate interpretation;
- direction;
- confidence/fit;
- relevant ratios;
- invalidation;
- alternative count/pattern where applicable;
- subsequent outcome.

Never let one heuristic count become an unquestionable label.

### 4. Candlesticks are contextual

A hammer, shooting star, engulfing candle or inside bar has little value without context. Store:

- trend/regime;
- volatility;
- location relative to swing levels;
- volume;
- follow-through;
- forward returns/MFE/MAE.

The database should learn when a pattern matters, not assume a textbook pattern is predictive everywhere.

### 5. Historical analogues are research evidence, not automatic orders

Similarity search can answer: “When BTC looked like this before, what happened next?”

It should not answer: “Therefore buy.”

Use analogues as one feature/evidence source inside a validated strategy.

## Data-engineering lessons

### 6. Never silently manufacture missing market data

The source ZIP has real discontinuities. Missing candles must be:

- filled only from an authoritative exchange source; or
- retained as explicit gaps.

Feature builders/backtests must know when continuity is broken.

### 7. Terminal candles can be provisional

The ZIP's final 2025-10-11 11:02 candle was not fully finalized. Historical ingestion therefore needs overlap validation and a narrow rule for replacing only a legitimate cumulative terminal extension.

### 8. Store raw market truth separately from derived knowledge

Recommended separation:

- raw 1m OHLCV;
- resampled candles;
- features;
- pattern events;
- outcome labels;
- strategy versions;
- strategy trials;
- actual trade experiences;
- knowledge/lessons.

Derived logic can then be rebuilt without corrupting raw history.

### 9. Incremental/resumable processing is mandatory

Millions of 1m candles make full rebuilds expensive. Import, feature generation, outcome generation and synchronization must checkpoint/resume.

## Strategy-learning lessons

### 10. Learning is controlled model selection, not emotional reaction to losses

A loss should create a data point and possibly a tagged lesson. It must not cause the live bot to immediately mutate itself.

Correct loop:

1. record state + decision + execution + outcome;
2. aggregate evidence;
3. generate bounded challengers offline;
4. chronological walk-forward evaluation;
5. separate validation;
6. untouched test;
7. promotion only if predefined gates pass;
8. paper/demo canary before live.

### 11. Failure is valuable output

The first real baseline/challenger pass was unprofitable. The correct action was to promote nothing.

Keep failed strategy versions and failure tags. Repeated failure patterns are useful knowledge.

### 12. Fees and microstructure dominate 1m systems

A 1m signal can appear profitable before costs and fail after:

- fees;
- spread;
- slippage;
- latency;
- funding;
- stop-trigger differences.

Backtests that ignore these are not decision-grade.

## Risk lessons

### 13. Risk is a hard subsystem

The strategy requests a trade. The risk governor decides whether the request is allowed and how large it may be.

The strategy must not be able to raise:

- max risk/trade;
- daily-loss limit;
- portfolio heat;
- drawdown limit;
- position cap;
- live permission.

### 14. Avoid martingale behavior

After losses, risk should reduce or stop—not automatically increase to recover losses.

The current governor includes loss-streak reduction and circuit breaking.

### 15. Planned risk must include unresolved orders

An exchange-accepted order can be economically real before local position tracking is complete. Reserve its intended risk until reconciliation proves the order failed/canceled or maps it to a position.

## Lessons from `iamuna/bot`

### Useful mechanics

The old bot demonstrated solid mechanics for:

- BloFin request signing and private REST calls;
- instrument-driven tick/lot quantization;
- paper/demo/live separation;
- explicit live unlock;
- Hedge + Multi-Position setup;
- `positionId` reconciliation;
- spread and stale-entry rejection;
- duplicate signal suppression;
- portfolio risk reservation;
- structured event/trade logs;
- periodic performance reporting;
- easy local dashboard;
- offline tests for order/signing/position/reporting behavior.

These should be ported selectively.

### Weaknesses not to reproduce

The old bot used a hardcoded aggressive profile:

- risk/trade 1.45%;
- 7x leverage;
- 45% max margin allocation;
- 11.5% portfolio planned risk;
- low setup/confluence thresholds;
- no daily trade count/cooldown.

Those are not research conclusions.

The old architecture also allowed many independently firing timeframes. That can multiply exposure to what is effectively one BTC market view. The new system should model **portfolio correlation and shared thesis risk**, not just count positions.

The old system had logs/reports but no persistent learning database, strategy lineage, outcome labels or evidence-based knowledge store. The new repo fixes that.

## Venue lesson: Binance spot vs BloFin perpetual

This is one of the most important open issues.

The historical dataset is Binance spot. Execution target is BloFin perpetual.

Measure the transfer gap explicitly. A 1m strategy should ultimately be tested with BloFin-perpetual-specific:

- candles;
- bid/ask;
- mark/index;
- funding;
- fills;
- rejects;
- latency.

Use Binance history as valuable long-range context, not proof of BloFin execution expectancy.

## Official BloFin facts verified 2026-09-20

BloFin documents that Multi-Position mode:

- requires Hedge Mode (`long_short_mode`);
- creates independent positions with separate `positionId`;
- supports cross or isolated margin;
- allows up to 10 positions per instrument;
- requires `positionId` for closing a specific position;
- may return an empty `positionId` for a new opening order until the position is established;
- cannot be switched while positions/orders are open.

Sources:

- https://docs.blofin.com/index.html
- https://docs.blofin.com/changelog.html

Re-check the documentation before implementing or changing exchange behavior.
