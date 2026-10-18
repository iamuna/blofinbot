# PROGRESS — multi-coin, multi-timeframe bot

Living log so work can resume if a session is lost. Newest status at the top of each section. Times are Europe/Amsterdam (entries from 16:58 on match the git commit times).

## Goal (Ibrahim, 2026-10-18 04:53)

Research the most robust, dynamic strategy possible: understand price action first (web + data), analyse every trading pair before trading it, build each pair's plan around its behaviour, and decide the best action on every timeframe at its own cadence — 1m every minute, 2m every 2 minutes, 3m every 3 … up to 3 months. Hardware: Windows PC (Ryzen 7 2700X, RTX 2070 Super) for research/ML; small 24/7 PC (Ubuntu Server 24.04 LTS recommended) for the live bot.

Decisions (his answers): **top 20 BloFin USDT perps**; timeframe design left to Claude; **paper → BloFin demo → small live**, each step only after the previous proves out; 24/7 PC OS: whatever is needed.

## Design (decided 2026-10-18)

- Every timeframe (1m, 2m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 3d, 1w, 1M, 3M) is evaluated at its own candle close.
- Layers: **big picture 1d→3M** (direction, regime, risk budget per coin) · **setups 1h→12h** (trade ideas) · **execution 1m→30m** (limit-order entry timing, exits every minute).
- Target-position style: each coin has a volatility-targeted target size from the trend ensemble; changes are traded only past a hysteresis band (controls fees).
- Every component must improve out-of-sample results to keep its vote (walk-forward, other eras, 2× fees).
- Evidence base: docs/MARKET_KNOWLEDGE.md.

## Status

| Step | State | Where |
|---|---|---|
| 1. Evidence review (web) | done 05:00 | docs/MARKET_KNOWLEDGE.md |
| 2. Top-20 universe + history (GitHub runner) | done 05:03 (verified 16:59) — 20/20 coins, 289 MB | tools/research_data.py → branch `research-data` |
| 3. Coin profiler | done 17:01 — 20 coins profiled | lab/mtf/profile.js → docs/COIN_PROFILES.md, research_out/profiles/ |
| 4. Multi-timeframe portfolio engine | v2 17:14 — 20-coin runs; execution layer studied | lab/mtf/mtf.js, research.js, execution_multi.js |
| 5. Validation (ablations, eras, sensitivity, costs, out-of-universe) | done 17:39 | docs/RESEARCH_MTF_2026-10-18.md, research_out/v3/ |
| 7. ML layer experiment | done 17:56 — not adopted (no out-of-sample edge) | docs/RESEARCH_ML_2026-10-18.md |
| 8. BloFin demo broker (step 2 of paper → demo → live) | built + tested 18:20, **switched off** (only Ibrahim can switch it on, on his PC) | lab/broker/, deploy/enable-demo.sh, docs/DEMO_TRADING.md |
| 6. Multi-coin paper bot + Ubuntu installer | deployed 17:44 on GitHub Actions (branch `mtf-state`); installer ready | lab/mtfbot.js, .github/workflows/mtf-bot.yml, deploy/ |

## Log

- 18:40 — Readiness check for the next step (lab/readiness.js, on the dashboard, daily in the supervisor procedure): judges mechanics written down in advance — days running, uptime, repeated errors, fills, execution cost (fees + slippage vs the price at the decision; fills now record that arrival price in paper and demo), drawdown, realised vol. Not profit. Paper → demo needs ≥ 21 days, ≥ 95% uptime, ≥ 40 fills, cost ≤ 10 bps, DD < 15%, vol 4–30%. Today: 4/7 (needs time, fills and 10 days for vol). Dashboard republished (same link) with the readiness table.
- 18:20 — **BloFin demo broker built, tested, off** (docs/DEMO_TRADING.md). lab/broker/blofin.js: signed client (recipe checked against BloFin's own blofin-mcp and blofin-sdk-python), demo host only — live impossible in this build; GETs retried, POSTs never. lab/broker/demo.js: every minute reads positions/orders/balance/book and works each coin toward its target with the paper bot's policy (post-only at best price → re-post when the market moves away → market after 30 min); intent fsync'd to a journal before every send; lost answers → SUBMIT_UNKNOWN, reconciled by clientOrderId before anything new; restart-safe; untracked bot orders cancelled at start; exposure reserved for resting/unresolved orders; refuses keys that are read-only or can transfer/withdraw; refuses GitHub Actions. 23 offline tests against a fake exchange that checks signatures and injects failures (lost answer after accept, failure before send, HTTP 502, crash mid-send, partial fills, post-only rejections, reduce-only/flip, caps, secrets). Paper path unchanged (replay before/after: identical 15 fills, same equity); demo replay against the fake exchange: same 15 fills, positions equal to paper rounded to contracts, equity $10,046.90 vs $10,043.22. Home PC: `sudo bash deploy/enable-demo.sh` (asks for the demo key, runs a second service next to paper, state branch demo-state-home); `--off` stops it and deletes the key. Also: report no longer crashes on coins without a price; supervisor `flatten` now holds every target at 0 until resumed.
- 18:05 — Live bot: 16:00 UTC hourly recompute ran on the new universe (LINK bought; others within band), equity $10,003.22, 12 positions, no errors.

- 17:56 — ML layer experiment (docs/RESEARCH_ML_2026-10-18.md): gradient boosting on the engine's daily state (all timeframe votes, vol, cross-coin rank, returns, funding, BTC vote), walk-forward by year 2023–26 on both coin sets and cross-universe. Daily rank IC −0.05…+0.02; every overlay ≤ plain vote system (top-20 2023–26: 1.19 plain vs 1.01–1.10 with ML). **Not adopted.** Revisit only with new information (order book, open interest, liquidations).
- 17:53 — Live bot restarted with weekly-universe code: 18 coins (LTC, LINK in; TRX, TIA, QNT out; SNDK order cancelled), 8 new-coin profiles written, 11 positions, no errors.
- 17:52 — Dashboard v2 published to the same link (https://claude.ai/artifact/DCr9QM1eNB8E2ULUU2VrwB): timeframe ladder 1m→3M with each frame's last close and average vote, 20-coin matrix (target vs holding, votes 1h→3M, cross-coin rank, status), selected-coin chart + profile, events, fills, equity, research expectations. Data docs bot/mtf_state, bot/mtf_journal, bot/mtf_candles via lab/sync_dashboard_mtf.js. Supervisor procedure (docs/SUPERVISOR.md) switched to the 20-coin bot; old BTC bot workflow retired (manual only).
- 17:48 — First live run of the 20-coin bot OK (seeded, BloFin synced, 12 orders, no errors). Found: the research-data rebuild at 15:15 UTC (triggered by a pipeline edit) changed today's top-20 (TRX/TIA/QNT out; LTC, LINK, SKHYNIX in), so TRX/TIA/QNT had only 60 days of history. Fixes: (1) tokenised stocks/commodities excluded from the universe (SNDK, SKHYNIX, …) in tools/research_data.py and lab/universe.json; (2) the bot follows the weekly top-20 and winds down coins it still holds; (3) short histories are deepened from BloFin 1H (paging back); (4) every coin is profiled before it trades (vol, beta, trend/mean-reversion horizons, fee share, smallest signal timeframe) and re-profiled daily — shown on the dashboard.
- 17:44 — Deployed the 20-coin bot (.github/workflows/mtf-bot.yml → branch `mtf-state`), running beside the BTC bot until verified. Seeds history from research-data (sparse checkout of 1h + funding), then BloFin 1H/1m live. deploy/run-bot.sh now runs mtfbot.js on the home PC with the same seeding. Timeframe clock verified (2m/3m on their minutes, 1w Monday 00:00, 1M on the 1st, 3M at quarter starts).
- 17:39 — Research report: docs/RESEARCH_MTF_2026-10-18.md. **v3 (shorts only 1d+, live-coin sizing, chase execution): Sharpe 1.40, CAGR 20.8%, vol 14.2%, max DD 13.9%, 6/6 eras.** Lookbacks ×0.7/×1.4 → 1.44/1.46; vol target 15/35% → 1.44/1.42; 2×/3× costs → 1.33/1.27 (6/6); BTC+ETH only 0.84 (6/6). Removing setup layer → 0.90; long-only 1.63 but loses 2022. **Out-of-universe (30 other coins incl. LUNA/FTT/SRM/MATIC): Sharpe 0.86, CAGR 11.3%, max DD 15.9%, 5/6 eras — the honest expectation.** Min-history rule hurts → off. Funding filter, Asia-open boost, fee gating: neutral → off.
- 17:38 — lab/mtfbot.js (20-coin paper bot) + lab/universe.json written; offline replay of June 2025 5m candles: seeding, hourly targets, limit/market fills, funding and summary all working.
- 17:14 — Engine v2 options: size by number of live coins (`normLive`), fee-aware setup gating (`adaptiveSetup`), setup long-only. 20-coin results 2020→2026 (fees+slippage+funding included): v1 long+short Sharpe 0.96 · shorts only on 1d+ 1.26 (positive in all 6 eras) · + normLive 1.36, CAGR 18.9%, max DD 14.7% · adaptive setup gating saves fees but no Sharpe gain (left off) · chase execution +0.02 Sharpe, fees 12%→9%.
- 17:13 — Execution study, all 20 coins, 6,659 rebalances on 5m candles (lab/mtf/execution_multi.js): market order 8.0 bps; **post at the best price, re-post each 5m bar for 30 min, then market: 5.9 bps in both halves** (robust); deep limit orders (10–40 bps or 0.5–2 ATR away) great in one half, bad in the other — rejected (trends run away from them).
- 17:12 — Ablations (lab/mtf/research.js, v1): long-only Sharpe 1.44 but −1.39 in the 2022 bear; shorts only on 1d+ timeframes 1.26 and positive in every era → intraday shorts are costly noise.
- 17:10 — 20-coin v1 baseline 2020→2026: Sharpe 0.96, CAGR 11.4%, vol 11.9%, max DD 13.9%, positive every calendar year incl. 2022 and 2026; 7 rebalances/day; fees 18.1% and funding 13.6% of equity over the period.
- 17:01 — Coin profiles done (docs/COIN_PROFILES.md). Fixed a day-alignment bug that understated BTC correlation for coins that listed mid-day. Findings: monthly moves persist in most coins (VR 1M > 1), hourly moves snap back in most (VR 1h < 1); fees are 10–60% of an hourly candle, so signals must come from 4h–1d+ and the 1m–30m frames time entries; alts move 1.2–1.5× BTC (corr 0.5–0.9).
- 16:58 — Session resumed. Saved the unpushed 05:05–05:22 work (lab/mtf/, deploy/). Dataset verified: 20/20 coins OK — BTC, ETH, ZEC, XRP, SOL, NEAR, Q, HYPE, DOGE, XMR, SUI, 1000BONK, PEPE (1000PEPE), HBAR, PUMP, SNDK, TRX, TIA, INJ, QNT. 1h history back to 2019-09 where listed (59,544 h for BTC), 5m for 24 months, funding. Notes: SNDK is a tokenised stock perp (Sandisk) with ~6 months of data; Q, HYPE, PUMP have ~1–1.5 years — short-history coins get smaller weights and are judged on less evidence.
- 05:20 — Portfolio research runner (lab/mtf/research.js): full system + ablations per layer/feature, long-only vs long+short, hysteresis and 2× cost stress, six market eras 2020→2026, BTC+ETH-only survivorship check.
- 05:15 — Coin profiler (lab/mtf/profile.js): liquidity, vol, candle range vs fees per timeframe, variance ratios 15m→1M, autocorrelation, trend efficiency, hour/weekday seasonality, BTC beta, funding → per-coin plan. BTC: trends at 1w/1M (VR 1.05/1.14), mild snap-back at 1d (0.93); fees are 32% of a 1h candle's range but 5% of a daily one.
- 05:13 — Multi-timeframe engine v1 (lab/mtf/mtf.js): Donchian trend ensemble on 1h,2h,4h,6h,12h,1d,3d,1w,1M,3M (each on its own closes), vol targeting per coin and portfolio, cross-coin momentum tilt, funding crowding filter, hysteresis rebalancing, fees + slippage + funding. BTC-only 2019→2026: Sharpe 0.91 long+short, 1.13 long-only, 0.79 at 2× costs; max drawdown 20–30% vs 56% for the 3M-only reference.
- 05:03 — Ibrahim asked to keep working, save to GitHub and keep this progress file updated each step.
- 05:02 — Pushed research-data pipeline (top-20 by BloFin 24h volume; Binance archive 1h full history, 5m 24 months, funding; checksums; gaps reported).
- 05:00 — Evidence review written: trend ensembles (days→months) are the strongest documented edge; cross-sectional momentum in large coins; minute-scale mean reversion real but below fees (matches our own 60k-config test); session effects; funding as crowding/cost; volatility targeting.
- 04:31 — High-frequency research: 100–200 trades/day on BTC does not survive costs (docs/RESEARCH_HF_2026-10-18.md).
- 04:05 — Paper bot live on GitHub Actions (BloFin feed), dashboard artifact, hourly supervisor scheduled task (:50 Amsterdam).

## Where things are

- 20-coin bot state: branch `mtf-state` (state.json, summary.md, hours/<COIN>.csv). Old BTC bot: `paper-state`. Home-PC paper bot: `paper-state-home`; demo bot (when switched on): `demo-state-home` (+ broker.json, broker-journal.jsonl).

- Repo: github.com/iamuna/blofinbot (main = code, `paper-state` = live paper bot state, `history-data` = BTC 1m gap fill, `research-data` = top-20 dataset).
- Dashboard: https://claude.ai/artifact/DCr9QM1eNB8E2ULUU2VrwB (synced hourly by the supervisor).
- Supervisor procedure: docs/SUPERVISOR.md. Research: docs/RESEARCH_*.md.

## How to resume

1. `git clone https://github.com/iamuna/blofinbot` and read this file top to bottom.
2. Check `research-data` branch for `manifest.json` (dataset status).
3. Continue at the first step not marked done; update the Status table and Log, commit, push after each step.
