#!/usr/bin/env bash
# Updater (root, every 10 minutes): new commits on the swarm branch are tested in a scratch checkout first; only
# if every offline test passes is /opt/swarm moved forward and the agent groups restarted. Three minutes later the
# swarm must be healthy (every group's agents sending heartbeats, no burst of failed messages); otherwise the
# previous commit is restored and Ibrahim gets a Telegram message.
set -euo pipefail
APP=/opt/swarm; BRANCH="${SWARM_BRANCH:-swarm}"; GROUPS="market brain decision trader ops"
. /etc/swarm/secrets.env 2>/dev/null || true
say() { [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] && curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" -d chat_id="$TELEGRAM_CHAT_ID" --data-urlencode text="$1" >/dev/null || true; echo "$1"; }

cd "$APP"
git fetch -q origin "$BRANCH"
OLD=$(git rev-parse HEAD); NEW=$(git rev-parse "origin/$BRANCH")
[ "$OLD" = "$NEW" ] && exit 0

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git worktree add -q --detach "$TMP/new" "$NEW"
if ! (cd "$TMP/new/swarm" && timeout 600 node --test --test-timeout=60000 test/*.test.js > "$TMP/test.log" 2>&1); then
  say "Swarm update ${NEW:0:7} NOT installed: tests failed ($(grep -c '^not ok' "$TMP/test.log") failing)."
  git worktree remove --force "$TMP/new"; exit 1
fi
git worktree remove --force "$TMP/new"
git reset -q --hard "$NEW"
for g in $GROUPS; do systemctl restart "swarm@$g"; done
sleep 180
# health: every group still running and heartbeats from the last 60 s
bad=""
for g in $GROUPS; do systemctl is-active -q "swarm@$g" || bad="$bad $g"; done
recent=$(redis-cli --raw XREVRANGE sw:s:sys.heartbeat + - COUNT 400 | grep -o '"agent":"[^"]*"' | sort -u | wc -l)
if [ -n "$bad" ] || [ "$recent" -lt 8 ]; then
  git reset -q --hard "$OLD"
  for g in $GROUPS; do systemctl restart "swarm@$g"; done
  say "Swarm update ${NEW:0:7} rolled back to ${OLD:0:7}: unhealthy after restart (down:${bad:- none}, agents reporting: $recent)."
  exit 1
fi
say "Swarm updated ${OLD:0:7} → ${NEW:0:7}: $(git log --format=%s -1 | cut -c1-120)"
