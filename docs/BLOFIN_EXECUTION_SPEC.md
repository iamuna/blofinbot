# BloFin Execution Spec for the 1-Minute Bot

## Goal

Port the useful exchange mechanics from `iamuna/bot` without importing its strategy/risk defaults.

The exchange layer must be deterministic, restart-safe, idempotent and observable.

## Interfaces

Define a broker abstraction shared by PAPER, DEMO and LIVE.

Suggested operations:

- `get_instrument()`
- `get_ticker()`
- `get_positions()`
- `get_balance()`
- `get_position_mode()`
- `ensure_required_position_mode()`
- `set_leverage()`
- `submit_entry(intent)`
- `get_order(order_id/client_order_id)`
- `close_position(position_id)`
- `place/update protection`
- `cancel_order/algo` when supported/needed

The strategy layer must never call BloFin directly.

## Order intent state machine

Persist **before** network submission:

`SIGNAL_APPROVED -> INTENT_PERSISTED -> SUBMITTING -> ACCEPTED_UNRESOLVED -> POSITION_RESOLVED -> OPEN -> CLOSING -> CLOSED`

Failure/alternate states:

- `REJECTED_LOCAL`
- `REJECTED_EXCHANGE`
- `SUBMIT_UNKNOWN`
- `CANCELED`
- `RECONCILIATION_REQUIRED`

The important case is `SUBMIT_UNKNOWN`: a network timeout after sending an order does **not** prove that no order exists. Reconcile by client order ID/order history before retrying.

## Idempotency

Use a stable deterministic intent key such as:

`strategy_version | instrument | signal_closed_time | side | setup_id`

Generate a unique `clientOrderId` from/persisted alongside that intent.

Never resubmit an intent merely because the UI refreshed or the process restarted.

## Multi-Position handling

Current BloFin docs say Multi-Position is available only under Hedge Mode.

For a fresh independent opening position:

- set/confirm `long_short_mode` + `multiPosition=true`;
- omit `positionId` on the opening order;
- capture returned order ID/client order ID;
- reconcile the resulting `positionId`;
- persist the relationship.

For close:

- specify the target `positionId`;
- do not assume a “close all” behavior in Multi-Position mode.

Do not change position mode while orders/positions are open.

Current documented cap: **10 positions per instrument**. Treat this as an exchange cap, not a target.

## Signing pattern worth porting

The old bot signs the string:

`path_with_query + HTTP_METHOD + timestamp + nonce + compact_json_body`

with HMAC-SHA256 using the API secret, hex-encodes the HMAC, then Base64-encodes that hex representation.

Reuse only after verifying against current BloFin docs/tests.

Private credentials remain local. Never log secrets or signed headers.

## Instrument precision

Never hardcode BTC contract sizing.

Read:

- `contractValue`
- `minSize`
- `lotSize`
- `maxMarketSize`
- `tickSize`

Quantize size down to valid lot increments. Quantize protection prices to tick size.

Reject locally if final size falls below exchange minimum.

## Risk reservation

Before broker submission:

1. risk governor produces approved risk/size;
2. atomically reserve planned risk;
3. persist order intent;
4. submit.

Release/convert reservation only after a definitive state:

- exchange rejection/cancel -> release;
- resolved open position -> convert to open-position risk;
- unknown -> keep reservation until reconciled.

This prevents multiple fast signals from oversubscribing equity while orders are in flight.

## Execution filters

Required local rejection checks:

- market data freshness;
- spread;
- signal-to-current-price displacement measured in ATR / R;
- instrument min/lot/tick;
- strategy version still active;
- signal idempotency;
- day/account drawdown;
- portfolio heat;
- position count;
- unresolved-order uncertainty;
- exchange connectivity/account-state uncertainty.

A rejected entry is an event that should be stored and analyzed.

## Protection / trailing

Initial stop is defined before entry.

The current risk core supports:

- structural/ATR stop bounds;
- break-even after configurable R progress;
- ATR/swing trailing after configurable R progress.

For exchange execution, define clearly which price drives protection:

- mark;
- last;
- index.

The backtester must model the same trigger convention used live.

Do not continuously loosen a stop. Long stops may only ratchet upward; short stops may only ratchet downward.

## Fees/slippage/funding

Persist expected and realized costs separately:

- fee paid;
- spread at entry/exit;
- expected price;
- actual fill;
- mark/last at submit;
- funding attributable to holding period;
- execution latency.

The learner should use realized net outcomes.

## Live gates

Keep three layers:

1. local configuration says LIVE;
2. explicit durable live-risk unlock is present;
3. operator confirms LIVE interactively for the session.

Recommended additional gate: live disabled unless a specific strategy version is marked `live_approved`.

## Restart recovery

On startup:

1. load nonterminal order intents;
2. fetch open positions/orders;
3. reconcile by order/client-order/position ID;
4. rebuild risk reservations;
5. disable new entries if state cannot be reconciled;
6. only then arm the strategy loop.

A restart must not duplicate an existing trade.

## API facts checked 2026-09-20

See current documentation before implementation:

- https://docs.blofin.com/index.html
- https://docs.blofin.com/changelog.html

BloFin documents Multi-Position as Hedge-mode-only, with independent `positionId`, up to 10 positions/instrument, and `positionId` required for position-specific close operations.
