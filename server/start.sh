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

# Pinned bd version — must match local install (schema compatibility).
# Upgrade both together: bump here + run BD_ALLOW_REMOTE_MIGRATE=1 bd migrate locally + bd dolt push.
BD_VERSION="${BD_VERSION:-1.0.3}"

BD_DIR="/root/beads-global"
DOLT_DATA="$BD_DIR/.beads/embeddeddolt"
DOLT_REMOTE="${DOLT_REMOTE_URL:-https://doltremoteapi.dolthub.com/mofro/beads-global}"

echo "[start] BD_DIR=$BD_DIR"
echo "[start] DOLT_REMOTE=$DOLT_REMOTE"
echo "[start] PORT=${PORT:-3001}"
echo "[start] Installing bd@${BD_VERSION}..."
npm install -g "@beads/bd@${BD_VERSION}" 2>&1 || { echo "[start] FATAL: bd install failed"; exit 1; }
echo "[start] $(bd --version)"

mkdir -p "$BD_DIR"
cd "$BD_DIR"

# bd requires a git repo at the workspace root.
git init -q 2>/dev/null || true

# Seed the project structure that bd bootstrap requires.
# metadata.json and .local_version identify this as an existing beads project so
# bootstrap knows to clone (not init). config.yaml provides the remote URL.
mkdir -p "$BD_DIR/.beads"
printf 'sync.remote: "%s"\nrepos:\n  primary: "."\n' "$DOLT_REMOTE" > "$BD_DIR/.beads/config.yaml"
printf '{"database":"dolt","backend":"dolt","dolt_mode":"embedded","dolt_database":"beads_global","project_id":"b0352ec7-8533-4def-ba5a-8cdb8d23417d"}' \
  > "$BD_DIR/.beads/metadata.json"
printf '%s' "$BD_VERSION" > "$BD_DIR/.beads/.local_version"

if [ ! -d "$DOLT_DATA" ]; then
  # ---- First boot: bootstrap from DoltHub ----
  echo "[start] No Dolt DB found — bootstrapping from DoltHub..."

  if bd bootstrap --yes 2>&1; then
    echo "[start] Bootstrap succeeded — Dolt DB cloned from DoltHub."
  else
    echo "[start] WARNING: Bootstrap failed. Server will start with empty data." >&2
    echo "[start] Beads data will be unavailable until next successful deploy." >&2
  fi

else
  # ---- Subsequent boots: pull updates ----
  echo "[start] Dolt DB found — pulling updates from DoltHub..."

  if bd dolt pull 2>&1; then
    echo "[start] Pull succeeded — data is current."
  else
    echo "[start] WARNING: Pull failed. Running with existing data." >&2
  fi
fi

# Configure DoltHub push credentials from the JWK private key stored in Railway.
# DOLT_CREDS_JWK must contain the full JSON contents of the local
# ~/.dolt/creds/c43netvcttrpl3cb6unpblme88iihvt3h8ktse350l5dk.jwk file.
DOLT_CREDS_HASH="c43netvcttrpl3cb6unpblme88iihvt3h8ktse350l5dk"
if [ -n "$DOLT_CREDS_JWK" ]; then
  mkdir -p /root/.dolt/creds
  printf '%s' "$DOLT_CREDS_JWK" > "/root/.dolt/creds/${DOLT_CREDS_HASH}.jwk"
  dolt config --global --set user.name mofro
  dolt config --global --set user.email g.mofro@gmail.com
  dolt config --global --set user.creds "$DOLT_CREDS_HASH"
  echo "[start] DoltHub credentials configured."
else
  echo "[start] WARNING: DOLT_CREDS_JWK not set — dolt push will fail." >&2
fi

echo "[start] Launching Beads Service..."
exec node /app/server/index.js
