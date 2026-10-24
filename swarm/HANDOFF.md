# Handoff: Ibrahim's BloFin "swarm" bot (as of 2026-10-21 05:30 Amsterdam)

## Where things are
- Code: repo iamuna/blofinbot, branch `main` (deployed; it was `swarm` until 2026-10-23). Bot lives in `swarm/`. Progress notes: `swarm/PROGRESS.md` ("Now — resume here").
- Runs on Ibrahim's Windows PC (HP ProDesk 400, i5, 8 GB RAM since 2026-10-23 (was 4 GB), DDR3 board) in `C:\swarm`. Paper account, $10,000. Logs in `C:\swarm\logs`, secrets in `C:\swarm\secrets.json` (never paste it).
- Status: the bot publishes `swarm-state` branch to GitHub every 10 min (state.json, summary.md, shadow.jsonl). Check with `git ls-remote origin refs/heads/swarm-state`, then fetch that commit.
- Telegram: `/status` (full report: account, per-strategy shadow + paper stats), `/pause`, `/resume`, `/flatten`, `/mode <name> off|shadow|trade`.
- Updates to protected code need Ibrahim's OK: Telegram tells him, he runs
  `powershell -ExecutionPolicy Bypass -File C:\swarm\app\swarm\deploy\windows\approve.ps1` in Terminal (Admin).
- Fresh install: `irm https://raw.githubusercontent.com/iamuna/blofinbot/main/swarm/deploy/windows/install.ps1 | iex`.

## State right now
- 52 strategies running in SHADOW (none in trade mode, so no paper trades). Coins 71–80 (maxCoins 80). No heap cap (1 GB cap removed).
- Last confirmed: the 52-strategy version is running (05:10 status). The newest `/status` layout (per-strategy stats, commit 99c031e) was approved at 05:02 but not confirmed installed yet. Check `/status`.
- Shadow results so far: only from the old 5-minute strategies (trend-pullback, overshoot-fade, leader-follow losing; session-drive +6 R on 4 trades). New 1h/4h strategies have no trades yet.

## Strategies (all shadow)
- Old retail set (re-enabled): intraday-trend, trend-pullback, session-drive, overshoot-fade, leader-follow, crowd-squeeze, noise-breakout, squeeze-ride, dip-reversal, harmonic, rsi-macd, ma-21-200, it-45-* variants, it-4h, ma-retest-12h/1d, rsi-macd-trend-12h, trend-pullback-1h.
- New: `krown-jewel-1h/2h` (Krown-style EMA 21/55/200 + stochastic RSI; approximation, his Jewel is private), `wyckoff-spring-1h/4h` (Mitch Ray TA spring + test, 3:1), `candle-<family>-1h/4h` (14 Japanese candlestick families, both sides).
- Plugin files: `swarm/src/strategies/` (krown_jewel.js, wyckoff_spring.js, candles.js new). Registered in `index.js`. Config `swarm/config/swarm.json`.

## Decisions Ibrahim made
- Timeframes: 1h–1d only for live strategies; short timeframes were rejected by the 5-year sweep (`history/` pipeline, `.github/workflows/swarm-history.yml`).
- Strategies start in shadow; promotion to trade is his call via `/mode`.
- Keep the bot's self-adding strategies shadow-only (he has not yet confirmed building that: offered, not built).
- No auto-approve via Telegram (declined).
- Memory: upgraded to 8 GB on 2026-10-23 (the 4 GB PC had ~2.5 GB free). The 4 GB-era limits are already gone: no Node heap cap (`deploy/windows/run.ps1`), universe back at 80 coins (`universe.maxCoins`). Using the headroom (PC reported 8,117 MB total, 6,152 MB free, swarm process 304 MB): `brain.keepBars` 1000 bars per timeframe and coin (was 400; ~+70 MB), `brain.seed4hBars` 4320 (720 days of 4h history at start-up instead of 240, so 12h/1d averages start as in the backtests; start-up ~1 min longer), two more shadow strategies (`it-12h`, `it-1d`), and the brain's own memory in `/status` ("brain N MB").

## Open items
1. Confirm `/status` shows the per-strategy layout (commit 99c031e). If not, run approve.ps1 again.
2. Let shadow results build 1–3 days on the 1h/4h strategies, then decide what goes to the 5-year sweep (add krown-jewel, wyckoff-spring, candles to `history/sweep.js` GROUPS).
3. Dragon (W double-bottom) pattern: offered, not built.
4. Self-adding strategies: offered (shadow-only, daily job, backtest gate), not built. Waiting for Ibrahim's go.
5. Security: the Telegram bot token was pasted in chat (he said he revoked and replaced it). A partial GitHub token appeared in a screenshot (4 characters). He chose not to rotate it.

## Working style notes (Ibrahim)
- Wants short, direct answers and status checks on request ("check now"). Asks for step-by-step instructions for the PC.
- Check the date/time at the start of every message (his memory preference).
- Commits: use the Co-Authored-By and Claude-Session lines required by the environment.
- Don't commit or push without asking, except the approved pushes he has already OK'd.
