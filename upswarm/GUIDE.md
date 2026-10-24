# UPSWARM — how the swarm works, what is wrong with it, and how to build the version that evolves on its own

Branch `upswarm-upG`, written 2026-10-24 for Ibrahim. Everything here was checked against the code on `main`
(commit 8b4062d), the PC's live state on `swarm-state` (2026-10-24 02:43 UTC), the factory results on `swarm-factory`,
the 5-year sweep on `swarm-reports`, the open pull requests, and new experiments run for this guide (section 13;
tools in [tools/](tools/), results in [results/](results/)). Nothing on `main` or on the PC was changed.

Research and paper trading only. Not financial advice, not a promise of profit.

---

## 0. Read this first (the short version)

1. **The swarm is well built.** The plumbing — message bus, signed orders, isolated strategy code, signed risk
   limits, exchange-side stops on demo, the factory with a multiple-testing bar, the 5-year sweep — is well above the
   usual standard for a one-person bot. 89 of 89 tests pass. Keep it.
2. **What it trades is chosen badly.** Right now 8 strategies trade on paper: `intraday-trend`, `dip-reversal`,
   `wyckoff-spring-1h`, `candle-engulfing-1h`, `candle-engulfing-4h`, `candle-morning-star-4h`, `candle-harami-4h`,
   `candle-three-outside-1h`. Every one of them loses in the factory backtest (6.5 months × 31 coins: −0.12 to
   −0.24 R a trade, t −1.3 to −10.6), and the six the deep review tested as one book lost in every year of 2020–2026
   (Sharpe about −5). They were picked on 2–4 days of shadow results.
3. **The paper profit is one trade.** 55 closed paper trades made +$441 (+16.4 R). One of them — an IRYS long by
   `intraday-trend` that caught a coin more than tripling in under five hours — made +$693 (+24.6 R). **Without it the account
   lost $252 (−8.2 R).** Longs lost, shorts won: the market fell. That is a market bet, not an edge.
4. **Picking strategies on recent results loses money — tested.** The ±0.7 average-R rule, applied to today's 4-day
   shadow record, would switch 9 strategies to trade — 8 of them with negative backtests — on 2 to 48 trades each,
   spread over 1 to 26 independent hours, 69 of their 89 trades shorts. Replayed week by week over 21 weeks of history (§13.2), the
   "48 h ΣR ≥ +10" rule lost **−1,003 R** and "±0.7 on the last 4 days" lost **−65 R**; a rule that lets only
   strategies with a positive 5-year record trade, and uses the live record only to veto, made **+125 R** out of
   sample.
5. **"+R every week" is not possible, and chasing it is what goes wrong.** The best-evidenced system in the repo (the
   trend sleeve, PR #4: Sharpe 1.07 on 2020–2026, 0.78 on 30 coins it never saw) has a positive week only **47–49% of
   the time**, with up to 13–15 weeks in a row without a gain. Trend following makes its money in a few big weeks.
   Even a Sharpe of 3 — elite — gives positive weeks only two times in three. Judge the swarm by the quarter, cap the
   weekly loss, and never switch strategies on a week's result (§10).
6. **The fix is not more strategy agents. It is better judgement agents.** The swarm runs 64 strategies; of the 62 the
   factory tested, 44 lose money and 26 of those clearly (t ≤ −2). What it lacks is a **portfolio constructor** (one book for all signals,
   sized to volatility and correlation, instead of "first idea grabs the coin"), a **conductor** — the heart that sets
   one risk dial from drawdown, volatility and live edge health — and a **promotion rule that cannot be fooled by a
   few days of market direction** (§6–§9).
7. **"Not attached to a trade" is the right instinct, and the evidence agrees.** The systems that hold up in the repo
   (the trend sleeve, the slow trend set) are positions that keep re-asking "how much should I hold now?", not trades
   that wait for a stop or a target. Upswarm turns every signal into a target exposure and lets the book move with the
   market (§6.2).
8. **"Evolve without permissions" is possible — inside walls you sign once.** The swarm may already install new
   strategies on its own. What is missing is a promotion pipeline that works: today nothing has ever passed the
   factory gate, so every real decision is made by hand on noise. Upswarm lets it create, test, shadow, promote on
   paper, re-weight and retire strategies by itself, under limits it can never change (§11).
9. **Do these first (Phase 0, no code):** put the 8 losing strategies back in shadow; let `ma-retest-12h`,
   `rsi-macd-trend-12h`, `ma-retest-4h` and `it-4h` trade at the start size; approve PR #4 (the trend sleeve) and let
   it trade on paper after a short shadow check; replace the ±0.7 rule with rule v2 (§9, tool:
   [tools/promotion_v2.js](tools/promotion_v2.js)). Then build the portfolio core (§12).
10. **One test to run next:** on 6.5 months, letting the slow trend trades run to their stop or time stop instead of
    taking profit at 2R more than doubled their R (`rsi-macd-trend-12h` +76 → +176 R) — but a few long trades in a
    rising market carry most of it. Run it through the 5-year sweep with dead coins before changing any exit (§13.4).

---

## 1. What the swarm is (technical tour)

A team of programs ("agents") on the home PC that trade BloFin USDT perpetuals on a paper account, plus scheduled
Claude sessions ("slow agents") that research and review. They talk only through one message bus (Redis Streams, or
memory in tests). Orders, commands and account messages are signed with a key the strategy code never sees.

```
 BloFin + Binance feeds ─► data guard ─► brain: features (1m → 1d bars), regime, 64 strategy plugins ─► idea
                                                                                                        │
     shadow: ExecSim simulates EVERY idea (backtest rules) ◄────────────────────────────────────────────┤
                                                                                                        ▼ only mode 'trade'
 coordinator: fusion (one intent per coin) → allocator (quarter-Kelly, 0.25% to start) → risk engine (signed limits)
                                                                                                        │ signed order
                                                                                                        ▼
 trader (paper) / demo trader (BloFin demo, exchange-side stops) ─► fills, positions, closed trades ─► accountant
 ops: guardian (risk.json signature) · watchdog · herald (Telegram) · state-sync (→ branch swarm-state every 10 min)
 slow agents (Claude, scheduled): researcher → factory (6.5-month backtest + gate) → shadow → promotion · daily review
```

| Layer | Agents | What they really do |
|---|---|---|
| Sensors | universe, blofin-feed, binance-feed, guard, recorder, events | 71–80 coins with ≥ $20M/day on Binance and ≤ 5 bps BloFin spread; trades, books, bars, funding, open interest, liquidations; data health; everything recorded 60 days; no-new-risk windows around US high-impact news |
| Brain | features, regime, 64 strategy plugins, ExecSim | builds 1m → 1d bars and indicators per coin; each plugin is a pure function `onBar(bar, features) → idea`; every idea is simulated in shadow |
| Decision | coordinator (fusion, allocator, risk) | 1.5 s collection window, then: one intent per coin, size = equity × budget ÷ stop distance, then the hard limits (risk per trade 1%, open risk 6%, coin 1× equity, gross 4×, net BTC beta 2×, spread, 10% of top-5 depth, day-loss and drawdown ladders) |
| Execution | trader / demo trader, accountant | maker chase or taker entries, stop-market stops, maker targets, trailing, time stops, funding; on demo the stop sits on the exchange the moment the entry fills |
| Ops | guardian, watchdog, herald, state-sync | signature check of `risk.json` (mismatch → flatten + halt), health, Telegram (/status /pause /resume /flatten /mode), state to GitHub |
| Research | factory tester + gate, promote.js, live_gate.js, tuner, event study, 5-year sweep, agent manager | backtests every configured strategy on 6.5 months × 31 coins; gate: ≥ 300 trades, positive at 1.5× costs and in the newest third, t ≥ 2 + 0.5·log10(tries) (now 3.30 at 401 tries); shadow → trade route; retirements |

The logic of one trade today: a strategy sees a closed bar, returns an idea (side, entry, stop, target, time stop).
If its mode is `trade`, the coordinator fuses it with other ideas on the same coin, sizes it so the stop costs 0.25%
of equity, trims it to every hard limit, signs it and sends it to the trader. The trader works the entry, then
manages the position until stop, target, trail or time stop. The accountant books the result in R (profit ÷ amount
risked).

## 2. Does it do what it says? (claim by claim)

| Claim (README / INDEX / docs) | Verdict | Evidence |
|---|---|---|
| Every agent talks only through the bus; malformed messages fail at the sender | ✔ | `core/bus.js`, `core/schemas.js` |
| Orders, commands, account messages are signed; strategy code is away from the keys | ✔ | `core/auth.js`; brain isolated (Linux user, Windows permission model, `core/isolate.js`); plugin check before load |
| Risk limits are hard and signed; no agent edits them | ✔ | `config/risk.json` + guardian signature check; update gate keeps risk code protected |
| The limits hold | ✔ now, ✖ before 2026-10-23 | 29 positions at 5.07× gross and 6.8× BTC exposure on 2026-10-22 (orders in flight were not counted); fixed in 675c556; today gross 2.05×, open risk 3.5% |
| Shadow uses the backtest's rules, so shadow = test | ✔ (mostly) | `brain.js` runs ExecSim on live bars. Shadow ignores fusion, "coin busy" and risk trims, so shadow R ≠ paper R |
| Live trading is impossible in this build | ✔ | demo client cannot reach the live host; live needs liveEnabled + signature + /mode |
| "Every idea is judged on evidence; the promotion gate decides what trades" | ✖ | The gate has never passed a strategy (bar 3.30). Every `trade` mode on the PC was set by hand: `control.json` of 2026-10-23 ("48h shadow R ≥ +10 → trade") and `/mode` |
| The multiple-testing bar controls luck | ◐ | Tries are counted (401). But the t-stat treats every trade as independent; trades entered in the same hour on a falling market are one bet, not 20. `factory/gate.js stats()` |
| The swarm improves itself | ◐ | Plugins and shadow config install themselves; the researcher makes ≤ 2 tries a day; the agent manager can retire. But nothing gets promoted by evidence, and capital never moves by evidence (the allocator needs 100 paper trades per strategy first) |
| Paper account +8.8% | ✖ as an edge | one trade (+24.6 R on IRYS); without it −8.2 R; longs −28.9 R, shorts +20.7 R without it (§13.1) |
| Strategies trade 1h–1d because sub-hour loses | ◐ | the slow set is in config, but 5 of the 8 strategies in trade run on 1h or faster bars and pay about 0.04–0.2 R a trade in costs |

**Bottom line:** the machine does what it says. The decisions about what the machine trades do not follow its own
evidence.

## 3. Technical review

### 3.1 What is good (keep it)

- **Safety architecture.** Signed authority messages, isolated strategy code, a static plugin check, a protected-code
  update gate that judges new commits with the *installed* code, signed risk limits with a guardian, read-only keys,
  demo-only client. This is the part that makes autonomy possible later.
- **Same code path everywhere.** `FeatureState → StrategyHost → ExecSim` runs in backtests, the factory, the 5-year
  sweep and live shadow. A plugin cannot behave differently in the test.
- **Conservative fills.** Limits fill only when price trades *through* them; stop and target on the same bar → stop;
  no target on the fill bar; funding charged; R measured against at least 10 bps of risk.
- **Demo trader.** Intent journal before every send, UNKNOWN orders looked up by clientOrderId (no blind retries),
  exchange-side stop the moment an entry fills, stop moved new-first-then-cancel-old, reconcile every 2 s.
- **Honest research culture.** Every try logged; losers written down; look-ahead bugs found and fixed (pivot-matrix
  spec, streak replay, R blow-up); era test 2018–2021; validation coins including dead ones.

### 3.2 What is wrong or missing (by severity)

| # | Problem | Where | Effect | Fix (section) |
|---|---|---|---|---|
| G1 | **Modes set on days of shadow** ("48h ΣR ≥ +10", now "avg R ±0.7") | `control.json`, `/mode` | the paper account trades the worst strategies in the repo | §9, Phase 0 |
| G2 | **The promotion pipeline never fires** | `factory/gate.js`, `promote.js` | the swarm cannot evolve by evidence, so humans decide on noise | §9, §11 |
| G3 | **t-stats assume independent trades** | `gate.js stats()`, `review.js`, `/status` | 20 shorts in one falling hour count as 20 proofs | §9 |
| G4 | **No portfolio construction:** first idea grabs the coin ("coin busy"), every trade risks the same 0.25% whatever its horizon or correlation | `decision/fusion.js`, `allocator.js` | a 1h candle trade can block a 12h trend trade on the same coin for 30 h; 20 longs on 20 alts = one BTC bet; limits fill up with the noisiest strategies (today 79 of 86 rejections were gross/BTC-exposure) | §6.2–6.3 |
| G5 | **No risk dial before losses happen:** no volatility targeting, no weekly loss cap; ladders react only after a drawdown | `decision/risk.js` | size does not shrink when markets get wild | §6.4–6.5 |
| G6 | **Idea and coin sanity:** a negative target price and a stop 343% away passed validation (IRYS, 2026-10-23); pumping coins are tradable | `strategies/kit.js validIdea`, `market/universe.js` | garbage ideas reach the coordinator; outliers dominate results | §6.6 |
| G7 | **Allocator ignores the backtest:** 0.25% until 100 *paper* trades, then quarter-Kelly | `allocator.js` | a 12h strategy needs a year of paper trades before its size reflects evidence | §6.3 |
| G8 | **The factory cannot judge slow strategies:** 6.5 months, 21-day warm-up, no seeding → `ma-retest-12h` 54 trades, `ma-retest-1d` 0 | `factory/test_candidates.js` | the strategies with the best evidence never pass the gate; the 5-year sweep that can judge them runs by hand | §8 |
| G9 | **Selection by trailing performance across many variants** | `history/select.js` walk-forward | Sharpe 0.49 → 0.10 when one more variant joined the pool: the selector picks the luckiest | §4.3 |
| G10 | **Recordings never reach research** | recorder (60 days on the PC) | liquidation and order-book ideas (queue 2, 3) cannot be tested | §8.5 |
| G11 | **64 strategies running; 44 of the 62 tested lose, 26 clearly** | `config/swarm.json` | noise in `/status`, temptation to promote losers on luck | Phase 0 |
| G12 | **Regime is computed, barely used** | `analysis/regime.js` | a coin's bias is a filter in a few plugins; nothing at portfolio level knows "BTC is in a downtrend and volatile" | §6.5 |
| G13 | **Exits are fixed per plugin** (2R targets on trend entries) without a sweep-level test | plugins | possible tail cut; measured in §13.4 | §7 |
| G14 | **1-minute beta for 12h–1d positions** | `features.js beta()` | checked in the live review: not wrong today, but the matching horizon is a 30–60-day daily beta (the sleeve uses 30 days) | §6.4 |
| G15 | **One PC, no standby** | ops | fine on paper; on demo/live the exchange-side stops carry the risk | §12 Phase 5 |

## 4. Logical and theoretical review

### 4.1 Where money in crypto perpetuals can come from

A strategy earns only if someone else is *forced* or *willing* to pay it. The documented, repeatable sources are:

| Source | Why it pays | Horizon | In the swarm |
|---|---|---|---|
| **Time-series momentum (trend)** | information spreads slowly, herding, forced deleveraging extends moves; documented strongly in crypto (Liu & Tsyvinski, *Risks and Returns of Cryptocurrency*, RFS 2021) | days–weeks | ✔ the only thing that works here: trend sleeve, ma-retest 4h/12h, rsi-macd-trend-12h, donchian-12h-60 |
| **Cross-sectional momentum** | winners keep beating losers for weeks (Liu, Tsyvinski & Wu, *Common Risk Factors in Cryptocurrency*, JF 2022) | 1–4 weeks | only as a tilt inside the trend sleeve; no market-neutral sleeve |
| **Carry / funding** | longs pay to use leverage; the payer is crowded and crash-prone (Schmeling, Schrimpf & Todorov, *Crypto Carry*, BIS 2023) | days | `funding-fade` (no edge at 4h, weak at 12h); no carry harvest |
| **Liquidity provision after forced flows** | liquidated traders pay for immediacy; price overshoots and partly reverts | minutes–hours | `dip-reversal`, `squeeze-ride`, `oi-flush`; fails with stops at 15m; the data to do it well (liquidations, book) sits unused on the PC |
| **Volatility management** | not an edge on its own: scaling exposure by 1/volatility raises the Sharpe of trend and factor books (Moreira & Muir, *Volatility-Managed Portfolios*, JF 2017) | — | only inside the sleeve |

Chart patterns, candles, harmonics, Wyckoff, pivots, indicator crosses are **descriptions of price, not reasons
someone must pay you**. The swarm's own tests prove it: for every pattern family, the average move in favour after
entry equals the average move against (MFE ≈ MAE ≈ 1.0–1.2 R), before costs they are near zero, after costs negative
in every sample. No filter, stop or target can add a direction that is not there (deep review 2026-10-23).

### 4.2 The cost wall

A round trip costs 8–17 bps (maker in / taker out: 2 + 6 + 1.5 slippage; taker both ways ~15). A 1h stop is ~1% away,
so costs are 0.1–0.2 R before the trade starts. A 12h trade risks ~3–6%, so the same costs are 0.02–0.04 R. Below 1h
no strategy found in ~60,000 configurations and 101 sweep variants clears it. **Every R the swarm earns must come
from moves several times larger than the costs.** This is why "more active" cannot mean "more trades per coin"; it
can mean *more coins and more independent slow signals* (breadth).

### 4.3 The statistical traps the swarm already walked into

1. **A few days measure the market, not the strategy.** In the 4-day shadow record, all longs averaged −0.59 R and all
   shorts +0.34 R. Most "winners" of the 48 h rule were short-heavy strategies in a falling market. The live review of
   2026-10-23 found the same and advised shadow; the 48 h rule, applied shortly after, put them in trade, and the deep
   review the same day measured them as the worst in the repo. The rule overrode the evidence — that is the problem
   to fix, not the people.
2. **Clustered trades are one bet.** Twenty shorts opened in the same hour all win or all lose together. Per-trade
   t-stats then look huge (today: t = 1,357 for `candle-three-inside-4h` on 2 trades in one hour). The honest unit is
   the hour or the day.
3. **Many tries make luck look like skill.** With 401 variants tried, the best of them is expected to look good by
   chance. The t bar rises with tries (good). The same logic applies to *people*: looking at 64 shadow records every
   morning and promoting the best is 64 tries a day.
4. **Selecting by trailing performance among many variants fails.** The walk-forward "top 5 by last 12 months"
   earned Sharpe 0.49, and 0.10 once one more variant was in the pool. With low signal-to-noise, a fixed, diversified,
   equal-risk set beats "pick last year's winners" (DeMiguel, Garlappi & Uppal, *Optimal Versus Naive
   Diversification*, RFS 2009 — the same effect in stock portfolios).
5. **Survivorship.** Today's top coins rose ~80% over the factory window; long-only results there are inflated. The
   validation coins (dead ones included) are the honest test — and the trend sleeve still earns there (0.78–0.86).
6. **Outliers.** One trade made the paper account. With fat tails, judge on the median week and the result without
   the best trade, not the total.

### 4.4 Trades versus positions — the main design lesson

The swarm's model is *a trade*: enter, then wait for stop, target or time. A position is "attached" to the idea that
opened it, even when the reason is gone, and while it is open the coin is locked for every other strategy.

The repo's best evidence comes from the other model, *a position*: every hour, ask "how much of this coin should I
hold now, given all signals and the risk?", and move toward that number when it differs enough to be worth the cost.
The trend bot (Sharpe 1.40 / 0.86 unseen) and the sleeve (1.07 / 0.78 under the swarm's limits) are built this way.
Advantages:

- exits happen when the *signal* weakens, not only at an arbitrary stop or target;
- several signals on one coin add up or cancel (no "coin busy");
- risk is managed by size (volatility targeting) continuously, with a far stop only for disasters;
- the book can be scaled up or down in one move by the conductor (the heart).

Upswarm keeps idea strategies working through an adapter (§6.2) and moves the book to target exposures.

## 5. Your questions, answered

**What does it do, how, and what is the logic?** §1. In one line: 64 rule-based signal generators produce trade
ideas on 71–80 coins; a decision layer turns the ones in `trade` mode into sized, risk-checked orders; a paper
broker executes them; scheduled Claude sessions research new rules.

**What is good and bad?** §3. Good: safety, plumbing, honest research. Bad: what trades is chosen on noise; no
portfolio construction; no forward-looking risk dial; slow strategies cannot pass the gate built to promote them.

**Does it need more agents?** Not more *strategy* agents — it has 64, and the 44 losing ones only add noise. It
needs a few *judgement* agents, in this order of value: (1) portfolio constructor, (2) conductor (the heart), (3) the
promotion/retirement rule as an agent, (4) execution-cost tracker, (5) positioning (funding/OI/liquidation) agent,
(6) sentinel for coins and ideas, (7) auditor. A social-media sentiment agent comes last (§7.4). Specs in §7.

**Does it have gaps in its logic?** Yes, §3.2 (G1–G15) and §4.3.

**Does it actually do what it says?** The machinery yes; the selection no (§2).

**How can the bot create and test its own strategies and move with the markets without being attached to a
trade?** Two parts. Creating and testing: the evolution loop in §8 — a generator works from a library of mechanisms,
a screen (event study) kills ideas with no direction before a backtest, the 5-year sweep validates on dead coins
and two eras, shadow checks the live market, and rule v2 — the long-history record selects, the live record vetoes —
promotes and retires; all on its own, inside signed limits. Not being attached: target exposures instead of trades (§4.4, §6.2).

**How can the bot protect trades while the price moves?** §7.6 and the exit test in §13.4. Short answer: protect
the *account* first (size by volatility, exchange-side disaster stop on every position, BTC-exposure and cluster
caps, a weekly loss cap); protect *profits* by exiting when the signal weakens, not by tight stops. Measured so far:
break-even at +1 R cost the robust five 10% of their R; on 5 years a trailing exit was no better than a 2R target; on
the last 6.5 months, removing the 2R target more than doubled the slow strategies' R, carried by a few long runs —
the next test to settle (§13.4).

**How can it benefit from a risk manager, sentiment agent or heart agent?** §7: the risk manager becomes a portfolio
risk manager (volatility target, correlation clusters, expected shortfall, weekly cap); the "sentiment" that can be
tested is *positioning* — funding, open interest, liquidations, Fear & Greed — with years of history; social
sentiment is recorded first and tested later; the heart is the conductor that beats once an hour and sets one risk
dial for the whole swarm.

**Do the strategies use correct and efficient execution?** Mechanically yes and conservatively modelled (§13.3): for
the slow strategies, maker-chase entries fill 99%+ of ideas in simulation and save ~5.5 bps a trade over market
orders; the 3-minute cancel misses about 1% of ideas at most. The inefficiency is elsewhere: the 1h strategies in trade
take market entries and stop-market exits on tight stops, so costs are about 0.04–0.2 R a trade — larger than any
edge they have. Fixes: a cost gate, urgency-based order handling, live implementation-shortfall tracking (§7.5).

**Can it make +R every week?** No system can promise that, and aiming for it pushes toward exactly the mistakes in
§4.3. What it can do: positive *expected* R every week, a hard cap on the weekly loss, and positive results most
quarters (§10).

## 6. Upswarm: the upgraded design

### 6.1 Three loops

```
 FAST LOOP (each closed bar)                    DAILY LOOP — the heart                 EVOLUTION LOOP (daily/weekly)
 sensors ─► signal sleeves ─► portfolio         conductor: pulse = drawdown,           generator ─► screen (event study)
 (feeds,    (trend, slow     constructor        volatility, edge health per sleeve,    ─► 5-year sweep + era + unseen coins
  guard,     retest, xs-mom, (one book,         week-to-date result, market regime     ─► shadow ─► promotion rule v2
  sentinel,  carry, events)   vol + corr)        → risk dial + sleeve shares           ─► capital share grows with evidence
  positioning,                 │                auditor: paper vs shadow vs backtest   ─► CUSUM retirement
  regime)                      ▼                scoreboard: weekly R, expected range   (all tries logged; paper only)
            risk manager v2 (signed limits) ─► execution v2 ─► position guardian (exchange stops) ─► accountant
```

### 6.2 Signals become target exposures (the adapter)

Every signal source becomes a **sleeve** that publishes, each bar it decides, a target weight per coin in
[−1, +1] (conviction) — like the trend sleeve's `sleeve.target` (PR #4).

- Native sleeves compute weights directly (trend sleeve; a new cross-sectional momentum sleeve).
- **Idea strategies keep working through an adapter:** an idea contributes `side × 1` to its sleeve's target on that
  coin from its entry until its stop, target or time stop would have closed it (exactly what ExecSim already tracks
  in shadow). The idea's stop becomes a *risk input* (its distance sets the idea's volatility), not an order.
- Sleeves never send orders and never lock a coin.

### 6.3 Portfolio constructor (replaces fusion + allocator; keeps the risk engine)

Each hour, or when a sleeve publishes:

1. **Scale each sleeve to its risk budget.** Weight per coin × (sleeve's vol budget ÷ coin's daily volatility,
   60–90-day realised). A sleeve's budget = conductor's sleeve share × total budget.
2. **Add the sleeves up per coin.** Opposite views net out (no fee paid twice, as fusion does today, but by size, not
   "first come").
3. **Portfolio volatility target.** Scale the whole book so its forecast volatility (shrunk covariance of 60–90-day
   daily returns) equals the target (start 10% a year on paper; the sleeve runs ~7% under the limits).
4. **Caps.** Per coin notional, gross, net BTC beta (30–60-day daily beta, as the sleeve uses), and new **cluster caps**
   (coins grouped by return correlation: majors, L1s, memes, AI…; no cluster more than ~40% of gross).
5. **No-trade band.** Trade a coin only when its target differs from the holding by more than ~25% (the trend bot's
   band: ~5 rebalances a day across 20 coins). This is what keeps costs low.
6. **Output:** target positions → legs → risk engine → execution. Profit and loss is attributed to sleeves by their
   share of each coin's target (for scoring and for the conductor).

Capital between sleeves starts **equal-risk** (§4.3 point 4) and moves only by the promotion rule (§9), never by last
week's result. A sleeve's starting share for a newly promoted strategy is small (e.g. 10% of a normal share), growing
with live evidence.

### 6.4 Risk manager v2 (still signed; only Ibrahim changes the numbers)

Keep every limit in `risk.json`. Add, as new signed keys:

| New limit | Suggested start | Why |
|---|---|---|
| `weekLossStopPct` | 2.5% | week-to-date loss ≥ 2.5% → no new risk until Monday 00:00 UTC; caps the weekly loss distribution, which is what the weekly goal really needs |
| `weekLossHalvePct` | 4% | a week ending ≤ −4% → next week at half size |
| `maxClusterGrossFrac` | 0.4 | one correlated group cannot be most of the book |
| `esLimitPct` | 4% | 97.5% one-day expected shortfall of the current book on the last 365 days of returns |
| `maxStopDistPct` / `minTargetPx` | 25% / > 0 | reject nonsense ideas (G6) |
| `liqBufferX` | 3 | the stop must be at most 1/3 of the way to the estimated liquidation price |
| `portVolTargetPct` | 10% | the constructor's target; the conductor may only scale *down* from it |

The day-loss and drawdown ladders stay as they are.

### 6.5 Regime, positioning and the market state

- **Market regime agent** (upgrade of `regime.js`): BTC trend votes (the same Donchian set, daily), BTC and
  cross-section realised volatility percentiles, breadth (share of coins above their 200-day average), average pairwise
  correlation, dispersion. Published hourly as `regime.market`. Used by the conductor (dial) and as a tag for the event
  study — never as a hand-made on/off switch without a test.
- **Positioning agent** (new; the testable "sentiment"): funding level and 3-day average (and its z-score across
  coins), open-interest change, liquidation intensity, basis (mark vs index), and the daily Fear & Greed index
  (history since 2018, so it can go through the sweep). Published as `pos.state` per coin; used by the carry sleeve
  and as event-study tags.

### 6.6 Sentinel (coin and idea sanity)

- Idea checks before the coordinator: target > 0, stop within `maxStopDistPct`, stop distance ≥ 2× round-trip cost,
  stop inside the liquidation buffer.
- Coin checks: at least 30 days of bars before any new risk; a coin that moved more than ~8 daily σ in an hour, or
  whose BloFin and Binance prices diverge, gets no new risk for 24 h (exits always allowed). IRYS (+264% in under five
  hours, then −61% in 15 minutes) would not have been tradable.

## 7. Agent specifications

Each spec: purpose · in · out · rules · cannot · done when.

### 7.1 Portfolio constructor (`src/portfolio/constructor.js`, protected)
- **Purpose:** one book from all sleeves (§6.3).
- **In:** `sleeve.target`, idea adapter weights, `conductor.dial`, betas/vols/covariances (daily), positions, books.
- **Out:** `portfolio.target` (per coin target notional + why), legs to the risk engine as `intent`s.
- **Cannot:** exceed `risk.json`; trade a coin the sentinel blocks for new risk.
- **Done when:** it reproduces the sleeve backtest exactly when only the trend sleeve runs (the executor check PR #4
  already has), and a fuzz test like PR #4's keeps every limit with several sleeves at once.

### 7.2 Conductor — the heart (`src/agents/conductor.js`, protected rules, self-service parameters inside bounds)
- **Purpose:** one hourly beat that decides how much risk the whole swarm takes and how it is shared.
- **Pulse inputs:** account (drawdown, week-to-date P&L), realised portfolio volatility, `regime.market`, per-sleeve
  edge health (below), the scoreboard.
- **Dial:** `dial = min(1, volTarget ÷ realisedVol60d) × ladderScale × weekScale`, floored at 0.25 while not halted.
  It can only scale down from the signed limits, never up.
- **Edge health per sleeve:** a one-sided CUSUM (Page, 1954) on daily R against the sleeve's expected daily R from its
  backtest: S_t = max(0, S_{t−1} + (μ_expected − r_t − k)); alarm when S_t > h (k = ½ expected σ_d, h = 5 σ_d). Alarm →
  sleeve share × 0.5 and a ticket for the evolution loop. Two alarms in 60 days → shadow.
- **Out:** `conductor.dial` {dial, sleeveShares, reasons}; the weekly pulse to Telegram (§10).
- **Cannot:** raise any limit; switch anything to live; act on one week's sign.
- **Done when:** replayed on 2020–2026 it never raises volatility above target and cuts the sleeve's worst month.

### 7.3 Promoter / retirer (`src/factory/promote_v2.js`, protected; runs automatically on paper)
- Rule v2 (§9). Writes `control.json` commands (`strategy-mode`, `sleeve-share`) that state-sync already forwards on
  paper/demo. Logs every decision with its numbers. Live stays Ibrahim's.

### 7.4 Positioning and sentiment
- **Positioning agent** (§6.5): code, uses data the feeds already receive plus Binance's public archive for history.
- **Sentiment (social/news):** no reliable free history, easy to overfit, and the fast part is gone before a home PC
  reacts. Record daily scores from now on (shadow-only feature); test after 6–12 months like any other idea. The event
  calendar already handles scheduled macro news.

### 7.5 Execution v2 (`exec/trader.js`, `exec/demo_trader.js`, protected)
- **Urgency classes:** rebalance legs and slow entries: post at best, re-post, market after 30 min (the trend bot's
  execution study: the only policy that beat market orders in both halves); medium (1–4h signals): 10 min then
  market; risk-reducing stops: exchange stop-market, always.
- **Implementation shortfall** per order (Perold, 1988): decision price → fill price, plus fees and funding, in bps and
  in R. New message `exec.cost`; per-coin cost model updated daily; the constructor's band and the cost gate use it.
- **Cost gate:** skip an idea when its expected move (strategy's median MFE at its horizon, from the event study) is
  less than 3× the round-trip cost.

### 7.6 Position guardian (part of the trader)
- Exchange-side disaster stop on every position (demo trader already does this; the sleeve uses 8 daily σ).
- Size is the main protection: the constructor shrinks positions as volatility rises.
- Signal exits: a sleeve's weight going to 0 closes the position at the next rebalance.
- Trailing and break-even only where tested (§13.4).
- Funding guard: if expected funding over the next 24 h exceeds the sleeve's expected edge for that coin, reduce.
- News windows: no new risk (exists). Weekends: no special rule until tested.

### 7.7 Sentinel, auditor, scoreboard
- **Sentinel** (§6.6) in the coordinator path (protected) plus a universe rule (protected).
- **Auditor** (slow agent, daily): for each sleeve, paper vs shadow vs backtest; a **placebo twin** for every idea —
  same coin, same side, same stop distance, entered at a random bar of the same day — so "the market moved" is
  measured and subtracted. Report to `swarm-reports/audit/`.
- **Scoreboard** (code, weekly): §10.

## 8. The evolution engine (how the swarm creates and tests its own strategies)

### 8.1 Generator
- Works from a **mechanism library**, not from indicator combinations: trend (Donchian, MA retest, breakout of N-day
  ranges, multi-lookback ensembles), cross-sectional momentum, carry/funding, forced-flow reversal (liquidations,
  OI flush), volatility breakout after compression, lead–lag (BTC → alts) at 1h+.
- Each candidate = mechanism × horizon (1h–1d) × universe filter × exit style, with parameters inside the plugin's
  `bounds`. Prefer **ensembles of lookbacks** over a single tuned value (the trend bot's lesson: moving every parameter
  ±30–40% barely changed the result).
- Budget: the scheduled researcher's 2 tries a day becomes a generator with a weekly try budget (e.g. 20), every try
  logged in `trials.jsonl`.

### 8.2 Screen (cheap, before any backtest)
- `src/research/event_study.js` on the 5-year data: edge ratio MFE ÷ |MAE| ≥ 1.2 and forward R positive in both
  halves, or stop (the rule in RESEARCH_LOG). Most ideas die here at almost no cost.

### 8.3 Validation (the 5-year sweep, automated)
- Run `swarm-history.yml` **on a weekly schedule** on the candidates that passed the screen (today it runs by hand).
- Pass only if: positive at 1.5× costs; positive in at least 2 of 3 thirds and in the newest; positive on the
  validation (dead-coin) set; positive in the 2018–2021 era test where data exists; neighbours (±30% parameters)
  positive too; **clustered** t (by day) above the multiple-testing bar; deflated Sharpe ratio (Bailey & López de Prado,
  2014) > 0 given the number of tries.
- This replaces the 6.5-month factory as the judge for 4h–1d strategies (G8). The factory stays as a quick check for
  1h.

### 8.4 Shadow and paper
- Shadow runs the exact version (parameter hash) that passed; the promotion rule (§9) decides.
- Paper capital starts small (10% of a normal sleeve share) and grows by the rule.

### 8.5 Data the engine still needs
- Ship the PC's recordings (liquidations, book, OI at 5 min) weekly to a GitHub release (`swarm-recordings-YYYY-WW`) so
  the liquidation and book-imbalance ideas can be tested (G10).
- Keep the 5-year Binance history updated monthly (the dataset workflow exists).

### 8.6 Retirement
- The live veto (§9 step 3) or two CUSUM alarms in 60 days (§7.2) → shadow; 6 months in shadow with a negative
  posterior → off, the file moved to `factory/rejected/` with the lesson written down.

## 9. Promotion rule v2 (replaces "48h ΣR ≥ +10" and "average R ±0.7")

**Why the old rules fail:** a few days of R measure which way the market went and how many trades happened to land
in the same hour, not whether a strategy has an edge. In the replay of §13.2, every rule that chose on recent days
lost money; "±0.7 on all trades so far" barely traded at all; and even the honest live-only rule (clustered t ≥ 2)
picked the right strategies too late and too rarely to matter. **Live records are too short to *select*. They are long enough to *veto*.** The information
that selects must come from years of history; the live record only confirms or stops it.

**The rule** ([tools/promotion_v2.js](tools/promotion_v2.js); read-only — it prints a table and can write a
`control.json` proposal):

1. **Long-history gate.** The strategy's 5-year sweep variant (point-in-time universe, dead coins included) must be
   positive at 1.5× costs and positive in at least 3 of the 4 full years 2022–2025. No sweep result → no capital,
   whatever the shadow says; the strategy goes to the sweep queue (§8.3). A factory backtest that is clearly negative
   (t ≤ −2 over ≥ 100 trades) makes it a retirement candidate.
2. **Minimum edge.** The sweep's average must be at least +0.03 R a trade; thinner edges die with any error in the
   cost model. *(Added after the replay, on the deep review's finding that `trend-pullback@60` is too thin to trade
   after costs; `--min-edge 0` gives the rule exactly as replayed.)*
3. **Live veto.** Shadow and paper trades are summed per UTC day (days without a trade count as 0). After ≥ 20 active
   days, a clustered t below −1 sends the strategy back to shadow. Before that, the live record neither promotes nor
   demotes.
4. **Size grows with evidence.** Posterior average R a trade = (100 × sweep average + n × live average) ÷ (100 + n).
   The allocator's quarter-Kelly uses the posterior instead of waiting for 100 paper trades (G7).
5. **Out-of-sample route** for a strategy with no sweep result: ≥ 150 live trades over ≥ 60 active days with a
   clustered t ≥ 2.5.
6. **Retirement:** two CUSUM alarms (§7.2) in 60 days → shadow; 6 months in shadow with a negative posterior → off.
7. **Never** for live money: that stays Ibrahim's decision on the demo record.

**Tested** (§13.2): 21 weeks out of sample (the gate used only sweep years 2021–2025; the replay ran on May–October
2026): **+124.6 R**, against −65 R for "±0.7 on the last 4 days" and −1,003 R for "48 h ΣR ≥ +10".

**Today** ([results/promotion_v2_2026-10-24.md](results/promotion_v2_2026-10-24.md)): trade `it-4h`,
`ma-retest-12h`, `ma-retest-4h`, `rsi-macd-trend-12h`; everything now in trade goes back to shadow. `ma-pullback-12h`
and `ma-retest-1d` stay in shadow (2 of 4 years positive). The donchian variants, candles, Wyckoff, pivots and
adaptive-score have no 5-year sweep result yet — queue them.

## 10. The weekly goal, done properly

**The math** (normal returns; fat tails make it worse): a week is positive with probability Φ(Sharpe ÷ √52).

| Annual Sharpe | Positive weeks | Positive months | Positive quarters |
|---|---|---|---|
| 0.5 | 53% | 56% | 60% |
| 1 | 56% | 61% | 69% |
| 2 | 61% | 72% | 84% |
| 3 | 66% | 81% | 93% |
| 5 | 76% | 93% | 99% |
| 12 | 95% | 100% | 100% |

**The best system in the repo, measured** (trend sleeve under `risk.json`, 2020–2026, [results/sleeve_weekly.md](results/sleeve_weekly.md)):

| Coins | Sharpe | Positive weeks | Positive months | Positive quarters | Worst week | Longest run without a gain |
|---|---|---|---|---|---|---|
| today's top 20 | 1.07 | 47% | 57% | 57% | −2.0% | 13 weeks |
| 30 unseen coins (dead ones included) | 0.78 | 49% | 49% | 61% | −2.2% | 15 weeks |

Fewer than half its weeks are positive, below what the Sharpe alone suggests, because trend following loses a little
most weeks and wins a lot in a few. The four strategies rule v2 trades today show the same shape on the last 6.5
months ([results/robust4_weekly.md](results/robust4_weekly.md)): **10 of 27 weeks positive, the median week a
loss, and one week made 63% of the whole period's R** (+102 of +161 R). A rule that switches strategies off after red
weeks would have switched off the only things that work, just before their big week.

**What to aim for instead**

| Goal | Target | How |
|---|---|---|
| Expected R every week | > 0 | only strategies whose evidence passes §9 trade |
| Worst week | ≥ −2.5% | `weekLossStopPct` (§6.4) |
| Rolling 13 weeks | > 0 most of the time | 3–5 sleeves that are not the same bet (trend, xs-momentum, carry, events); each extra uncorrelated sleeve raises the portfolio Sharpe |
| Weekly report | realised R vs the expected range | the scoreboard shows the week against its 5th–95th percentile range from the backtest; a week outside the range is an alarm for the auditor — the sign of the week is not |

The weekly Telegram pulse from the conductor: week's R and %, expected range, rolling 13-week R, drawdown, the dial,
per-sleeve CUSUM state, and what the evolution loop did (tries, promotions, retirements).

## 11. Evolving without permissions — the autonomy envelope

The swarm can already install new strategy plugins and shadow settings by itself (`src/tools/update_gate.js`). What
stops it from evolving is not permission; it is that its own evidence never promotes anything, so humans decide on
noise. Upswarm gives it a working pipeline and a fixed box to work in:

| The swarm does on its own (paper/demo) | Ibrahim decides (once, or when asked) | The swarm never |
|---|---|---|
| generate, screen, backtest, sweep candidates; log every try | `risk.json`, including the new weekly, cluster, ES and sanity limits (signed once) | switches anything to live |
| shadow new versions; promote to paper and demote by rule v2 | the code of rule v2, the conductor, the constructor, the sentinel (approved once) | touches keys, withdrawals, transfers |
| move capital between sleeves by rule v2 and CUSUM, inside the limits | the envelope itself — this table | edits `risk.json` or the gate that judges it |
| retire strategies, write lessons, open PRs for protected fixes | approving those PRs | deletes tries, trades or rejected candidates |
| pause on clear breakage (exists: `control.json`) | resuming after a halt, each time | resumes itself after a halt |

Why the walls make freedom safe: a strategy the swarm invents can at worst lose its small starting share inside
limits Ibrahim set. That is what professional quant teams do — researchers are free, risk limits are not theirs.

## 12. Roadmap

Each phase lists who acts and how we know it is done.

### Phase 0 — this week, no code (Ibrahim on Telegram / PC)
1. `/mode <name> shadow` for the 8 strategies in trade: intraday-trend, dip-reversal, wyckoff-spring-1h,
   candle-engulfing-1h, candle-engulfing-4h, candle-morning-star-4h, candle-harami-4h, candle-three-outside-1h.
2. Trade what rule v2 supports, at the start size (0.25% a trade): `/mode ma-retest-12h trade`,
   `/mode rsi-macd-trend-12h trade`, `/mode ma-retest-4h trade`, `/mode it-4h trade`. (These four also hold up in the
   deep review's three samples; `ma-pullback-12h` is positive there and in the 2018–2021 era test but only 2 of 4 sweep
   years — leave it in shadow; `ma-retest-1d` failed the era test.) Expect few trades: these fire a handful of times a
   week across 70+ coins, and most weeks will be small losses or small gains.
3. Approve PR #4 (trend sleeve, includes #2). It starts in shadow; after 2 weeks of shadow tracking its backtest,
   `/mode sleeve:trend trade`.
4. Stop using days-of-shadow rules (48 h ΣR, avg R ±0.7). Run `node upswarm/tools/promotion_v2.js` (or ask Claude to)
   to see what the evidence supports; it writes the `control.json` proposal for you to approve.
5. Let the agent manager retire the decisively negative strategies from shadow (the daily review listed 20).
- **Done when:** nothing in `trade` fails rule v2; the sleeve is in shadow.

### Phase 1 — measure honestly (1–2 weeks; mostly self-service code + one protected PR)
- Scoreboard and live audit as daily jobs (tools here) → `swarm-reports/scoreboard/`.
- Clustered t-stats (by day) in `factory/gate.js`, `review.js`, `/status` (protected PR).
- Sentinel idea/coin checks (protected PR).
- `exec.cost` implementation-shortfall logging (protected PR).
- Rule v2 as `promote_v2.js` replacing `promote.js` in the factory workflow (protected PR), dry-run for 2 weeks.
- 5-year sweep runs: (a) the exit grid of §13.4 for ma-retest, ma-pullback, rsi-macd-trend; (b) every configured
  strategy with no sweep result yet (the donchian variants, oi-flush, adaptive-score; candles, Wyckoff and pivots
  only to close their files).
- **Done when:** `/status` shows clustered t and the posterior; every order has a shortfall record; every strategy in
  shadow has a sweep result.

### Phase 2 — the portfolio core (2–4 weeks; protected, Ibrahim approves)
- Idea → exposure adapter; portfolio constructor; risk v2 limits (Ibrahim signs the new `risk.json`); conductor v1
  (vol dial, ladders, week cap, CUSUM).
- Shadow first: the constructor's book runs in shadow next to the current coordinator for 2 weeks.
- **Done when:** constructor + trend sleeve alone reproduce the sleeve backtest; fuzz tests keep every limit; 2 weeks
  of shadow match the simulator within costs.

### Phase 3 — evolution on its own (2–4 weeks)
- Weekly scheduled sweep for screened candidates; generator with a weekly try budget; promoter and retirer v2 live on
  paper; auditor with placebo twins; recordings shipped weekly.
- **Done when:** a candidate goes generator → screen → sweep → shadow → paper with no human step, and a failing
  sleeve is cut by CUSUM with no human step.

### Phase 4 — new edges (ongoing, through the engine)
1. Cross-sectional momentum sleeve (market-neutral, beta-hedged), weekly rebalance.
2. Carry sleeve: be short the coins where longs keep paying high funding (you receive it), but only when the price is
   below its 200-day average and open interest is falling — the crash filter that the plain funding-fade lacked in
   the 2021 bull run (ideas queue item 5), run as a portfolio.
3. Forced-flow reversal at 1h–4h using liquidation intensity (needs recordings).
4. Fear & Greed and breadth as conductor inputs — tested in the sweep before use.

### Phase 5 — demo, then small live
- Install the demo key (`enable-demo.ps1`): read + trade only.
- Live gate per sleeve: ≥ 90 days of demo with tracking error vs its simulation inside 2× backtest costs, demo
  drawdown within 1.5× backtest, the rule-v2 posterior positive. Then live at `liveFirstMonthCapPct` (0.5%).
- A second machine or a small VPS as standby only for state and alerts; exchange-side stops carry position risk.

## 13. Experiments run for this guide

All on the live code path with BloFin costs. Reproduce with the commands in [README.md](README.md).

### 13.1 Live audit of the PC (state 2026-10-24 02:43 UTC) — [results/live_audit.md](results/live_audit.md)

- Paper: 55 closed trades, +$441 / +16.4 R; IRYS long +$693 / +24.6 R; **without it −$252 / −8.2 R**. Longs
  without IRYS −28.9 R, shorts +20.7 R. Since the last restart 26 of 33 exits were stops.
- Shadow, 1,893 trades in 4 days: longs −0.59 R a trade, shorts +0.34 R.
- The ±0.7 rule would put 9 strategies in trade. 8 have negative backtests (−0.08 to −0.29 R a trade); the ninth
  (`candle-doji-star-4h`) has 36 backtest trades. Their shadow evidence: 2–48 trades in 1–26 independent hours, 69 of
  89 trades shorts. It would switch off `it-4h` (positive in the deep review) on 9 trades in 3 hours.

### 13.2 Which selection rule makes money? — [results/selection_sim.md](results/selection_sim.md)

All 64 configured strategies were backtested on their own over 6.5 months × 31 coins (the factory's data, live code
path; [results/config_backtest.md](results/config_backtest.md)). Their trades stand in for shadow records. Every
Monday from 2026-05-25 each rule saw only trades closed before that moment and chose which strategies trade that
week; the week's result is the R of the trades those strategies entered (equal risk per trade). 21 weeks.

| Rule | Weeks positive | Total R | Worst week | Avg R a trade | Strategies trading (avg) | Quality of what it picked* |
|---|---|---|---|---|---|---|
| "48 h ΣR ≥ +10" (used on 2026-10-23) | 1 of 16 | **−1,003** | −164 | −0.166 | 2.7 | −0.073 R |
| "trade what worked last month" (30-day avg R > 0) | 6 of 21 | −746 | −160 | −0.085 | 18.9 | +0.094 R |
| "avg R ±0.7" on the last 4 days | 6 of 13 | **−65** | −80 | −0.072 | 2.1 | +0.159 R |
| "avg R ±0.7" on all trades so far | 5 of 8 | +13.5 | −3 | +0.398 | 0.5 | +0.289 R |
| clustered t ≥ 2, live record only | 0 of 3 | −35 | −14 | −0.685 | 0.6 | +0.353 R |
| **rule v2: 5-year prior + live veto** | 10 of 21 | **+124.6** | −30 | +0.091 | 4.8 | +0.194 R |
| everything trades | 0 of 21 | −17,606 | −1,226 | −0.181 | 64 | −0.047 R |
| reference: the robust slow set named in advance† | 13 of 21 | +161 | −31 | +0.183 | 5 | +0.259 R |

\* The whole-period average R a trade of the strategies the rule had trading, weighted by weeks — did it pick good
strategies, whatever the luck of its weeks. † Chosen on 2020–2026 data that includes this window: a reference, not
a clean test.

What it shows:

- **Short-window rules pick losers.** "48 h ΣR ≥ +10" chose candle-tweezer-1h, candle-engulfing-1h, rsi-macd,
  pivot-matrix-1h, candle-three-outside-1h… — the noisiest, most frequent strategies, because only they can rack up
  +10 R in two days by luck.
- **"±0.7 on all trades" looks fine but barely trades** (34 trades in 21 weeks): it switches strategies off for good
  after a bad start, so it ends up holding almost nothing.
- **The live record alone picks the right strategies, too late.** "Clustered t ≥ 2" only ever chose ma-retest-12h,
  donchian-12h-60, rsi-macd-trend-12h and ma-pullback-12h — the good ones — but it needed months to trust them and
  then held them for 3 unlucky weeks.
- **Rule v2 traded from day one** with the strategies the 5-year history supports (ma-retest-12h, it-4h,
  rsi-macd-trend-12h, ma-retest-4h; trend-pullback-1h until the veto), and made +124.6 R out of sample. It still had
  only 10 positive weeks of 21 — §10 explains why that is normal.
- Caveat: each strategy traded on its own here (no fusion, no shared limits), on 31 coins chosen by today's volume.

### 13.3 Entry execution for the slow strategies — [results/exec_policies.md](results/exec_policies.md)

Same ideas, four ways to enter (6.5 months × 31 coins, 2026-04-22 → 2026-10-21):

| Strategy | As configured: trades / avg R / cost bps | Chase 30 min then market | Market order | Ideas missed by a 3-min cancel |
|---|---|---|---|---|
| ma-retest-4h (chase 3 min, cancel) | 308 / +0.023 / 10.2 | same | 308 / +0.009 / 15.7 | 0 |
| ma-retest-12h (chase 3 min, cancel) | 54 / +0.557 / 17.3 | 54 / +0.556 | 54 / +0.552 / 23.1 | 1 |
| ma-pullback-12h (chase 3 min, cancel) | 160 / +0.137 / 18.3 | 160 / +0.137 | 160 / +0.131 / 23.9 | 1 |
| rsi-macd-trend-12h (chase 3 min, cancel) | 262 / +0.289 / 11.6 | 263 / +0.297 | 264 / +0.300 / 17.2 | 3 |
| it-4h (chase 5 min, cancel) | 579 / +0.083 / 10.9 | same | 581 / +0.077 / 16.4 | 2 |
| donchian-12h-60 (chase 30 min, then market) | 207 / +0.289 / 17.5 | same | 207 / +0.288 / 23.0 | 1 |

Execution is not where these strategies win or lose: maker chase saves ~5.5 bps a trade (+0.004 to +0.014 R), the
3-minute cancel almost never misses in the simulator. Two cautions: the simulator fills a maker order whenever price
trades 0.5 bp through it, which ignores the queue, so live fill rates must be measured (`exec.cost`, §7.5); and for
12h–1d signals, the chase-30-then-market policy costs nothing extra and removes the risk of missing a trade that runs
immediately. **Use chase 30 → market for every 4h–1d entry.**

### 13.4 Exits for the slow strategies — [results/exit_policies.md](results/exit_policies.md)

Same entries, four exits (stop distance unchanged, so R is comparable): as configured; **no target** (exit only at
the stop or the time stop); **chandelier** (no target, trail 3 ATR behind the best close once +1 R); **1R trail**
(trail at the initial risk from the start).

| Strategy | As configured: trades / sum R | No target | Chandelier 3 ATR | 1R trail | No target: R from its 5 best trades / without them |
|---|---|---|---|---|---|
| ma-retest-4h (target 2R) | 308 / +7 | 254 / **+157** | 307 / −2 | 390 / −9 | +180 / **−23** |
| ma-retest-12h (target 2R) | 54 / +30 | 44 / **+58** | 54 / +29 | 71 / +20 | +44 / +14 |
| ma-pullback-12h (target 2R) | 160 / +22 | 127 / **+49** | 163 / +34 | 223 / +25 | +51 / −1 |
| rsi-macd-trend-12h (target 2R) | 262 / +76 | 244 / **+176** | 256 / +137 | 315 / +57 | +108 / +69 |
| it-4h (3 ATR trail after +1R) | 579 / +48 | same | same | 605 / +33 | — |
| donchian-12h-60 (half-channel trail) | 207 / +60 | same | 137 / +68 | 174 / +56 | — |
| donchian-1d-20 (half-channel trail) | 440 / +26 | same | 209 / +67 | 342 / +58 | — |

What it says, and what it does not:

- **Taking profit at 2R cut the winners of every MA/RSI trend strategy** in this window: without the target their R
  doubled or more. That fits theory — trend following earns from a few long runs, and a fixed target sells exactly
  those.
- **But the gain is concentrated.** For ma-retest-4h, the 5 best trades made +180 R; without them, the no-target
  version lost 23 R. Almost all of the extra came from longs (+167 R) in a window where the coins rose. The 1R trail and
  the chandelier were no better than the target for the MA strategies.
- **The 5-year sweep disagrees so far:** its one trailing variant (`ma-pullback-ride`) was no better than the 2R
  target over 2021–2026 (deep review).
- **Verdict: the most valuable next test, not a change to make now.** Put the four exit styles for these families
  into the 5-year sweep (dead coins, both sides, per year). If "no target" holds there, change the exits; it is a
  self-service change (plugin parameters `rr: 0`).

Break-even moves were tested before (expansion/RESULTS_2026-10-23.md): break-even at +1 R cost the robust five 10% of
their R, so it is off (`trading.breakevenR: 0`).

### 13.5 Weekly scoreboard of the trend sleeve — [results/sleeve_weekly.md](results/sleeve_weekly.md)

§10.

### 13.6 Questions this raises (the research queue, in order)

1. Does "no target" for the MA/RSI trend entries hold on the 5-year sweep with dead coins, both sides, every year
   (§13.4)? Biggest possible gain for the least work.
2. How correlated are the trend sleeve and the four rule-v2 strategies day by day? If they are one bet, the
   constructor must size them as one.
3. How much of the slow edge is shorting altcoins after their volume peak (the sweep's shorts carry most of it) — and
   can BloFin short those coins in practice when funding is extreme?
4. Does the paper/demo maker fill rate match the simulator's ~99%? (`exec.cost`, §7.5)
5. Do market regime inputs (BTC trend, volatility percentile, breadth) tell *when* the slow set earns? Test as a
   conductor dial, never as an on/off switch.
6. Backtests use Binance prices, the swarm trades BloFin: what does the venue gap cost on 4h–1d trades? (auditor)
7. Do liquidation bursts give a direction at 1h–4h? (event study, once recordings ship weekly)
8. Calibrate the CUSUM on 2020–2026: how long does it take to flag a dead edge, and how often does it fire on a
   healthy one?

## 14. What not to do

- Promote, demote or size anything on days of results, on a week's sign, or on per-trade t-stats.
- Search parameters on families with no direction (candles, harmonics, Wyckoff, pivots, RSI/MACD reversal) — the
  best of many settings is luck.
- Go below 1h for directional trading; trade more often per coin to "be active". Be active with breadth instead.
- Add martingale, averaging down outside a tested rule, or anything that raises size after losses.
- Let any agent edit `risk.json`, keys, the update gate or the promotion rule that judges it.
- Treat a social-media sentiment score as a signal before it has years of out-of-sample history.

## 15. Glossary

**R** — profit or loss in units of the amount risked (stop distance × size). **Sharpe** — average return ÷ its
volatility, per year. **Shadow** — the strategy's ideas are simulated, no orders. **Paper** — orders on a simulated
account. **Demo** — real orders on BloFin's demo account. **Sleeve** — a signal source that outputs target weights.
**CUSUM** — a running sum that alarms when results drift below expectation for long enough. **Clustered t-stat** — a
t-stat that counts trades that move together (same hour/day) as one. **Implementation shortfall** — the cost of
turning a decision into a fill. **Volatility targeting** — sizing so the expected swing of the book stays constant.

### Sources
Liu & Tsyvinski (2021), *Risks and Returns of Cryptocurrency*, Review of Financial Studies · Liu, Tsyvinski & Wu
(2022), *Common Risk Factors in Cryptocurrency*, Journal of Finance · Schmeling, Schrimpf & Todorov (2023), *Crypto
Carry*, BIS Working Paper 1087 · Moreira & Muir (2017), *Volatility-Managed Portfolios*, Journal of Finance ·
DeMiguel, Garlappi & Uppal (2009), *Optimal Versus Naive Diversification*, Review of Financial Studies · Bailey &
López de Prado (2014), *The Deflated Sharpe Ratio*, Journal of Portfolio Management · Page (1954), *Continuous
Inspection Schemes*, Biometrika · Perold (1988), *The Implementation Shortfall*, Journal of Portfolio Management.
Repo sources: docs/DEEP_REVIEW_2026-10-23.md, docs/RESEARCH_LOG.md, docs/TREND_BOT_RESEARCH_2026-10-18.md,
docs/HIGH_FREQUENCY_RESEARCH_2026-10-18.md, swarm-reports history/2026-10-20/REPORT.md, PR #2/#4 (trend sleeve), PR #3
(live review).
