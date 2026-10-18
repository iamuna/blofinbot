# Supervisor procedure (hourly, run by Claude)

The paper bot (`lab/paperbot.js`, GitHub Actions) acts every minute. The supervisor checks on it once an hour, keeps the dashboard current and steps in only when something is wrong. PAPER only: the supervisor never adds API keys, never enables demo/live, never raises risk above `RiskGovernor` limits.

## 1. Read the bot

    git clone --depth 1 --branch paper-state https://github.com/iamuna/blofinbot /home/claude/pstate   # or git -C … pull
    node lab/paperbot.js report --state-dir /home/claude/pstate

Check:

- **Heartbeat**: `state.updatedAt` should be < 15 min old (the bot pushes every 10 min). Up to ~40 min can be a shift change. Older than 40 min → the bot is down: bump `lab/restart.txt` on `main` (any edit) and push; that restarts the workflow.
- **Feed**: `state.venue`, `state.stale`, `state.gaps` — record gaps, never fill them with invented candles.
- **Errors**: `state.errors` — repeated identical errors mean a code fix is needed (fix, test with `--sim`, push to main).
- **Trades since the last review**, open position, rejects (`state.stats.rejects`), champion status and the last `state.thinks` verdicts.

## 2. Intervene only for a reason

Write `control.json` on the `paper-state` branch (new unique `id` each time), commit, push. The bot pulls it within 10 minutes.

| Situation | Action |
|---|---|
| Champion swapped on thin evidence (< 30 out-of-sample trades, or worse than the research champion's record) | `forceChampion` back to `lab/champion.json`, `riskPct` 0.125 if on probation |
| Malfunction (wrong fills, runaway rejects, data clearly broken) | `pause: true` with a `note`; fix the code; then `pause: false` |
| Drawdown breaker tripped | leave it; report it |
| Anything else | no action; note it in the summary |

Never use control to chase performance after a few trades. A 1h strategy needs dozens of trades before results mean anything.

## 3. Refresh the dashboard

    node lab/sync_dashboard.js /home/claude/pstate /tmp/dash-sync

Then write `bot/state`, `bot/journal`, `bot/candles` to the dashboard artifact with `ArtifactData` (`get` with `out_dir` to learn each document's version, then one `batch` of `set` with `file_path` and `if_version`).

Dashboard: https://claude.ai/artifact/DCr9QM1eNB8E2ULUU2VrwB

## 4. Log and report

Append one line to `supervisor.md` on `paper-state` (UTC time, equity, trades, champion, action taken). Send the user two or three sentences: equity and change since the last review, trades opened/closed, anything you did and why. Say plainly when nothing happened.
