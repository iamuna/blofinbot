#!/usr/bin/env bash
# Launcher used by the systemd unit on the 24/7 PC. Keeps the bot's state in a git checkout of
# STATE_BRANCH so the dashboard and the hourly supervisor can read it; runs the bot in long shifts.
set -euo pipefail
cd /opt/blofinbot
STATE_DIR=/var/lib/blofinbot/state
BRANCH="${STATE_BRANCH:-paper-state-home}"
BOT="${BOT_SCRIPT:-lab/mtfbot.js}"
[ -f "$BOT" ] || BOT=lab/paperbot.js   # fall back to the single-coin bot until the multi-coin one ships

if [ -n "${GITHUB_TOKEN:-}" ]; then REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/iamuna/blofinbot.git"; else REMOTE=""; fi
if [ ! -d "$STATE_DIR/.git" ]; then
  mkdir -p "$STATE_DIR"
  if [ -n "$REMOTE" ] && git clone -q --depth 1 --branch "$BRANCH" "$REMOTE" "$STATE_DIR" 2>/dev/null; then :; else
    git -C "$STATE_DIR" init -q -b "$BRANCH"
    [ -n "$REMOTE" ] && git -C "$STATE_DIR" remote add origin "$REMOTE"
  fi
fi
[ -n "$REMOTE" ] && git -C "$STATE_DIR" remote set-url origin "$REMOTE" 2>/dev/null || true
git -C "$STATE_DIR" config user.name "blofinbot (home)"
git -C "$STATE_DIR" config user.email "blofinbot@users.noreply.github.com"

GITFLAG=""; [ -n "$REMOTE" ] && GITFLAG="--git --branch $BRANCH"
# seed history for the multi-coin bot (Binance archive data from the research-data branch; public)
SEED=/var/lib/blofinbot/research-data
if [ "$BOT" = "lab/mtfbot.js" ]; then
  if [ ! -d "$SEED/.git" ]; then
    git clone -q --depth 1 --filter=blob:none --sparse --branch research-data https://github.com/iamuna/blofinbot.git "$SEED"
    git -C "$SEED" sparse-checkout set --no-cone '/*/1h.csv.gz' '/*/funding.csv.gz' '/manifest.json' '/universe.json'
  else
    git -C "$SEED" pull -q --depth 1 --rebase 2>/dev/null || true
  fi
  SEEDFLAG="--seed-dir $SEED"
else
  SEEDFLAG=""
fi
# one shift = 6 hours; systemd restarts it immediately, continuing from the saved state
exec node "$BOT" run --state-dir "$STATE_DIR" --minutes 360 $GITFLAG $SEEDFLAG
