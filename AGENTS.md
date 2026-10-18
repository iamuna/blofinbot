# Agent / Developer Instructions

Read `HANDOFF.md` before modifying this repository.

## Current objective

Build a safe, auditable BTC-USDT perpetual 1-minute trading system that can discover and validate positive expectancy. Profitability is a research target, not an assumed capability.

## Required behavior

- Reconstruct current state from code/database before changes.
- Preserve raw historical data.
- Use UTC internally.
- Do not fabricate missing candles, fills, returns, tests, customers, revenue or exchange actions.
- Keep PAPER as the default.
- Do not weaken `RiskGovernor` to improve strategy results.
- No martingale.
- No blind retry after ambiguous order submission.
- Persist intent before broker submission.
- Reserve risk for unresolved accepted/unknown orders.
- Only closed candles may create durable signals.
- Do not allow the learner to edit live code or hard risk limits.
- Use chronological validation/test data; no random shuffling of time-series evaluation.
- Treat Elliott/harmonic interpretations as candidates, not truth.
- Keep Binance-spot vs BloFin-perpetual venue differences explicit.
- Never commit credentials.
- Do not merge unstable execution work into main.

## Before significant implementation

Inspect:

1. `HANDOFF.md`
2. `docs/LESSONS_FROM_BOT_AND_RESEARCH.md`
3. `docs/BLOFIN_EXECUTION_SPEC.md`
4. `docs/VALIDATION_AND_NEXT_STEPS.md`
5. `btc_bot/risk.py`
6. `btc_bot/db.py`
7. `btc_bot/learning.py`
8. tests

## Source repository reference

`iamuna/bot` is a reference for BloFin mechanics, logging/reporting and UI patterns. Do not copy its fixed aggressive risk profile or assume its 30-timeframe strategy is validated.

## Definition of done for new work

Every execution-related change should include:

- failure-mode analysis;
- offline test(s);
- explicit state persistence/recovery behavior;
- logging/reason codes;
- no silent degradation of safety gates.

When evidence is weak, prefer “no trade/no promotion” over forcing a result.
