#!/usr/bin/env bash
# One-command installer for the swarm on the 24/7 PC (Ubuntu Server 24.04 LTS).
#
#   curl -fsSL https://raw.githubusercontent.com/iamuna/blofinbot/swarm/swarm/deploy/install.sh | sudo bash
#
# Installs Node 22, Redis (the message bus), git and time sync; creates the service user `swarm`; checks the code out
# read-only to /opt/swarm (agents cannot edit their own code — changes come through git and tests); asks once for
# the optional secrets (GitHub token for the dashboard/supervisor, Telegram bot for alerts); signs the risk limits;
# starts one systemd service per agent group and an updater that tests new code before it restarts anything.
# PAPER account by default. Demo: deploy/enable-demo.sh afterwards. No withdrawal-capable key is ever accepted.
set -euo pipefail

REPO="https://github.com/iamuna/blofinbot.git"; BRANCH="${SWARM_BRANCH:-swarm}"
APP=/opt/swarm; DATA=/var/lib/swarm; ETC=/etc/swarm
GROUPS="market brain decision trader ops"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
. /etc/os-release; echo "Installing the swarm on $PRETTY_NAME"

apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg chrony redis-server >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
systemctl enable --now chrony >/dev/null 2>&1 || true

# Redis: local only, durable (append-only file), never evicts the bus
cat > /etc/redis/redis.conf.d-swarm <<'RC'
bind 127.0.0.1 ::1
protected-mode yes
appendonly yes
appendfsync everysec
maxmemory 1536mb
maxmemory-policy noeviction
RC
grep -q 'include /etc/redis/redis.conf.d-swarm' /etc/redis/redis.conf || echo 'include /etc/redis/redis.conf.d-swarm' >> /etc/redis/redis.conf
systemctl enable --now redis-server >/dev/null; systemctl restart redis-server

id swarm >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin swarm
mkdir -p "$DATA" "$ETC"; chown swarm:swarm "$DATA"; chmod 750 "$DATA"
if [ ! -d "$APP/.git" ]; then git clone -q --branch "$BRANCH" "$REPO" "$APP"; else git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" checkout -q "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"; fi
chown -R root:root "$APP"; chmod -R go-w "$APP"   # read-only for the swarm user

cat > "$ETC/env" <<ENV
SWARM_DATA_DIR=$DATA
SWARM_CONFIG=$APP/swarm/config/swarm.json
SWARM_LOCAL_CONFIG=$ETC/swarm.local.json
SWARM_BUS=redis
ENV
[ -f "$ETC/swarm.local.json" ] || echo '{ "trading": { "account": "paper" } }' > "$ETC/swarm.local.json"

if [ ! -f "$ETC/secrets.env" ]; then
  echo
  echo "Optional secrets (Enter skips each):"
  echo " 1) GitHub fine-grained token — repository iamuna/blofinbot only, Contents: Read and write."
  echo "    Lets the swarm publish its state (dashboard, Claude's daily review)."
  read -r -s -p "    GitHub token: " GH < /dev/tty || GH=""; echo
  echo " 2) Telegram bot for alerts and commands — create one with @BotFather, then send it any message."
  read -r -s -p "    Telegram bot token: " TG < /dev/tty || TG=""; echo
  CHAT=""
  if [ -n "$TG" ]; then
    CHAT=$(curl -fsS "https://api.telegram.org/bot${TG}/getUpdates" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const u=JSON.parse(s).result;const m=u.reverse().find(x=>x.message);console.log(m?m.message.chat.id:"")}catch(e){console.log("")}})')
    [ -n "$CHAT" ] && echo "    Telegram chat id: $CHAT" || echo "    No message found: send your bot a message, then edit $ETC/secrets.env (TELEGRAM_CHAT_ID)."
  fi
  umask 077
  printf 'GITHUB_TOKEN=%s\nTELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\n' "$GH" "$TG" "$CHAT" > "$ETC/secrets.env"
  chown root:swarm "$ETC/secrets.env"; chmod 640 "$ETC/secrets.env"
fi

# risk limits: only Ibrahim signs them (root); the guardian stops trading if they change without a new signature
cat > /usr/local/bin/swarm-sign-risk <<SIGN
#!/usr/bin/env bash
set -euo pipefail
[ "\$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
F=$APP/swarm/config/risk.json
echo "Risk limits to sign:"; cat "\$F"
read -r -p "Sign these limits? (yes/no) " A < /dev/tty
[ "\$A" = "yes" ] || { echo "Not signed."; exit 1; }
sha256sum "\$F" | awk '{print \$1"  risk.json"}' > $ETC/risk.sha256; chmod 644 $ETC/risk.sha256
echo "Signed."
SIGN
chmod 755 /usr/local/bin/swarm-sign-risk
[ -f "$ETC/risk.sha256" ] || sha256sum "$APP/swarm/config/risk.json" | awk '{print $1"  risk.json"}' > "$ETC/risk.sha256"

cat > /etc/systemd/system/swarm@.service <<'UNIT'
[Unit]
Description=Swarm agent group %i
After=network-online.target redis-server.service time-sync.target
Wants=network-online.target
Requires=redis-server.service

[Service]
User=swarm
EnvironmentFile=/etc/swarm/env
EnvironmentFile=-/etc/swarm/secrets.env
EnvironmentFile=-/etc/swarm/blofin-demo.env
WorkingDirectory=/opt/swarm
ExecStart=/usr/bin/node /opt/swarm/swarm/src/run.js --group %i
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/swarm
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

install -m 755 "$APP/swarm/deploy/update.sh" /usr/local/bin/swarm-update
cat > /etc/systemd/system/swarm-update.service <<'UNIT'
[Unit]
Description=Test and install new swarm code (rolls back if the swarm is unhealthy after the restart)
[Service]
Type=oneshot
ExecStart=/usr/local/bin/swarm-update
UNIT
cat > /etc/systemd/system/swarm-update.timer <<'UNIT'
[Unit]
Description=Look for new swarm code every 10 minutes
[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
for g in $GROUPS; do systemctl enable --now "swarm@$g" >/dev/null; done
systemctl enable --now swarm-update.timer >/dev/null
sleep 5
systemctl --no-pager --lines=0 status $(for g in $GROUPS; do echo "swarm@$g"; done) | grep -E '●|Active' || true
echo
echo "Installed (PAPER account). Logs: journalctl -u 'swarm@*' -f"
echo "Stop everything: sudo systemctl stop 'swarm@*'   ·   Risk limits: sudo swarm-sign-risk after editing"
