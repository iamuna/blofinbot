# Supervisor procedure (every 6 hours, run by Claude)

The **20-coin multi-timeframe paper bot** (`lab/mtfbot.js`, workflow `mtf-bot.yml`, state branch `mtf-state`) acts every minute. The supervisor checks on it every 6 hours (scheduled task at 00:50, 06:50, 12:50 and 18:50 UTC; the bot workflow restarts itself every 30 minutes if a run dies, so the supervisor is the backstop), keeps the dashboard current and steps in only when something is wrong. PAPER only: the supervisor never adds API keys, never enables demo/live, never raises risk above the limits in `lab/universe.json`.

(The earlier single-coin BTC bot, `lab/paperbot.js` / `paper-state`, is retired: its workflow runs only on manual dispatch.)

If Ibrahim has switched on demo trading on his PC (docs/DEMO_TRADING.md), the demo bot's state is on branch `demo-state-home` and is read the same way (`summary.md`, `state.json`, plus `broker-journal.jsonl`). Extra checks there: intents stuck in `SUBMIT_UNKNOWN` / `CANCEL_UNKNOWN` for more than a few minutes, repeated `REJECTED_EXCHANGE`, `demo` events saying the broker is disarmed. The supervisor may pause or flatten it through `control.json` on that branch; it never touches the key or the service.

## 1. Read the bot

    git clone --depth 1 --branch mtf-state https://github.com/iamuna/blofinbot /home/claude/mstate   # or git -C /home/claude/mstate pull
    node lab/mtfbot.js report --state-dir /home/claude/mstate

Check in `state.json`:

- **Heartbeat** `updatedAt`: < 15 min old (pushes every 10 min). Up to ~40 min can be a shift change. Older than 40 min → the bot is down: change the `note` field in `lab/universe.json` (any text) and push to `main` — that restarts the multi-coin bot workflow.
- **Errors** `errors`: repeated identical errors need a code fix (fix, test offline with `--sim --seed-dir <research-data checkout>`, push to main).
- **Data events** (`events` with type `data`): missing hours, seed/BloFin disagreement (rescaling) — note them; never invent candles.
- **Universe** events: coins added (each must have a `profile` event) or winding down.
- **Risk governor** `governor`: `normal`, `daily-loss`, `half` (drawdown ≥ 15%), `flat` (≥ 25%, bot pauses itself), `paused`.
- Fills, open orders, positions, equity and drawdown since the previous supervisor line.

## 2. Intervene only for a reason

Write `control.json` on the `mtf-state` branch (new unique `id` each time), commit, push. The bot reads it every minute after its next pull (within ~10 minutes).

| Key | Effect |
|---|---|
| `pause: true/false` | stop/resume new orders (positions stay) |
| `riskScale: 0…1` | scale all targets (1 = validated size) |
| `flatten: true` | close every position with the normal order logic, then pause |
| `resetPeak: true` | reset the drawdown peak (only after a reviewed pause) |
| `note` | logged message |

| Situation | Action |
|---|---|
| Malfunction (wrong fills, runaway orders, broken data) | `pause: true` + note; fix the code; `pause: false` |
| Risk governor `flat` | leave paused; report to Ibrahim; resume only after review |
| Losing days / weeks within the historical range (drawdown < 15%) | no action |
| Anything else | no action; note it |

Never change risk or pause because of a few losing trades: the research expects long flat or losing stretches (worst historical drawdown 14–16%).

## 3. Refresh the dashboard

    node lab/sync_dashboard_mtf.js /home/claude/mstate /tmp/dash-mtf

Then write the three files to the dashboard artifact with `ArtifactData`: `get` each of `bot/mtf_state`, `bot/mtf_journal`, `bot/mtf_candles` with `out_dir` to learn its version, then one `batch` of `set` with `file_path` and `if_version` (`/tmp/dash-mtf/state.json` → `mtf_state`, `journal.json` → `mtf_journal`, `candles.json` → `mtf_candles`).

Dashboard: https://claude.ai/artifact/DCr9QM1eNB8E2ULUU2VrwB

## 3b. Readiness (first check after 00:00 UTC)

    node lab/readiness.js /home/claude/mstate

Mention the verdict in the report when it changes (e.g. "4/7 → 5/7", or "Ready for demo"). Ready means Ibrahim may switch on demo trading on his PC (docs/DEMO_TRADING.md); the supervisor never does it.

## 4. Log and report

Append one line to `supervisor.md` on `mtf-state` (UTC time, equity, change, positions, fills since last line, governor, action). Send Ibrahim two or three sentences: equity and change since the last review, notable fills or universe changes, anything you did and why. Say plainly when nothing happened.
