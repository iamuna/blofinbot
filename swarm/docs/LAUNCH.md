# Launch on the home PC

Everything runs on one small 24/7 PC with Ubuntu Server 24.04 LTS (4 GB RAM is plenty). Nothing here moves
money: the swarm starts on a **paper** account, and every strategy starts in **shadow** (it tracks what it would
have done). About 20 minutes of your time.

## 1. Before you start (on your phone or laptop)

- **GitHub token** (lets the swarm publish its status for the dashboard and the daily review): github.com → Settings
  → Developer settings → Fine-grained tokens → Generate. Repository access: only `iamuna/blofinbot`. Permissions:
  Contents → Read and write. Expiry: 1 year. Copy it.
- **Telegram bot** (alerts, the daily summary, and your commands /status /pause /resume /flatten /mode): open
  @BotFather in Telegram → /newbot → copy the token. Then send your new bot any message ("hi").

## 2. Install (on the Ubuntu PC)

    curl -fsSL https://raw.githubusercontent.com/iamuna/blofinbot/swarm/swarm/deploy/install.sh | sudo bash

It asks for the two tokens (Enter skips one). When it finishes you should see five services "active (running)":
market, brain, decision, trader, ops. Within a few minutes Telegram says hello and /status answers.

Useful afterwards:

| What | Command |
|---|---|
| Live logs | `journalctl -u 'swarm@*' -f` |
| Stop everything | `sudo systemctl stop 'swarm@*'` |
| Updates that need your OK | Telegram tells you; then `sudo swarm-approve` shows the change and asks yes/no |
| Change risk limits | the change goes into git (ask Claude), then `sudo swarm-approve` shows it, installs it and asks you to sign it |

## 3. Later: the BloFin demo account (when you want real orders with fake money)

In BloFin, switch to **Demo trading**, create an API key with **Read + Trade only** (never Transfer or Withdraw),
then on the PC:

    sudo bash /opt/swarm/swarm/deploy/enable-demo.sh          # asks for the key; --off switches back to paper

Strategies only send orders when they are in `trade` mode: the promotion gate does that on paper/demo when a
strategy has earned it, or you can with `/mode <strategy> trade` on Telegram.

## What runs where

| Who | Where | When |
|---|---|---|
| Fast agents (data, strategies, risk, orders) | this PC | every second / minute |
| Updater (tests, installs, rolls back) | this PC | every 10 minutes |
| Researcher + strategy builder (Claude) | cloud, scheduled | daily |
| Daily review, agent manager, central plan (Claude) | cloud, scheduled | daily, morning report |
| Factory backtests | GitHub Actions | on every new strategy |

Real money is not possible until a strategy passes the live gate on the demo record and you switch it on yourself
(live key, `liveEnabled` in the signed risk limits, `/mode`).
