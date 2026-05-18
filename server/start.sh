#!/bin/bash
# Beads Service startup script.
#
# Issue data ships baked into the Docker image via .beads/ (tracked in git).
# No init or remote sync needed at startup — data is always current as of
# the last git push that triggered this deploy.
#
# For data freshness: push to main → Railway auto-deploys with latest issues.
#
# Environment variables (set in Railway dashboard):
#   BEADS_DIR   Path bd uses to find .beads/. Set to /app on Railway.
#               Locally leave unset — defaults to ~/beads-global.
#
# Railway auto-injects:
#   PORT        The port number the server must listen on.

echo "[start] BEADS_DIR=${BEADS_DIR:-/app}"
echo "[start] PORT=${PORT:-3001}"
echo "[start] Launching Beads Service..."
exec node /app/server/index.js
