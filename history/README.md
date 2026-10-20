# 5-year sweep

Every strategy × every timeframe (1m → 1d) on Binance USD-M history since 2021-10, with the point-in-time universe
(the live swarm's rules: 7-day volume ≥ $20M to enter, < $14M to leave, at most 80 coins — coins that later died
included), the live code path and costs; then a walk-forward selection: every quarter, the 5 best by return per
risk over the previous 12 months, traded for the next quarter only. Asked for by Ibrahim on 2026-10-20.

- `build.js` — the universe and the data (Binance archive; GitHub runners only)
- `sweep.js` — every strategy × timeframe (variants listed with `--list`)
- `select.js` — walk-forward selection and the report
- `manifest.js` — merges the build shards' manifests
- Workflow: `.github/workflows/swarm-history.yml`; data in the release `swarm-history-v1`; report on the
  `swarm-reports` branch under `history/`. Change `REBUILD` to rebuild the data.

Nothing here runs on the home PC (the update gate ignores paths outside `swarm/`).
