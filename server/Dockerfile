# ---- Stage 1: install production dependencies ----
FROM node:20-slim AS deps

WORKDIR /app
# Copy only the manifests so this layer is cached unless deps change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 2: runtime image ----
FROM node:20-slim

# curl: needed by the Dolt installer and the HEALTHCHECK command
# git: required by bd init (beads uses git internally to version its database)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Dolt CLI — used by the startup script to pull beads data from DoltHub
RUN curl -L https://github.com/dolthub/dolt/releases/latest/download/install.sh \
    | bash

# Install bd (beads) CLI for Linux via npm
# The @beads/bd package ships a Linux x64 binary; this is the production
# equivalent of the macOS arm64 binary installed by Homebrew locally.
RUN npm install -g @beads/bd

WORKDIR /app

# Copy production node_modules from the deps stage (no dev bloat)
COPY --from=deps /app/node_modules ./node_modules

# Copy root package.json — needed at runtime because server/index.js is ESM
# ("type": "module") and Node looks up the nearest package.json for the module type.
COPY package.json ./

# Copy server source and startup script
COPY server/index.js ./server/
COPY server/start.sh ./server/start.sh
RUN chmod +x ./server/start.sh

# PORT is injected by Railway at runtime; the server reads process.env.PORT.
# Expose the default as documentation only.
EXPOSE 3001

# Health check: Railway also hits /api/health for its own readiness probe,
# but having this here lets local `docker run` users see the container state.
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3001}/api/health || exit 1

CMD ["/app/server/start.sh"]
