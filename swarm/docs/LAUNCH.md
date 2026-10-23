# Launch on the home PC

Two ways: **on your Windows PC** (no Ubuntu; simplest) or on a small 24/7 Ubuntu Server PC (most robust). Nothing
here moves money: the swarm starts on a **paper** account, and every strategy starts in **shadow** (it tracks what
it would have done). About 15 minutes of your time.

## Windows (no Ubuntu)

1. Make the GitHub token and the Telegram bot (section 1 below); send your bot a message first.
2. Right-click Start → **Terminal (Admin)** and paste:

       irm https://raw.githubusercontent.com/iamuna/blofinbot/main/swarm/deploy/windows/install.ps1 | iex

   It installs Node.js and Git if needed, asks for the two tokens (typing is hidden), sets the PC not to sleep while
   plugged in, and starts the swarm hidden. It starts again by itself every time you log in.
3. Send /status to your Telegram bot.

| What | How |
|---|---|
| Logs | `C:\swarm\logs` |
| Updates that need your OK | Telegram tells you; run `powershell -ExecutionPolicy Bypass -File C:\swarm\app\swarm\deploy\windows\approve.ps1` |
| Demo account (later) | `powershell -ExecutionPolicy Bypass -File C:\swarm\app\swarm\deploy\windows\enable-demo.ps1` (`-Off` to go back) |
| Stop and remove from startup | `powershell -ExecutionPolicy Bypass -File C:\swarm\app\swarm\deploy\windows\uninstall.ps1` |

Differences from the Ubuntu install: everything runs in one program under your Windows account, so agent-written
strategy code is kept in line by the plugin check and the update gate, not by a separate user. That is fine for
paper and demo; before real money, move to the Ubuntu install (or ask Claude to harden the Windows one). The PC must
stay on; after a Windows Update restart, log in once.

## Ubuntu Server

Steps 1–3 below. Step 1 is also how to make the two tokens for the Windows install.

## 1. Before you start (on your phone or laptop)

- **GitHub token** (lets the swarm publish its status for the dashboard and the daily review): github.com → Settings
  → Developer settings → Fine-grained tokens → Generate. Repository access: only `iamuna/blofinbot`. Permissions:
  Contents → Read and write. Expiry: 1 year. Copy it.
- **Telegram bot** (alerts, the daily summary, and your commands /status /pause /resume /flatten /mode): open
  @BotFather in Telegram → /newbot → copy the token. Then send your new bot any message ("hi").

## 2. Install (on the Ubuntu PC)

    curl -fsSL https://raw.githubusercontent.com/iamuna/blofinbot/main/swarm/deploy/install.sh | sudo bash

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
