# Strategy factory

How a new strategy (or a new version of one) gets into the swarm. Every step is decided by numbers written down in
advance (`src/factory/gate.js`), and every try is logged so the bar rises with the number of tries.

1. **Idea** — the researcher (Claude, daily) writes a candidate file here, `candidates/<name>.json`:
   `{"name": "...", "base": "<plugin in src/strategies>", "params": {...}, "idea": "why it should work", "source": "paper / data / review that suggests it", "author": "researcher"}`.
   A genuinely new mechanism is a new plugin in `src/strategies/` (the strategy builder writes it with a test).
2. **Backtest** — pushing a candidate starts `.github/workflows/swarm-factory.yml`: every configured strategy and
   every candidate is backtested on the swarm dataset (same code as live), each try goes into `trials.jsonl` on the
   `swarm-factory` branch, and the backtest gate is applied:
   ≥ 300 trades · average R > 0 at 1.5× costs, overall and in the newest third · positive in 2 of 3 thirds ·
   t-stat ≥ 2 + 0.5·log10(number of tries).
3. **Shadow** — a candidate that passes is added to `config/swarm.json` → `strategies` with `"mode": "shadow"`
   (a reviewed commit). The brain then runs it on live data and the trader simulates every idea.
4. **Trade (paper/demo)** — the promotion gate moves a strategy from shadow to trade when it has ≥ 3 days and ≥ 150
   ideas in shadow and its live results are not worse than its backtest by more than 2 standard errors. It writes
   `control.json` on the `swarm-state` branch; the home PC applies it. Live money: only Ibrahim (/mode on Telegram).
5. **Demotion** — after ≥ 100 trades, average R < 0 with t ≤ −1, or a drawdown over 2× the backtest, sends it back to
   shadow. A strategy demoted three times, or with no ideas for weeks, is proposed for retirement by the agent manager.

Results: branch `swarm-factory` (`LATEST.md`, `latest.json`, `results/`, `trials.jsonl`).
