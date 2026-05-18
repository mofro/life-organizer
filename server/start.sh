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

# ---- Step 2 + 3: Configure Dolt remote and pull ----
if [ -d "$DOLT_DATA" ]; then
  echo "[start] Configuring Dolt remote..."
  cd "$DOLT_DATA"

  # Add remote — idempotent, ignore error if it already exists
  dolt remote add origin "$DOLT_REMOTE" 2>/dev/null || true

  # Configure credentials for push (read from public DoltHub repo needs no auth)
  if [ -n "$DOLT_REMOTE_USER" ] && [ -n "$DOLT_REMOTE_PASSWORD" ]; then
    dolt config --global --add user.name "$DOLT_REMOTE_USER" 2>/dev/null || true
    dolt config --global --add user.password "$DOLT_REMOTE_PASSWORD" 2>/dev/null || true
    echo "[start] Dolt credentials configured."
  fi

  echo "[start] Pulling beads data from DoltHub..."
  if dolt pull origin main --no-edit 2>&1; then
    echo "[start] Dolt pull succeeded — data is up to date."
  else
    # Don't fail startup if the pull fails.
    # The server will start with whatever data was baked into the image
    # (likely empty on first deploy, stale on restart) and will re-sync
    # on the next /api/beads/ready request (which calls bd repo sync).
    echo "[start] WARNING: Dolt pull failed. Starting with existing data." >&2
    echo "[start] The server will attempt to sync on the next /api/beads/ready request." >&2
  fi

  cd /app
else
  echo "[start] WARNING: Dolt data directory not found at $DOLT_DATA" >&2
  echo "[start]   bd init may have used a different layout. Check container logs." >&2
  echo "[start]   Starting server anyway — /api/beads/* will return empty results." >&2
fi

# ---- Step 4: Hand off to the server ----
echo "[start] Launching Beads Service..."
exec node /app/server/index.js
