#!/bin/bash
# Beads Service startup script.
#
# Runs inside the Railway container on every boot and restart.
# Sequence:
#   1. If no Dolt DB: write sync.remote config, run bd bootstrap (clones from DoltHub)
#   2. If Dolt DB already present: run bd dolt pull origin (update from DoltHub)
#   3. Exec node server/index.js
#
# Graceful degradation: if DoltHub is unreachable, the server starts anyway
# and returns empty beads_ready until the next successful deploy or restart.
#
# WHY bootstrap not init+pull:
#   bd init creates a fresh Dolt repo with independent history. bd dolt pull
#   then fails with "no common ancestor" because the local and remote histories
#   have diverged from the start. bd bootstrap clones from the remote directly,
#   avoiding this entirely.
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

cd "$BD_DIR" 2>/dev/null || (mkdir -p "$BD_DIR" && cd "$BD_DIR")

if [ ! -d "$DOLT_DATA" ]; then
  # ---- First boot: bootstrap from DoltHub ----
  echo "[start] No Dolt DB found — bootstrapping from DoltHub..."

  # Write a minimal config.yaml so bd bootstrap knows where to clone from.
  # sync.remote is the key bd bootstrap checks first.
  mkdir -p "$BD_DIR/.beads"
  printf 'sync.remote: "%s"\n' "$DOLT_REMOTE" > "$BD_DIR/.beads/config.yaml"

  if bd bootstrap --yes 2>&1; then
    echo "[start] Bootstrap succeeded — Dolt DB cloned from DoltHub."
  else
    echo "[start] WARNING: Bootstrap failed. Server will start with empty data." >&2
    echo "[start] Beads data will be unavailable until next successful deploy." >&2
  fi

else
  # ---- Subsequent boots: pull updates ----
  echo "[start] Dolt DB found — pulling updates from DoltHub..."

  if bd dolt pull origin 2>&1; then
    echo "[start] Pull succeeded — data is current."
  else
    echo "[start] WARNING: Pull failed. Running with existing data." >&2
  fi
fi

echo "[start] Launching Beads Service..."
exec node /app/server/index.js
