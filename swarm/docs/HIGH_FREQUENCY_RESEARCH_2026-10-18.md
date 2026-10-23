# High-frequency research — can the bot take 100–200 trades a day? (2026-10-18)

**Short answer: not profitably, on BTC alone, with 1-minute data and BloFin's fees.** Every one of about 60,000 strategy configurations tested at 100–220 trades a day lost money in every period — including before fees.

## Setup

- Data: Binance BTCUSDT 1-minute candles with trade counts and taker-buy volume, 2024-04 → 2026-10 (1.34M candles).
- Windows (chronological): train 2025-10-18 → 2026-05-18, validation → 2026-08-18, test → 2026-10-18 (most recent two months), plus a different market era, 2024-04 → 2025-04.
- Fees (BloFin perpetuals): standard maker 0.02% / taker 0.06%; VIP 1 maker 0.006% / taker 0.05%. 1.5 bps slippage on every market or stop fill.
- Fill model: limit orders placed at a candle's close, working from the next candle; a buy fills only if price trades a tick below it; targets are resting limits (maker); on the fill candle only the stop can trigger; stop assumed first when stop and target share a candle. (Switching to optimistic "touch" fills changed results by under 0.05 bps — the losses are not an artefact of the fill model.)
- Families: mean reversion with limit entries, grid / market-making quotes around a fast average, order-flow momentum with market entries (taker-buy imbalance + breakout), order-flow fade with limit entries, trend-aligned pullback scalps. Each family: 4,000 random configurations + local refinement, selected on the training window only, scored by the t-statistic of net profit per trade.

## Results (best configuration per family, chosen on training data)

### 100–220 trades a day

| Family | Trades/day (test) | Gross edge, test | Net after fees, VIP1 | Net after fees, standard | 2024–25 net, VIP1 | Test-window result at 1× notional, VIP1 |
|---|---|---|---|---|---|---|
| Mean reversion (limit orders) | 85.7 | -1.32 bps | -4.46 bps | -7.08 bps | -4.99 bps | -233.2% in 61 days |
| Grid / market-making | 85.1 | -2.82 bps | -4.87 bps | -7.59 bps | -5.27 bps | -253.2% in 61 days |
| Order-flow momentum (market orders) | 94.7 | -0.85 bps | -8.29 bps | -10.52 bps | -8.78 bps | -479.7% in 61 days |
| Order-flow fade (limit orders) | 84.5 | -1.73 bps | -4.58 bps | -7.23 bps | -4.87 bps | -236.6% in 61 days |
| Trend pullback scalp (limit orders) | 85 | -1.21 bps | -5.04 bps | -7.60 bps | -5.26 bps | -261.6% in 61 days |

### 20–60 trades a day

| Family | Trades/day (test) | Gross edge, test | Net after fees, VIP1 | Net after fees, standard | 2024–25 net, VIP1 | Test-window result at 1× notional, VIP1 |
|---|---|---|---|---|---|---|
| Mean reversion (limit orders) | 20.6 | -1.26 bps | -3.94 bps | -6.61 bps | -5.29 bps | -49.5% in 61 days |
| Grid / market-making | 11.6 | -1.36 bps | -3.80 bps | -6.48 bps | -4.31 bps | -26.9% in 61 days |
| Order-flow momentum (market orders) | 18.1 | -1.56 bps | -10.60 bps | -12.69 bps | -8.91 bps | -117.3% in 61 days |
| Order-flow fade (limit orders) | 21.8 | -1.49 bps | -5.96 bps | -8.46 bps | -5.60 bps | -79.2% in 61 days |
| Trend pullback scalp (limit orders) | 18.6 | -1.75 bps | -4.57 bps | -7.22 bps | -4.27 bps | -52% in 61 days |

### 4–20 trades a day

| Family | Trades/day (test) | Gross edge, test | Net after fees, VIP1 | Net after fees, standard | 2024–25 net, VIP1 | Test-window result at 1× notional, VIP1 |
|---|---|---|---|---|---|---|
| Mean reversion (limit orders) | 4.2 | -1.76 bps | -5.90 bps | -8.43 bps | -4.92 bps | -15.3% in 61 days |
| Grid / market-making | 3.7 | -2.67 bps | -5.80 bps | -8.42 bps | -4.83 bps | -13% in 61 days |
| Order-flow momentum (market orders) | 4.7 | -1.97 bps | -11.44 bps | -13.48 bps | -10.89 bps | -33% in 61 days |
| Order-flow fade (limit orders) | 4.3 | -1.93 bps | -6.92 bps | -9.38 bps | -5.70 bps | -18.1% in 61 days |
| Trend pullback scalp (limit orders) | 4.2 | -1.44 bps | -5.34 bps | -7.90 bps | -4.88 bps | -13.6% in 61 days |

"Gross edge" is before fees. A bps (basis point) is 0.01% of the trade size. At 1× notional, −233% over 61 days means the account is gone several times over.

## Why

- **There is no raw edge at that frequency.** The best gross result of any configuration trading 100+ times a day was +0.7 bps before fees — less than one VIP-1 maker round trip (1.2 bps), far below a maker-in/taker-out round trip (~7 bps).
- **Adverse selection.** A resting limit order on a 1-minute chart gets filled mostly when price is moving through it, so fills start slightly on the wrong side.
- **Stops are market orders.** Even all-limit strategies pay the taker fee whenever a stop or time exit fires.

## What does work

The strategies that survive costs aim for moves of ~1–2% (100–200 bps), so fees are ~5–10% of the risk instead of several times it. On BTC alone that means a handful of trades a week (see `RESEARCH_2026-10-18.md`).

The legitimate way to raise trade count without giving up edge is **breadth**: the same tested 1h–4h logic running on many uncorrelated perpetuals (ETH, SOL, XRP, …) at once, with portfolio-level risk limits. True high-frequency market making needs tick/order-book data, sub-second execution and maker rebates — none of which can be validated with 1-minute candles.

## Reproduce

    node lab/research/hf_search.js <mr|grid|flow|flowfade|tpull> 4000 out.json   # MINDAY / MAXDAY env set the band
    lab/research/run_hf.sh 100 220 hf

(Scripts read a local binary of the 1m history; see `tools/fetch_binance_archive.py` for the data.)
