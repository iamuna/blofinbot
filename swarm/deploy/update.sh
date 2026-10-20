#!/usr/bin/env bash
# Updater (root, every 10 minutes). New commits on the swarm branch are installed only when:
#   1. the update gate — run from the code ALREADY installed — says they stay in the self-service area (strategy
#      plugins that pass the plugin check, shadow-mode strategy settings, candidates, tests, docs), or Ibrahim
#      approved this exact commit on the PC (sudo swarm-approve);
#   2. every offline test passes in a scratch checkout, run as the unprivileged user `nobody` (a test file
#      cannot read the keys);
#   3. three minutes after the restart the swarm is healthy (every group running, heartbeats coming in).
#      Otherwise the previous commit is restored. Ibrahim hears about each outcome on Telegram.
set -euo pipefail
APP=/opt/swarm; BRANCH="${SWARM_BRANCH:-swarm}"; SWARM_GROUPS="market brain decision trader ops"
APPROVED=/etc/swarm/approved
. /etc/swarm/secrets.env 2>/dev/null || true
say() { [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] && curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" -d chat_id="$TELEGRAM_CHAT_ID" --data-urlencode text="$1" >/dev/null || true; echo "$1"; }
restart_all() { for g in $SWARM_GROUPS; do systemctl restart "swarm@$g"; done; }

cd "$APP"
git fetch -q origin "$BRANCH"
OLD=$(git rev-parse HEAD); NEW=$(git rev-parse "origin/$BRANCH")
[ "$OLD" = "$NEW" ] && exit 0
mkdir -p "$APPROVED"

ACCOUNT=$(node -e 'try{const c=JSON.parse(require("fs").readFileSync("/etc/swarm/swarm.local.json","utf8"));console.log((c.trading&&c.trading.account)||"paper")}catch(e){console.log("paper")}')
GATE=$(node "$APP/swarm/src/tools/update_gate.js" --repo "$APP" --old "$OLD" --new "$NEW" --account "$ACCOUNT" || true)
if [ "${GATE%%:*}" != "auto" ] && [ ! -f "$APPROVED/$NEW" ]; then
  if [ ! -f "$APPROVED/.asked-$NEW" ]; then
    touch "$APPROVED/.asked-$NEW"
    say "Swarm update ${NEW:0:7} needs your OK — ${GATE#*: }. To install it, on the PC: sudo swarm-approve ${NEW:0:12}"
  fi
  exit 0
fi

TMP=$(mktemp -d); trap 'git -C "$APP" worktree remove --force "$TMP/new" 2>/dev/null || true; rm -rf "$TMP"' EXIT
chmod 755 "$TMP"
git worktree add -q --detach "$TMP/new" "$NEW"
if ! (cd "$TMP/new/swarm" && runuser -u nobody -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp timeout 600 node --test --test-timeout=60000 test/*.test.js > "$TMP/test.log" 2>&1); then
  say "Swarm update ${NEW:0:7} NOT installed: tests failed ($(grep -c '^not ok' "$TMP/test.log" || true) failing)."
  exit 1
fi
git reset -q --hard "$NEW"
restart_all
sleep 180
# health: every group still running and heartbeats from at least 8 agents
bad=""
for g in $SWARM_GROUPS; do systemctl is-active -q "swarm@$g" || bad="$bad $g"; done
recent=$(redis-cli --raw XREVRANGE sw:s:sys.heartbeat + - COUNT 400 | grep -o '"agent":"[^"]*"' | sort -u | wc -l)
if [ -n "$bad" ] || [ "$recent" -lt 8 ]; then
  git reset -q --hard "$OLD"
  restart_all
  say "Swarm update ${NEW:0:7} rolled back to ${OLD:0:7}: unhealthy after restart (down:${bad:- none}, agents reporting: $recent)."
  exit 1
fi
# the updater and the approval command update themselves only through an approved commit (both are protected)
install -m 755 "$APP/swarm/deploy/update.sh" /usr/local/bin/swarm-update
install -m 755 "$APP/swarm/deploy/approve.sh" /usr/local/bin/swarm-approve
say "Swarm updated ${OLD:0:7} → ${NEW:0:7}: $(git log --format=%s -1 | cut -c1-120)"
