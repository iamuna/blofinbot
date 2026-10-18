# blofinbot

BTC-USDT 1-minute research and paper-trading system aimed at BloFin perpetuals.

| Part | Where | What it does |
|---|---|---|
| History + learning core (Python) | `btc_bot/`, `tools/`, `tests/` | SQLite 1m history, TA/pattern map, multi-timeframe context, outcome labels, strategy versions, `RiskGovernor`. See `HANDOFF.md`. |
| Strategy engine (JavaScript) | `lab/engine.js` | Indicators (SMA/EMA, RSI, MACD, Bollinger, ATR), support/resistance, Fibonacci, Carney harmonics, Elliott impulse entries, Wyckoff springs/upthrusts, Dalio-style regime filter and risk-parity sizing, bar-by-bar simulator with the same risk limits as `btc_bot/risk.py`, and a genetic optimizer with a chronological train / validation / test gate. Runs in Node and in the browser. |
| History gap fill | `tools/fetch_binance_archive.py`, `.github/workflows/fill-history-gap.yml` | Rebuilds Binance BTCUSDT 1m candles from 2025-10-11 (end of the source ZIP) to now from Binance's public archive and publishes them on the `history-data` branch, daily. |

Read `AGENTS.md` and `HANDOFF.md` before changing execution code. PAPER is the default; nothing here places real orders.

## Python core commands

    python -m btc_bot.cli --db data/btc_history.sqlite bootstrap BTCUSD_1m_Binance.zip
    python -m btc_bot.cli --db data/btc_history.sqlite repair-gaps
    python -m btc_bot.cli --db data/btc_history.sqlite sync
    python -m btc_bot.cli --db data/btc_history.sqlite verify
    python -m btc_bot.cli --db data/btc_history.sqlite features --rebuild
    python -m btc_bot.cli --db data/btc_history.sqlite mtf
    python -m btc_bot.cli --db data/btc_history.sqlite outcomes --rebuild
    python -m btc_bot.cli --db data/btc_history.sqlite learn --challengers 24
    python -m btc_bot.cli --db data/btc_history.sqlite status

## History gap

The source ZIP (4,278,671 candles, 2017-08-17 → 2025-10-11 11:02 UTC) is not in the repo. The `history-data` branch holds the continuation in the same format as `tools/build_btc_gap.py`, starting with a three-candle overlap so `tools/merge_btc_gap.py` can verify the join. Missing minutes are listed in the manifest, never invented.

## Status

Research and paper trading only. Not a claim of profitability.
