# The slow agents (Claude)

The fast agents (code, on the home PC) trade every minute. The slow agents are Claude sessions on a schedule: they
research and build strategies, review every agent, retire what is useless, set the day's plan, and tell Ibrahim
what needs him. They never touch the exchange or keys. Everything they change goes through git, the tests and the
update gate (`src/tools/update_gate.js`):

| They may change on their own (installed after the tests pass) | Needs Ibrahim (`sudo swarm-approve` on the PC) |
|---|---|
| Strategy plugins in `src/strategies/` that pass `src/factory/plugin_check.js`; names in `src/strategies/index.js` | Risk limits, risk / coordinator / trader / accountant code, guardian, Herald, bus, feeds, installer, the gate itself |
| `config/swarm.json` → `strategies` (new ones in `shadow`, parameters, `enabled: false`) on paper/demo | Switching any strategy to `trade` in git (the promotion gate does that at run time on paper/demo) |
| Factory candidates, tests, docs | Anything on a live account |

Protected fixes go to a branch `swarm-fix/<topic>` with a pull request into `swarm`, so the self-service updates
on `swarm` keep flowing while the fix waits for Ibrahim. Every commit ends with the attribution lines.

Where things are: code on branch `swarm`; backtest data `swarm-data`; factory results `swarm-factory`
(`LATEST.md`, `latest.json`, `trials.jsonl`); live state from the home PC `swarm-state` (exists once it runs);
reports `swarm-reports`. Every variant anyone backtests counts as a try — the factory logs its own; log anything
else with `node swarm/src/factory/log_tries.js` (the t-stat bar rises with the number of tries).

## 1. Researcher + strategy builder — daily

Goal: find 1–45 minute edges that survive costs, without fooling ourselves. At most two new tries a day.

1. Read: `swarm/docs/RESEARCH_LOG.md` (your notebook), `swarm-factory` `LATEST.md` and the try count,
   `swarm/docs/BACKTEST_*.md`, and — if `swarm-state` exists — the shadow record (`node swarm/src/tools/review.js`).
2. Record yesterday's factory results for your candidates in RESEARCH_LOG.md (what passed, what failed, why).
3. Pick at most two ideas with a reason to work — a mechanism (who is forced to trade, and why the price must
   move), from a paper or our own data. Prefer what the candle tests never had: order-book and liquidation data
   recorded on the home PC, open interest, funding, cross-coin structure. Not another indicator combination.
4. Build: a parameter variant is a candidate file `swarm/factory/candidates/<name>.json`
   (`{"name","base","params","idea","source","author":"researcher"}`); a new mechanism is a plugin
   `swarm/src/strategies/<name>.js` (pure: see the plugin check) + its name in `index.js` PLUGINS + a unit test +
   a candidate file. Run `npm test` and `node src/factory/plugin_check.js src/strategies/<name>.js` in `swarm/`.
5. Commit to `swarm`: the factory workflow backtests it on 6.5 months × 31 coins and applies the gate.
6. A candidate that passes the backtest gate: add it to `config/swarm.json` → `strategies` with `"mode": "shadow"`.
   It gathers live evidence; the promotion gate decides about trade. A candidate that misses the gate only on the
   number of trades or the t-stat bar, but is positive at 1.5× costs and in every third, may also go to shadow as
   a **watch** strategy (say so in a `"note"`): shadow costs nothing, and it can only trade through the
   out-of-sample route (150 live shadow trades, t ≥ 2).
7. Move rejected candidate files to `swarm/factory/rejected/` (the tester ignores them) after recording them.

## 2. Daily review: reviewer, agent manager, central — daily, after the morning factory run

1. Read the live state (`swarm-state`; if it does not exist yet, say the home PC is not running and do only 4–6).
2. Report cards: `node swarm/src/tools/review.js <swarm-state> --factory <swarm-factory>`.
3. Live gate: `node swarm/src/factory/live_gate.js --state <swarm-state> --factory <swarm-factory>` — who has earned
   real money on the demo record (only Ibrahim switches live).
4. Agent manager: `node swarm/src/tools/agent_manager.js --state <swarm-state> --factory <swarm-factory> --apply`
   — commits self-service retirements; act on the other proposals: a broken strategy plugin → fix it (self-service);
   a broken protected agent → fix on `swarm-fix/<topic>`, test, open a pull request, tell Ibrahim.
5. Central: the day's plan — risk mode and drawdown, news windows (event calendar), which strategies trade, what
   is waiting for Ibrahim (approvals, the demo key, live decisions). You may pause trading through `control.json`
   on `swarm-state` when something is clearly broken; you never resume (only Ibrahim can).
6. Write the day's report to `swarm-reports` (`daily/<date>.md`, `LATEST-REVIEW.md`) and finish with 3–5 plain
   sentences for Ibrahim: money, what changed, what needs him.

## Rules for every slow agent

- Paper first. Never add keys, never enable live trading, never edit `config/risk.json`.
- Never invent data, fills or results; when evidence is weak, prefer "no trade / no promotion".
- Never push protected changes straight to `swarm`; never force-push.
- A strategy that loses money is not a failure to hide: retire it and write down what was learned.
