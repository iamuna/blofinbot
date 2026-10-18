# Validation Plan and Next Steps

## Priority order

### Phase 1 — make history current

Run in a networked environment:

```bash
python -m btc_bot.cli --db data/btc_history.sqlite bootstrap <historical.zip>
python -m btc_bot.cli --db data/btc_history.sqlite repair-gaps
python -m btc_bot.cli --db data/btc_history.sqlite sync
python -m btc_bot.cli --db data/btc_history.sqlite verify
```

Then rebuild only what is necessary.

Acceptance:

- latest closed minute present;
- no unexplained recent gaps;
- old exchange outages documented;
- timestamps strictly increasing;
- duplicates impossible by primary key;
- terminal overlap verified.

### Phase 2 — venue-specific recorder

Add a BloFin-perpetual recorder.

Persist at minimum:

- 1m OHLCV;
- mark/index when available;
- bid/ask snapshots around signal time;
- funding;
- instrument metadata changes.

Create a comparison job against Binance spot:

- return correlation;
- basis distribution;
- candle high/low differences;
- spread distribution;
- volatility differences.

### Phase 3 — deterministic signal service

The signal service consumes a closed 1m candle plus higher-timeframe state and returns an immutable proposal:

- strategy_version;
- signal_time;
- side;
- entry reference;
- structural stop;
- target policy;
- confidence/evidence;
- feature snapshot;
- reason codes.

It does not place orders.

### Phase 4 — paper broker

Implement the exact intended order state machine in paper mode.

Required tests:

- duplicate signal cannot duplicate order;
- risk is reserved before acceptance;
- unresolved order blocks over-allocation;
- stop only tightens;
- day loss breaker;
- account drawdown breaker;
- loss-streak reduction/stop;
- max position count;
- restart reconstructs state.

### Phase 5 — cost-aware backtesting

At minimum model:

- maker/taker fee assumption appropriate to order type;
- bid/ask spread;
- slippage;
- latency;
- funding where relevant;
- stop/target collision ordering conservatively.

Never use future candle high/low to optimize an entry that was not knowable at signal time.

Use chronological splits only.

### Phase 6 — champion qualification

A candidate strategy should be judged on:

- trade count;
- net expectancy after cost;
- profit factor;
- max drawdown;
- stability across chronological folds;
- performance by regime;
- long/short symmetry/asymmetry;
- sensitivity to parameters;
- degradation under worse cost assumptions.

Reject strategies that only work in a narrow period or require extremely precise parameters.

### Phase 7 — demo

Demo must use the same broker abstraction and state machine.

Measure differences between paper assumptions and demo execution.

No automatic promotion from demo to live.

### Phase 8 — live consideration

Before any live approval, require explicit acceptance criteria defined in advance.

At a minimum verify:

- no unreconciled order-state bugs;
- no duplicate order incidents;
- risk caps tested;
- emergency stop tested;
- data-staleness stop tested;
- strategy has sufficient out-of-sample and forward sample;
- observed trading costs fit the model.

## Test matrix

### Data

- ZIP header/no-header handling;
- resume interrupted import;
- duplicate upsert;
- provisional terminal finalization;
- overlap mismatch abort;
- gap detection/repair;
- stale latest candle.

### TA

- indicator warm-up;
- no future leakage;
- closed candles only;
- MTF bucketing boundary tests;
- DST irrelevant because all storage is UTC;
- Elliott/harmonic candidate invalidation;
- pattern context stored.

### Learning

- challenger cannot change hard risk;
- train/validation/test chronological;
- insufficient samples rejected;
- negative expectancy rejected;
- failed version retained;
- knowledge confidence requires accumulated evidence;
- one trade cannot rewrite champion.

### Broker

- signing;
- lot/tick quantization;
- HTTP retry only when safe;
- submission timeout -> reconciliation, not blind retry;
- orderId/clientOrderId/positionId mapping;
- 10-position exchange cap handled;
- close requires correct position ID;
- accepted-but-unresolved reserves risk;
- restart recovery.

### UI

- PAPER/DEMO/LIVE unmistakable;
- live cannot arm accidentally;
- current data timestamp visible;
- risk and drawdown visible;
- unresolved order warning prominent;
- emergency stop accessible;
- errors never silently swallowed.

## Research backlog

High-value research questions:

1. Does 1m edge survive realistic cost on BloFin perpetual?
2. Which feature families add incremental value rather than duplicate information?
3. Is higher-timeframe alignment useful, or does it enter too late?
4. Which regimes should be a hard “no-trade” state?
5. Do candlestick/harmonic/Elliott features add value after controlling for trend/volatility/location?
6. Does trailing improve expected R or only win rate?
7. Which stop design minimizes adverse tail loss without over-tightening?
8. How much edge disappears when slippage assumptions are doubled?
9. Is strategy performance stable across BTC eras?
10. How different are Binance spot and BloFin perpetual microstructure around 1m setups?

The bot should earn the right to trade by answering these with data.
