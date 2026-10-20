#!/usr/bin/env bash
# Ibrahim's approval for a swarm update that touches protected code (risk limits, risk/trader/guardian/Herald
# code, the bus, the installer). Installed as /usr/local/bin/swarm-approve; needs sudo, so only someone at the
# PC can say yes.
#
#   sudo swarm-approve            shows what changed since the installed commit, asks, then installs
#   sudo swarm-approve <sha>      the same, but only if <sha> is still the newest commit
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
APP=/opt/swarm; BRANCH="${SWARM_BRANCH:-swarm}"; APPROVED=/etc/swarm/approved
git -C "$APP" fetch -q origin "$BRANCH"
OLD=$(git -C "$APP" rev-parse HEAD); NEW=$(git -C "$APP" rev-parse "origin/$BRANCH")
if [ "$OLD" = "$NEW" ]; then echo "Nothing new: ${OLD:0:12} is installed."; exit 0; fi
if [ -n "${1:-}" ]; then case "$NEW" in "$1"*) ;; *) echo "The newest commit is ${NEW:0:12}, not $1 — look at it first: sudo swarm-approve"; exit 1;; esac; fi
ACCOUNT=$(node -e 'try{const c=JSON.parse(require("fs").readFileSync("/etc/swarm/swarm.local.json","utf8"));console.log((c.trading&&c.trading.account)||"paper")}catch(e){console.log("paper")}')
echo "Installed: ${OLD:0:12}   New: ${NEW:0:12}   Account: $ACCOUNT"
echo; git -C "$APP" log --format='  %h %s' "$OLD..$NEW"
echo; git -C "$APP" diff --stat "$OLD" "$NEW" -- swarm | tail -n 25
echo; echo "Gate: $(node "$APP/swarm/src/tools/update_gate.js" --repo "$APP" --old "$OLD" --new "$NEW" --account "$ACCOUNT" || true)"
echo; read -r -p "Install ${NEW:0:12}? Its tests run first; it rolls back if the swarm is unhealthy. (yes/no) " A < /dev/tty
[ "$A" = "yes" ] || { echo "Not approved."; exit 1; }
mkdir -p "$APPROVED"; touch "$APPROVED/$NEW"
/usr/local/bin/swarm-update
