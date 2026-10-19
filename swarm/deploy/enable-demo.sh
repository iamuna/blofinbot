#!/usr/bin/env bash
# Switch the swarm's trader to the BloFin DEMO account (run on the home PC after install.sh).
#
#   sudo bash /opt/swarm/swarm/deploy/enable-demo.sh          # asks for the demo API key, switches to demo
#   sudo bash /opt/swarm/swarm/deploy/enable-demo.sh --off    # back to paper, deletes the key
#
# Create the key in BloFin's DEMO trading (not the live site): permissions READ + TRADE only, no transfer or
# withdraw (the trader refuses such keys). The key is stored root-only-readable for the swarm user in
# /etc/swarm/blofin-demo.env and never leaves this PC. Strategies still need mode "trade" to send orders.
set -euo pipefail
ETC=/etc/swarm
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
if [ "${1:-}" = "--off" ]; then
  rm -f "$ETC/blofin-demo.env"
  node -e 'const f=process.argv[1],fs=require("fs");const c=JSON.parse(fs.readFileSync(f,"utf8"));c.trading=Object.assign(c.trading||{},{account:"paper"});fs.writeFileSync(f,JSON.stringify(c,null,2))' "$ETC/swarm.local.json"
  systemctl restart swarm@trader swarm@decision
  echo "Back on the PAPER account; demo key deleted."; exit 0
fi
read -r -p "BloFin DEMO API key: " K < /dev/tty
read -r -s -p "API secret (hidden): " S < /dev/tty; echo
read -r -s -p "API passphrase (hidden): " P < /dev/tty; echo
umask 077
printf 'BLOFIN_API_KEY=%s\nBLOFIN_API_SECRET=%s\nBLOFIN_PASSPHRASE=%s\n' "$K" "$S" "$P" > "$ETC/blofin-demo.env"
chown root:swarm "$ETC/blofin-demo.env"; chmod 640 "$ETC/blofin-demo.env"
node -e 'const f=process.argv[1],fs=require("fs");const c=JSON.parse(fs.readFileSync(f,"utf8"));c.trading=Object.assign(c.trading||{},{account:"demo"});fs.writeFileSync(f,JSON.stringify(c,null,2))' "$ETC/swarm.local.json"
systemctl restart swarm@trader swarm@decision
sleep 8
journalctl -u swarm@trader --since "-1 min" --no-pager | grep -E 'demo account ready|not ready|refused|money-moving' | tail -3 || true
echo "Trader switched to the BloFin DEMO account. Undo: sudo bash $0 --off"
