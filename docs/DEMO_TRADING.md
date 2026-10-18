# BloFin demo trading (step 2 of paper → demo → small live)

Status: **built and tested offline, switched off.** It is turned on only by you, on your own PC, after the paper bot has enough history to judge (see "When to switch it on").

## What it is

The same bot (`lab/mtfbot.js`, same engine, same targets, same risk governor) with one difference: instead of simulating fills, it drives a **BloFin demo account** (demo money) through BloFin's real order API. That tests what paper cannot: real queue position and fills for post-only orders, partial fills, rejections, exchange fees and funding, latency, and restarts.

| | Paper | Demo |
|---|---|---|
| Strategy, targets, risk governor | same | same |
| Orders | simulated (fill if the price trades 0.5 bps through) | real post-only orders on BloFin's demo exchange |
| Equity | simulated cash + marks | the demo account's `totalEquity` |
| Fees, funding | modelled | charged by BloFin |
| Runs on | GitHub Actions (+ optionally your PC) | **only your PC** (refuses to start on GitHub Actions) |
| State branch | `mtf-state` / `paper-state-home` | `demo-state-home` |
| API keys | none | demo key in `/etc/blofinbot/blofin-demo.env` on your PC only |

LIVE (real money) is **not possible with this build**: the client accepts only the demo host. Enabling live is a separate, deliberate code change for later, after demo results.

## How orders work (lab/broker/demo.js)

Every minute the broker reads the account (positions, open orders, balance, best bid/ask) and works toward each coin's **goal** — the target position the strategy set at the hour close:

1. Post a **post-only** order at the best bid (buy) or ask (sell) for the missing amount (reduce-only when it only shrinks a position).
2. If the market moves away from the order, cancel and re-post at the new best price; the replacement is exactly what is still missing, partial fills included.
3. After 30 minutes, a market order for the rest (the same rule the paper bot and the backtest use).
4. Goal reached (within one lot of the target) → done.

Safety rules (AGENTS.md, docs/BLOFIN_EXECUTION_SPEC.md):

- **Intent before send.** Every order is written to `broker-journal.jsonl` and `broker.json` (fsync'd) before it goes to BloFin, with a unique `clientOrderId` (`mtf…`).
- **No blind retry.** If BloFin's answer is lost (timeout, connection drop, HTTP 5xx), the order is `SUBMIT_UNKNOWN`. That coin places nothing new until the order is found by its `clientOrderId` (order detail → open orders → history) or proven absent after 2 minutes. Clear rejections (bad size, post-only would cross) are retried next minute with a new id; three in a row pause that coin for 15 minutes.
- **Restart-safe.** A process that died mid-send restarts with that order as `SUBMIT_UNKNOWN` and reconciles. Bot orders on the exchange that the state does not know are cancelled at start; manual orders are left alone (but use a dedicated demo account — positions are netted).
- **Exposure reserved.** Resting and unresolved orders count toward the gross-exposure cap (3.2× equity) and the per-coin cap (60% of equity), on top of the strategy's own limits.
- **Account setup only when flat.** One-way (net) mode and cross margin are set only if the account has no positions or orders; otherwise the broker stays disarmed and says why.
- **Key check.** The broker refuses a key that is read-only or has TRANSFER/withdraw permission. The client has no transfer or withdrawal calls at all.
- **Secrets** live only in the environment of the service on your PC; they are never written to state, journal, logs or git (tested).

Offline tests (fake BloFin exchange that verifies signatures and injects failures):

    node --test lab/broker/test/*.test.js
    node lab/mtfbot.js run --state-dir /tmp/demo-sim --seed-dir <research-data checkout> --sim --broker demo --fake-exchange --minutes 3000

## When to switch it on

When the paper bot has run for at least a few weeks without malfunctions and its results sit inside the backtest's range (see PROGRESS.md). The supervisor will say when that point is reached; it never switches demo on itself.

## How to switch it on (your PC, after `deploy/install-ubuntu.sh`)

1. In BloFin: switch to **Demo Trading** → API Management → Create API key. Permissions **READ + TRADE only**. Bind it to your PC's public IP if you can (keys without an IP expire after 90 days).
2. On the PC:

       sudo bash /opt/blofinbot/deploy/enable-demo.sh

   It asks for the key, secret and passphrase (hidden), stores them in `/etc/blofinbot/blofin-demo.env` (readable only by root and the bot user) and starts the `blofinbot-demo` service next to the paper bot.
3. Watch: `journalctl -u blofinbot-demo -f`, or the `demo-state-home` branch (`summary.md`).

Stop and delete the key from the PC:

    sudo bash /opt/blofinbot/deploy/enable-demo.sh --off

Open demo positions stay on BloFin until you close them there (or send `flatten` through `control.json` first).

## Supervisor controls (same as paper)

`control.json` on `demo-state-home`: `pause`, `riskScale` (0…1), `flatten` (goal 0 for every coin, then pause), `resetPeak`, `note`. Same rules as docs/SUPERVISOR.md: intervene only for malfunctions or the risk governor going flat.

## API facts used (checked 2026-10-18)

From BloFin's own `blofin-mcp` and `blofin-sdk-python` repositories and docs.blofin.com:

- Demo REST host `https://demo-trading-openapi.blofin.com`; production `https://openapi.blofin.com`.
- Signature: `base64(hex(HMAC-SHA256(secret, path+query + METHOD + timestamp + nonce + body)))`; headers `ACCESS-KEY`, `ACCESS-SIGN`, `ACCESS-TIMESTAMP`, `ACCESS-NONCE`, `ACCESS-PASSPHRASE`.
- `POST /api/v1/trade/order`: `instId, marginMode, positionSide (net in one-way mode), side, orderType (market|limit|post_only|fok|ioc), price, size (contracts), reduceOnly, clientOrderId (≤ 32 alphanumerics)`. Answer `data[0] = {orderId, clientOrderId, code, msg}`.
- `POST /api/v1/trade/cancel-order {instId, orderId}`; `GET /api/v1/trade/orders-pending` (max 100); `GET /api/v1/trade/order-detail?instId&orderId|clientOrderId`; `GET /api/v1/trade/orders-history`. Order states `live, partially_filled, filled, canceled, partially_canceled`; fields `filledSize, averagePrice, fee`.
- `GET /api/v1/account/positions`: in net mode `positions` is signed (negative = short). `GET /api/v1/account/balance` → `totalEquity`.
- `POST /api/v1/account/set-position-mode {positionMode: net_mode|long_short_mode}`, `set-margin-mode`, `set-leverage {instId, leverage, marginMode, positionSide}`. Size = contracts × `contractValue`; obey `lotSize`, `minSize`, `tickSize`, `maxLimitSize`, `maxMarketSize`.
- Limits: 500 requests/min per IP; trading 30 requests/10 s per user (the client paces itself below both).
