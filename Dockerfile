# Nanoprym — Node.js + Python TOM sidecar
FROM node:20-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Install TOM sidecar dependencies
COPY src/tom/requirements.txt src/tom/requirements.txt
RUN pip3 install --break-system-packages -r src/tom/requirements.txt

# Copy source
COPY dist/ dist/
COPY prompts/ prompts/
COPY rules/ rules/
COPY src/tom/ src/tom/
COPY nanoprym.config.yaml ./

ENV NODE_ENV=production

CMD ["node", "dist/cli/cli.entry.js"]

# ── Sandbox variant (restricted) ─────────────────────────
FROM base AS sandbox

# Sandbox runs evolution proposals in isolation
# No access to: prod DB, Slack, project repos
# Network restricted to GitHub API only
ENV NANOPRYM_SANDBOX=true
ENV NANOPRYM_EVOLUTION_MODE=sandbox

# 2 hour timeout enforced by sandbox.manager.ts via --stop-timeout
ENTRYPOINT ["node", "dist/cli/cli.entry.js"]
