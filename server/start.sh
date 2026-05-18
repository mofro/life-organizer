#!/bin/bash
# Beads Service startup script.
#
# Runs inside the Railway container on every deployment and restart.
# Sequence:
#   1. Initialize ~/beads-global if this is first boot (empty image)
#   2. Configure the Dolt remote pointing at DoltHub
#   3. Pull latest beads data (gracefully degraded — server starts even if pull fails)
#   4. Exec node server/index.js (takes over the process; logs go to Railway)
#
# Environment variables (set in Railway dashboard):
#   DOLT_REMOTE_URL   Full DoltHub remote URL.
#                     Default: https://doltremoteapi.dolthub.com/mofro/beads-global
#                     Override when migrating to Cloudflare R2.
#   DOLT_REMOTE_USER  DoltHub username (needed for push; pull from public repo is anonymous)
#   DOLT_REMOTE_PASSWORD  DoltHub API token (from 1Password → DoltHub API)
#
# Railway auto-injects:
#   PORT              The port number the server must listen on.

set -e

# ---- Configuration ----
BD_DIR="${BEADS_DIR:-/root/beads-global}"
DOLT_DATA="$BD_DIR/.beads/embeddeddolt/beads_global"
DOLT_REMOTE="${DOLT_REMOTE_URL:-https://doltremoteapi.dolthub.com/mofro/beads-global}"

echo "[start] BD_DIR=$BD_DIR"
echo "[start] DOLT_REMOTE=$DOLT_REMOTE"
echo "[start] PORT=${PORT:-3001}"

# ---- Step 1: Initialize beads directory if not fully initialized ----
# Check for the embedded dolt directory, not just .beads/ — a failed prior
# bd init leaves .beads/ partially created, which would fool a shallower check.
if [ ! -d "$DOLT_DATA" ]; then
  echo "[start] Initializing beads at $BD_DIR (no dolt data found)..."
  # Clean up any partial state from a previous failed init
  rm -rf "$BD_DIR/.beads"
  mkdir -p "$BD_DIR"
  cd "$BD_DIR"
  bd init
  echo "[start] beads initialized."
else
  echo "[start] Existing beads database found at $DOLT_DATA."
fi

# ---- Step 2: Wire the sync remote into bd's config.yaml ----
# bd repo sync reads sync.remote from .beads/config.yaml — NOT from dolt remote.
# Raw `dolt remote add` bypasses this; bd never sees it.
CONFIG="$BD_DIR/.beads/config.yaml"
if grep -q "sync.remote" "$CONFIG" 2>/dev/null; then
  echo "[start] sync.remote already configured."
else
  echo "[start] Writing sync.remote to $CONFIG..."
  printf '\nsync.remote: "%s"\n' "$DOLT_REMOTE" >> "$CONFIG"
fi

# ---- Step 3: Pull latest beads data via bd repo sync ----
cd "$BD_DIR"
echo "[start] Running bd repo sync from $DOLT_REMOTE..."
if bd repo sync 2>&1; then
  echo "[start] bd repo sync succeeded."
else
  echo "[start] WARNING: bd repo sync failed. Starting with empty/stale data." >&2
  echo "[start] Data will sync on the next /api/beads/ready request." >&2
fi

# ---- Step 4: Hand off to the server ----
echo "[start] Launching Beads Service..."
exec node /app/server/index.js
