#!/bin/bash
# Beads Service startup script.
#
# Runs inside the Railway container on every boot and restart.
# Sequence:
#   1. Initialize beads directory if this is first boot (no Dolt DB present)
#   2. Configure Dolt remote pointing at DoltHub (idempotent)
#   3. Pull latest issue data from DoltHub (public repo — anonymous pull)
#   4. Exec node server/index.js
#
# Graceful degradation: if the DoltHub pull fails (network, DoltHub outage),
# the server starts anyway. It will return empty beads_ready until the next
# deploy or manual restart that succeeds in pulling.
#
# Environment variables (set in Railway dashboard):
#   BEADS_DIR            Path bd uses for .beads/. Default: /root/beads-global
#   DOLT_REMOTE_URL      Full DoltHub remote URL.
#                        Default: https://doltremoteapi.dolthub.com/mofro/beads-global
#   DOLT_REMOTE_USER     DoltHub username. Only needed for push operations.
#                        Pull from a public DoltHub repo is anonymous.
#   DOLT_REMOTE_PASSWORD DoltHub API token. Only needed for push operations.
#
# Railway auto-injects:
#   PORT                 The port number the server must listen on.

BD_DIR="${BEADS_DIR:-/root/beads-global}"
DOLT_DATA="$BD_DIR/.beads/embeddeddolt"
DOLT_REMOTE="${DOLT_REMOTE_URL:-https://doltremoteapi.dolthub.com/mofro/beads-global}"

echo "[start] BD_DIR=$BD_DIR"
echo "[start] DOLT_REMOTE=$DOLT_REMOTE"
echo "[start] PORT=${PORT:-3001}"

# ---- Step 1: Initialize beads if no Dolt DB present ----
# The Docker image ships .beads/ (config, JSONL, hooks) but NOT embeddeddolt/
# (it is gitignored). bd init creates the embedded Dolt database from scratch.
if [ ! -d "$DOLT_DATA" ]; then
  echo "[start] No Dolt DB found — running bd init at $BD_DIR..."
  mkdir -p "$BD_DIR"
  cd "$BD_DIR"
  bd init
  echo "[start] bd init complete."
else
  echo "[start] Dolt DB found at $DOLT_DATA."
  cd "$BD_DIR"
fi

# ---- Step 2: Configure Dolt remote (idempotent) ----
# bd dolt remote add exits non-zero if the remote already exists; that's fine.
echo "[start] Configuring Dolt remote '$DOLT_REMOTE'..."
bd dolt remote add origin "$DOLT_REMOTE" 2>/dev/null \
  && echo "[start] Remote 'origin' added." \
  || echo "[start] Remote 'origin' already configured."

# ---- Step 3: Pull latest data from DoltHub ----
# DoltHub public repos allow anonymous pull — no credentials needed here.
# DOLT_REMOTE_USER / DOLT_REMOTE_PASSWORD are only required for push (write-back).
echo "[start] Pulling from DoltHub..."
if bd dolt pull origin 2>&1; then
  echo "[start] Pull succeeded — data is current."
else
  echo "[start] WARNING: DoltHub pull failed. Starting with empty Dolt DB." >&2
  echo "[start] Beads data will be unavailable until next successful deploy." >&2
fi

# ---- Step 4: Hand off to the server ----
echo "[start] Launching Beads Service..."
exec node /app/server/index.js
