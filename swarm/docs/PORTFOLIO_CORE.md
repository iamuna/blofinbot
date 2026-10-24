# Portfolio core — Phase 2 of the upswarm guide (shadow)

The swarm today trades *ideas*: the first idea on a coin takes it, every trade risks the same 0.25%, and a trade waits
for its stop, target or time stop. The repo's best evidence comes from *positions* instead: every hour, "how much of
each coin should the book hold now, given every signal and the risk?" (GUIDE §4.4). The portfolio core does that.

## What runs

| Part | File | What |
|---|---|---|
| Adapter | `src/portfolio/constructor.js` `ideaTargets` | an idea of a strategy in trade asks for side × the notional whose stop costs 0.25% of equity (today's size), from the moment it is published until its shadow trade ends |
| Constructor | `src/portfolio/constructor.js` `combine` | sleeves × shares × dial → added up per coin (opposite views net out) → (cluster cap: built, off — see below) → forecast volatility capped at 10% a year (scaled down only) |
| Planner | `src/sleeve/sleeve.js` `plan`/`step` | the trend sleeve's planner, unchanged: risk ladders, a stop 8 daily σ away on every position, the stop-risk budget, the 25% no-trade band, every added leg through the RiskEngine |
| Conductor | `src/portfolio/conductor.js` | the dial = min(1, 10% ÷ the book's 60-day realised volatility), floored at 0.25; the weekly loss cap; a CUSUM per sleeve against what its backtest expects (`portfolio.expect` in config): an alarm halves its share, two in 60 days propose shadow |
| Agent | `src/portfolio/agent.js` (`portfolio`, decision group) | once an hour: the book above, advanced as a simulated account; publishes `portfolio.target` and `portfolio.state`; kv `portfolio`; on swarm-state in `state.json` → `portfolio` and in `summary.md` |

It sends no order, intent or command. The coordinator keeps trading exactly as before.

## Checks

- **The trend sleeve alone through the constructor is the sleeve's own book**, leg for leg: on synthetic data
  (test/portfolio.test.js) and on 2020–2026 research-data (9,298 legs, the same final equity to the cent:
  `tools/portfolio_backtest.js`).
- **Limits:** 150 random books with three sleeves asking for up to 3× equity each, against random other positions:
  open risk, gross, coin notional, net BTC exposure and risk per position stay inside risk.json every time.
- What the new caps and the conductor do to the trend sleeve on 2020–2026: `docs/PORTFOLIO_BACKTEST_2026-10-24.md`.
  The 10% volatility cap is neutral (the sleeve already runs at ~4.5% a year); the conductor never binds on the sleeve
  alone (it is the safety net for a book with more sleeves); the cluster cap helped on the unseen coins and hurt on
  the top 20, so it is off until a second sleeve trades.

## Switching it to trade (Ibrahim, not before two weeks of shadow)

Done when: two weeks of shadow match the simulator within costs (the shadow book against the trend sleeve's own and
the paper trades of the same strategies), and the limits held every hour. Then a protected change lets the coordinator
take its legs from `portfolio.target` (as it does for `sleeve:trend` today) and Ibrahim switches it with `/mode`.
Risk v2's limits (docs/RISK_V2.md) should be signed first.
