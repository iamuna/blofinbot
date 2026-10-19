# research-data

Top-20 BloFin USDT perpetuals by 24h volume (see universe.json), with Binance archive history:
1h candles (full), 5m candles (24 months), 8h funding rates. Columns: t (ms, candle open, UTC),
o, h, l, c, v (base), qv (quote), n (trades), tbv (taker-buy base volume). Rebuilt weekly by
.github/workflows/research-data.yml. manifest.json lists rows, gaps and any coin that failed.
