#!/usr/bin/env bash
# Switch ON BloFin DEMO trading on the 24/7 PC (run it yourself, after the paper results justify it):
#
#   sudo bash /opt/blofinbot/deploy/enable-demo.sh          # asks for the demo API key, starts blofinbot-demo
#   sudo bash /opt/blofinbot/deploy/enable-demo.sh --off    # stops it and deletes the stored key
#
# Demo trading uses BloFin's demo money only. The key is stored in /etc/blofinbot/blofin-demo.env
# (root:blofinbot, mode 640) on this machine and nowhere else — never in git, never on GitHub.
# The paper bot keeps running next to it; the demo bot keeps its state on branch demo-state-home.
set -euo pipefail
ENVD=/etc/blofinbot/blofin-demo.env
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
[ -d /opt/blofinbot/.git ] || { echo "Install the bot first: deploy/install-ubuntu.sh" >&2; exit 1; }

if [ "${1:-}" = "--off" ]; then
  systemctl disable --now blofinbot-demo.service 2>/dev/null || true
  rm -f /etc/systemd/system/blofinbot-demo.service
  sed -i 's/ blofinbot-demo//' /etc/systemd/system/blofinbot-update.service 2>/dev/null || true
  systemctl daemon-reload
  [ -f "$ENVD" ] && shred -u "$ENVD" 2>/dev/null || rm -f "$ENVD"
  echo "Demo trading stopped and the demo key deleted from this PC. Open demo positions stay on BloFin until you close them there."
  exit 0
fi

cat <<'TXT'

BloFin DEMO API key — create it in the BloFin app or website:
  1. Switch to Demo Trading, open API Management, Create API Key.
  2. Permissions: READ and TRADE only. Do NOT tick TRANSFER (the bot refuses keys that can move money).
  3. IP whitelist: this PC's public IP if you can (keys without an IP expire after 90 days).
  4. Use a demo account with no manual positions or orders: the bot nets everything on it.

TXT
read -r -p "Demo API key: " K < /dev/tty
read -r -s -p "Demo secret (hidden): " SEC < /dev/tty; echo
read -r -s -p "Passphrase (hidden): " PP < /dev/tty; echo
[ -n "$K" ] && [ -n "$SEC" ] && [ -n "$PP" ] || { echo "All three are needed." >&2; exit 1; }
case "$K$SEC$PP" in *"'"*) echo "A value contains a single quote ('), which the service file cannot hold. Choose another passphrase." >&2; exit 1;; esac
umask 077
{ echo "BLOFIN_MODE=demo"; echo "BLOFIN_API_KEY='$K'"; echo "BLOFIN_API_SECRET='$SEC'"; echo "BLOFIN_PASSPHRASE='$PP'"; } > "$ENVD"
chown root:blofinbot "$ENVD"; chmod 640 "$ENVD"
unset K SEC PP

cat > /etc/systemd/system/blofinbot-demo.service <<'UNIT'
[Unit]
Description=blofinbot on the BloFin DEMO account (same strategy as the paper bot, demo money)
After=network-online.target time-sync.target blofinbot.service
Wants=network-online.target

[Service]
User=blofinbot
EnvironmentFile=/etc/blofinbot/env
EnvironmentFile=/etc/blofinbot/blofin-demo.env
Environment=STATE_DIR=/var/lib/blofinbot/demo-state
Environment=STATE_BRANCH=demo-state-home
WorkingDirectory=/opt/blofinbot
ExecStart=/usr/bin/env bash deploy/run-bot.sh
Restart=always
RestartSec=60
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/blofinbot /opt/blofinbot
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
# the code updater restarts the demo bot too when main changes
if ! grep -q blofinbot-demo /etc/systemd/system/blofinbot-update.service; then
  sed -i 's/|| systemctl restart blofinbot'"'"'/|| systemctl restart blofinbot blofinbot-demo'"'"'/' /etc/systemd/system/blofinbot-update.service
fi
systemctl daemon-reload
systemctl enable --now blofinbot-demo.service
sleep 5
systemctl --no-pager --lines=8 status blofinbot-demo.service || true
echo
echo "Demo bot started. Logs: journalctl -u blofinbot-demo -f   ·   Stop and delete the key: sudo bash $0 --off"
