# upswarm — the swarm's upgrade guide and its evidence

Branch `upswarm-upG`. Nothing in this folder runs on the home PC (the update gate only looks at `swarm/`), and
nothing on `main` was changed.

| File | What |
|---|---|
| **[GUIDE.md](GUIDE.md)** | the guide: what the swarm does, whether it does what it says, every gap, the upgraded design (portfolio constructor, conductor, promotion rule v2, evolution engine, autonomy envelope), the roadmap, and the experiments behind it |
| [results/](results/) | the outputs of every experiment in GUIDE §13 |
| [tools/](tools/) | the research tools that made them (read-only; no exchange access, no keys) |

## The tools

| Tool | Does |
|---|---|
| [tools/live_audit.js](tools/live_audit.js) | the PC's paper trades and shadow record with the corrections a short sample needs: result without the biggest trade, longs vs shorts, t-stat with same-hour trades counted once, direction-adjusted R, what the ±0.7 rule would do |
| [tools/promotion_v2.js](tools/promotion_v2.js) | rule v2 (GUIDE §9) on today's state: which strategies the evidence supports; `--control` writes a `control.json` proposal (it never pushes) |
| [tools/trades_run.js](tools/trades_run.js) | backtests strategy variants on the swarm dataset with the live code path and keeps every trade; `--set config` (all configured), `exec` (entry policies), `exits` (exit policies) |
| [tools/selection_sim.js](tools/selection_sim.js) | replays "which strategies trade this week" rules week by week on those trades |
| [tools/trade_stats.js](tools/trade_stats.js) | how robust a result is: R from the 5 best trades, without them, median, positive months, longs vs shorts |
| [tools/weekly_scoreboard.js](tools/weekly_scoreboard.js) | positive weeks / months / quarters, worst week, longest run without a gain — for the trend sleeve's 2020–2026 backtest or for any set of trades |

## Reproduce (from the repo root; Node 22+)

```bash
# data and branches, once (shallow is fine)
git fetch origin swarm-state swarm-factory swarm-reports swarm-data research-data validation-data swarm-fix/sleeve-trade
for b in swarm-state swarm-factory swarm-data research-data validation-data; do git worktree add ../$b origin/$b; done
git worktree add ../sleeve origin/swarm-fix/sleeve-trade
git show origin/swarm-reports:history/2026-10-20/results.json > ../sweep-results.json

# 13.1 live audit, and rule v2 on today's state
node upswarm/tools/live_audit.js --state ../swarm-state --factory ../swarm-factory
node upswarm/tools/promotion_v2.js --state ../swarm-state --sweep ../sweep-results.json --factory ../swarm-factory

# 13.2 selection rules (the config run takes ~10 minutes and ~3 GB)
node --max-old-space-size=3200 upswarm/tools/trades_run.js --data ../swarm-data --set config --out ../runs/config
node upswarm/tools/selection_sim.js --trades ../runs/config/trades.json --sweep ../sweep-results.json

# 13.3 / 13.4 entry and exit policies
node --max-old-space-size=3000 upswarm/tools/trades_run.js --data ../swarm-data --set exec --out ../runs/exec
node --max-old-space-size=3000 upswarm/tools/trades_run.js --data ../swarm-data --set exits --out ../runs/exits
node upswarm/tools/trade_stats.js --trades ../runs/exits/trades.json

# 13.5 / §10 weekly scoreboard
node upswarm/tools/weekly_scoreboard.js --sleeve ../sleeve/swarm --research ../research-data --validation ../validation-data
node upswarm/tools/weekly_scoreboard.js --trades ../runs/config/trades.json --names ma-retest-12h,it-4h,rsi-macd-trend-12h,ma-retest-4h
```

Data used for the results here: `swarm-state` of 2026-10-24 02:43 UTC, `swarm-factory` of 2026-10-23 11:29 UTC, the
5-year sweep of 2026-10-20, `swarm-data` 2026-04-01 → 2026-10-21 (31 coins), `research-data` / `validation-data`
1h bars 2020 → 2026, and the trend sleeve at PR #4 (`swarm-fix/sleeve-trade`).

Research and paper trading only. Not financial advice, not a promise of profit.
