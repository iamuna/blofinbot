# What moves crypto prices — evidence review (2026-10-18)

The design of the multi-timeframe system rests on findings with out-of-sample or multi-study support, plus our own tests on 4.8M BTC 1-minute candles. Each item says what it means for the bot.

## 1. Trends persist from days to months (strongest evidence)

- Trend-following ensembles of Donchian-channel breakouts with lookbacks of **5, 10, 20, 30, 60, 90, 150, 250 and 360 days**, each position scaled daily to **25% annualised volatility** (90-day realised vol, leverage capped at 2×), applied to the most liquid coins, report a **net-of-fees Sharpe above 1.5** and ~10.8% annual alpha versus Bitcoin over 2015–2025 (Zarattini, Pagani & Barbon, "Catching Crypto Trends", 2025). Entry: close above the lookback's highest close. Exit: trailing stop at the midpoint of that lookback's highest and lowest close.
- Intraday trend ensembles on BTC, volatility-targeted to 20%, report a gross Sharpe ~1.6 (2018–2025), with the strongest returns from Sunday evening New York time (Tokyo open) through Monday — the "Monday Asia open effect" (Concretum research).
- Bitcoin intraday time-series momentum: the first half-hour of a trading "day" (volume-defined) predicts the last half-hour, strongest in high-volume / high-volatility sessions (Shen, Urquhart & Wang, Financial Review 2022).

**For the bot:** the backbone is a multi-horizon trend ensemble across timeframes, volatility-targeted. Many lookbacks voting is more robust than one tuned lookback.

## 2. Across coins: momentum and size

- Three factors — crypto market, size and momentum — explain most cross-sectional crypto returns (Liu, Tsyvinski & Wu, "Common Risk Factors in Cryptocurrency", Journal of Finance 2022; data 2014–2018).
- One-day returns **reverse** in small, illiquid coins but show **momentum** in the largest, most tradeable coins (Zaremba et al., IRFA 2021). The daily reversal profit is concentrated in low-volume pairs and mostly disappears after costs and value-weighting; it is negative net on Binance (CERGE-EI WP 730).

**For the bot:** with 20 liquid coins, rank them by multi-horizon momentum and tilt risk toward the strongest (longs) and weakest (shorts). Do not build on daily reversal for liquid coins.

## 3. Minutes to an hour: real but untradeable mean reversion

- Crypto returns mean-revert at 15-minute and 1-hour horizons across 183 Binance pairs, 2021–2026 (out-of-sample AUC ≈ 0.53, Hurst ≈ 0.47), but the gross edge peaks at ~1.3 bp per trade — below even a 5 bp maker round trip. No pair cleared costs (Kitron & Wengrowicz, arXiv 2608.21888, 2026).
- Our own test (docs/RESEARCH_HF_2026-10-18.md): ~60,000 scalping configurations at 4–220 trades/day all lost after BloFin fees.
- Order-book imbalance predicts price at 100 ms–1 s horizons only, with modest accuracy and no tested trading profit (arXiv 2506.05764).

**For the bot:** 1-minute to 30-minute timeframes are used for **execution** — entering on short-term dips inside a higher-timeframe trend with limit orders, avoiding entries into spikes, managing stops every minute — not as standalone trade signals.

## 4. Time-of-day and day-of-week

- Strongest BTC hours historically 22:00–23:00 UTC, weakest 03:00–04:00 UTC (Gemini data 2015–2022, gross, in-sample; Quantpedia).
- Monday Asia open trend effect (above), much stronger after mid-2020.

**For the bot:** session effects are tested as a weight on execution timing and on risk (not as standalone trades), per coin.

## 5. Funding and the perpetual premium

- Perpetual funding ≈ the average futures–spot spread of the previous 8 hours. Perps traded above their no-arbitrage price for most of 2020–2022; past returns explain >50% of the premium (He, Manela, Ross & von Wachter, "Fundamentals of Perpetual Futures"). A spot-long / perp-short arbitrage earned Sharpe ≈ 1.8 on BTC under retail costs.

**For the bot:** funding is a cost of holding and a crowding signal — very high positive funding means crowded longs. It is used as a risk filter and in position cost, and a carry module can be evaluated later (needs spot + perp).

## 6. Liquidations and leverage

- Clustered liquidation levels act as "pressure points" where forced unwinds amplify moves (Glassnode, qualitative, no quantified forward returns).

**For the bot:** volatility expansions around obvious levels are handled by the volatility-targeting and stop logic; no standalone signal without data to test it.

## 7. Risk scaling

- Scaling exposure inversely to recent volatility is standard in every trend study above (20–25% target) and is what turns trend signals into stable returns.

**For the bot:** every coin is sized to a volatility target; total portfolio risk is capped, and correlation to BTC is taken into account so 20 coins don't become one big BTC bet.

## 8. Machine learning

- Studies comparing models on order-book and price data find simple models (XGBoost, logistic regression) as good as or better than neural networks at short horizons (arXiv 2506.05764).

**For the bot:** an ML layer (gradient boosting, GPU-capable on the RTX 2070) may combine the hand-built signals later — only if it beats the plain ensemble out of sample.

## Sources

- Zarattini, Pagani, Barbon — Catching Crypto Trends: https://abarbon.com/papers/catching-crypto-trends ; rules summarised at https://www.cxoadvisory.com/technical-trading/crypto-asset-trend-following-strategies/
- Concretum — Seasonality in Bitcoin intraday trend trading: https://concretumgroup.com/seasonality-in-bitcoin-intraday-trend-trading/
- Shen, Urquhart, Wang — Bitcoin intraday time-series momentum: https://research.birmingham.ac.uk/en/publications/bitcoin-intraday-time-series-momentum/
- Liu, Tsyvinski, Wu — Common Risk Factors in Cryptocurrency: https://alphaarchitect.com/factors-investing-in-cryptocurrency/
- Zaremba et al. — Up or down? Short-term reversal, momentum and liquidity: https://earsiv.medeniyet.edu.tr/items/23a96c9f-3952-4bdf-aec5-abafb3aaab70
- CERGE-EI WP 730 — cryptocurrency reversal and volume: https://www.cerge-ei.cz/pdf/wp/Wp730.pdf
- Kitron, Wengrowicz — Short-horizon mean reversion in cryptocurrency markets: https://arxiv.org/pdf/2608.21888
- Order-book prediction at sub-second horizons: https://arxiv.org/html/2506.05764v2
- Quantpedia — intraday/overnight anomalies in Bitcoin: https://quantpedia.com/are-there-seasonal-intraday-or-overnight-anomalies-in-bitcoin/
- He, Manela, Ross, von Wachter — Fundamentals of Perpetual Futures: https://arxiv.org/html/2212.06888v5
- Glassnode — liquidation heatmaps: https://research.glassnode.com/liquidation-heatmaps/
