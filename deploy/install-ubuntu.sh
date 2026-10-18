#!/usr/bin/env bash
# One-command installer for the 24/7 bot PC (Ubuntu Server 24.04 LTS).
#
#   curl -fsSL https://raw.githubusercontent.com/iamuna/blofinbot/main/deploy/install-ubuntu.sh | sudo bash
#
# What it does:
#   - installs Node.js 22, git and time sync (accurate clocks matter for 1-minute candles)
#   - creates a locked-down service user `blofinbot` and checks the repo out to /opt/blofinbot
#   - asks once for a GitHub token (fine-grained, "Contents: read and write" on iamuna/blofinbot only)
#     so the bot can publish its state for the dashboard and supervisor
#   - installs two systemd units: the bot (restarts on failure, starts on boot) and an updater that
#     pulls new code from main every 15 minutes and restarts the bot when it changed
# PAPER mode only. No exchange API keys are asked for or stored by this script.
set -euo pipefail

REPO="https://github.com/iamuna/blofinbot.git"
APP=/opt/blofinbot
STATE=/var/lib/blofinbot
ENVF=/etc/blofinbot/env

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
. /etc/os-release
echo "Installing blofinbot on $PRETTY_NAME"

apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg chrony unattended-upgrades >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
systemctl enable --now chrony >/dev/null 2>&1 || true

id blofinbot >/dev/null 2>&1 || useradd --system --create-home --home-dir "$STATE" --shell /usr/sbin/nologin blofinbot
mkdir -p "$STATE" /etc/blofinbot
if [ ! -d "$APP/.git" ]; then git clone -q "$REPO" "$APP"; else git -C "$APP" pull -q --ff-only; fi
chown -R blofinbot:blofinbot "$APP" "$STATE"

if [ ! -f "$ENVF" ]; then
  echo
  echo "Create a fine-grained GitHub token at https://github.com/settings/personal-access-tokens/new"
  echo "  Repository access: Only select repositories → iamuna/blofinbot"
  echo "  Permissions: Contents → Read and write. Nothing else."
  read -r -s -p "Paste the token (input hidden, Enter to skip publishing): " TOKEN < /dev/tty || TOKEN=""
  echo
  umask 077
  {
    echo "GITHUB_TOKEN=${TOKEN}"
    echo "BOT_MODE=paper"
    echo "STATE_BRANCH=paper-state-home"
  } > "$ENVF"
  chown root:blofinbot "$ENVF"; chmod 640 "$ENVF"
fi

cat > /etc/systemd/system/blofinbot.service <<'UNIT'
[Unit]
Description=blofinbot paper trading bot (checks every minute)
After=network-online.target time-sync.target
Wants=network-online.target

[Service]
User=blofinbot
EnvironmentFile=/etc/blofinbot/env
WorkingDirectory=/opt/blofinbot
ExecStart=/usr/bin/env bash deploy/run-bot.sh
Restart=always
RestartSec=20
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/blofinbot /opt/blofinbot
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/blofinbot-update.service <<'UNIT'
[Unit]
Description=Pull new blofinbot code and restart the bot if it changed

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash -c 'cd /opt/blofinbot && before=$(git rev-parse HEAD) && sudo -u blofinbot git pull -q --ff-only && [ "$before" = "$(git rev-parse HEAD)" ] || systemctl restart blofinbot'
UNIT

cat > /etc/systemd/system/blofinbot-update.timer <<'UNIT'
[Unit]
Description=Check for new blofinbot code every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now blofinbot.service blofinbot-update.timer
sleep 3
systemctl --no-pager --lines=5 status blofinbot.service || true
echo
echo "Installed. Logs: journalctl -u blofinbot -f"
echo "Stop: sudo systemctl stop blofinbot · Disable: sudo systemctl disable --now blofinbot blofinbot-update.timer"
