#!/usr/bin/env bash
# ============================================================
# Nanoprym Setup Script — MacBook M1 Pro, 16GB RAM
# Run: chmod +x scripts/setup.sh && ./scripts/setup.sh
# ============================================================
set -euo pipefail

CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║   NANOPRYM v0.1.0 — Setup            ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════╝${RESET}"
echo ""

# ── 1. Prerequisites Check ──────────────────────────────────
echo -e "${CYAN}[1/9] Checking prerequisites...${RESET}"

check_cmd() {
  if command -v "$1" &>/dev/null; then
    echo -e "  ${GREEN}✓${RESET} $1 $(command -v "$1")"
    return 0
  else
    echo -e "  ${RED}✗${RESET} $1 not found"
    return 1
  fi
}

MISSING=0
check_cmd node || MISSING=1
check_cmd npm || MISSING=1
check_cmd git || MISSING=1
check_cmd docker || MISSING=1
check_cmd python3 || MISSING=1
check_cmd claude || MISSING=1
check_cmd gh || MISSING=1
check_cmd ollama || MISSING=1

if [ "$MISSING" -eq 1 ]; then
  echo -e "\n${RED}Missing required dependencies. Install them and retry.${RESET}"
  echo ""
  echo "Install guides:"
  echo "  claude  → https://claude.ai/download"
  echo "  gh      → brew install gh"
  echo "  ollama  → brew install ollama"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}Node.js 18+ required (found v$NODE_VERSION)${RESET}"
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} Node.js v$(node -v | sed 's/v//') (>= 18 required)"
echo ""

# ── 2. Credentials Setup ──────────────────────────────────────
echo -e "${CYAN}[2/9] Setting up credentials...${RESET}"

# Claude auth
if claude auth status &>/dev/null; then
  echo -e "  ${GREEN}✓${RESET} Claude authenticated"
else
  echo -e "  ${YELLOW}→${RESET} Claude not authenticated — running 'claude auth login'..."
  claude auth login
fi

# GitHub auth — check if any active account is logged in
# (gh auth status exits 1 if ANY account has issues, even if the active one is fine)
if gh auth token &>/dev/null; then
  GH_USER=$(gh api user --jq '.login' 2>/dev/null || echo "unknown")
  echo -e "  ${GREEN}✓${RESET} GitHub authenticated (${GH_USER})"
else
  echo -e "  ${YELLOW}→${RESET} GitHub not authenticated — running 'gh auth login'..."
  gh auth login
fi

# Slack (optional — for approval workflows)
ENV_FILE="$(dirname "$0")/../.env"
MANIFEST_FILE="$(dirname "$0")/../slack-app-manifest.json"

# Check if Slack tokens already exist and are non-empty
SLACK_ALREADY_CONFIGURED=0
if [ -f "$ENV_FILE" ]; then
  EXISTING_BOT=$(grep "^SLACK_BOT_TOKEN=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  EXISTING_APP=$(grep "^SLACK_APP_TOKEN=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  if [ -n "$EXISTING_BOT" ] && [ -n "$EXISTING_APP" ]; then
    SLACK_ALREADY_CONFIGURED=1
  fi
fi

if [ "$SLACK_ALREADY_CONFIGURED" -eq 1 ]; then
  echo -e "  ${GREEN}✓${RESET} Slack credentials found in .env"
else
  echo ""
  echo -e "  ${YELLOW}Slack setup (optional)${RESET} — enables Approve/Reject buttons in Slack"
  echo ""
  read -rp "  Set up Slack now? [y/N] " SETUP_SLACK
  if [[ "$SETUP_SLACK" =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "  ${CYAN}Step 1: Create the Slack App${RESET}"
    echo "  ─────────────────────────────────────────────────────"
    echo "  We'll open Slack's app creation page with our manifest."
    echo "  Just pick your workspace and click 'Create'."
    echo ""
    read -rp "  Press Enter to open Slack app creation page..." _

    # Open Slack app creation with manifest
    if [ -f "$MANIFEST_FILE" ]; then
      open "https://api.slack.com/apps?new_app=1&manifest_json=$(cat "$MANIFEST_FILE" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read()))')" 2>/dev/null || \
      echo "  Open this URL: https://api.slack.com/apps?new_app=1"
    else
      open "https://api.slack.com/apps?new_app=1" 2>/dev/null || \
      echo "  Open this URL: https://api.slack.com/apps?new_app=1"
    fi

    echo ""
    echo -e "  ${CYAN}Step 2: Get your Bot Token${RESET}"
    echo "  ─────────────────────────────────────────────────────"
    echo "  In your new app's page:"
    echo "    → Sidebar: 'OAuth & Permissions'"
    echo "    → Click 'Install to Workspace' → Allow"
    echo "    → Copy the 'Bot User OAuth Token' (starts with xoxb-)"
    echo ""
    read -rp "  Paste SLACK_BOT_TOKEN (xoxb-...): " SLACK_BOT_TOKEN

    echo ""
    echo -e "  ${CYAN}Step 3: Get your App Token${RESET}"
    echo "  ─────────────────────────────────────────────────────"
    echo "  In your app's page:"
    echo "    → Sidebar: 'Basic Information'"
    echo "    → Scroll to 'App-Level Tokens' → 'Generate Token'"
    echo "    → Name it 'nanoprym', add scope 'connections:write'"
    echo "    → Copy the token (starts with xapp-)"
    echo ""
    read -rp "  Paste SLACK_APP_TOKEN (xapp-...): " SLACK_APP_TOKEN

    echo ""
    echo -e "  ${CYAN}Step 4: Get Signing Secret${RESET}"
    echo "  ─────────────────────────────────────────────────────"
    echo "  Still on 'Basic Information':"
    echo "    → Scroll to 'App Credentials'"
    echo "    → Copy the 'Signing Secret'"
    echo ""
    read -rp "  Paste SLACK_SIGNING_SECRET: " SLACK_SIGNING_SECRET

    # Validate inputs
    if [ -z "$SLACK_BOT_TOKEN" ] || [ -z "$SLACK_APP_TOKEN" ]; then
      echo -e "\n  ${RED}✗${RESET} Bot token and app token are required. Run setup again to retry."
    else
      # Create .env if missing
      [ ! -f "$ENV_FILE" ] && touch "$ENV_FILE"

      # Remove any existing empty Slack lines to avoid duplicates
      if grep -q "SLACK_BOT_TOKEN=" "$ENV_FILE" 2>/dev/null; then
        sed -i '' '/^SLACK_BOT_TOKEN=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '' '/^SLACK_APP_TOKEN=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '' '/^SLACK_SIGNING_SECRET=/d' "$ENV_FILE" 2>/dev/null || true
      fi

      # Append tokens
      {
        echo ""
        echo "# Slack Bot (Bolt.js Socket Mode)"
        echo "SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN"
        echo "SLACK_APP_TOKEN=$SLACK_APP_TOKEN"
        echo "SLACK_SIGNING_SECRET=$SLACK_SIGNING_SECRET"
      } >> "$ENV_FILE"

      echo -e "\n  ${GREEN}✓${RESET} Slack credentials saved to .env"
      echo -e "  ${YELLOW}Tip${RESET}: Create these channels in your workspace:"
      echo "    #nanoprym-auto, #nanoprym-decisions, #nanoprym-failures, #nanoprym-daily"
      echo "    Then invite the bot: /invite @Nanoprym"
    fi
  else
    echo -e "  ${YELLOW}⚠${RESET} Skipped — run setup again later to configure Slack"
  fi
fi
echo ""

# ── 3. Install Node.js Dependencies ─────────────────────────
echo -e "${CYAN}[3/9] Installing Node.js dependencies...${RESET}"
npm install
echo ""

# ── 4. Install TOM Sidecar Dependencies ─────────────────────
echo -e "${CYAN}[4/9] Setting up TOM sidecar (Python)...${RESET}"
cd src/tom
python3 -m pip install -r requirements.txt --break-system-packages 2>/dev/null || \
python3 -m pip install -r requirements.txt
python3 -m spacy download en_core_web_sm 2>/dev/null || echo -e "  ${YELLOW}⚠${RESET} spaCy model download failed — TOM Layer 2 will be disabled"
cd ../..
echo ""

# ── 5. Start Infrastructure (Docker) ────────────────────────
echo -e "${CYAN}[5/9] Starting infrastructure (Qdrant + Redis)...${RESET}"
docker compose up -d
echo -e "  ${GREEN}✓${RESET} Qdrant: http://localhost:6333"
echo -e "  ${GREEN}✓${RESET} Redis:  localhost:6379"
echo ""

# ── 6. Setup Ollama Models ──────────────────────────────────
echo -e "${CYAN}[6/9] Setting up Ollama models...${RESET}"
echo "  Pulling nomic-embed-text (embeddings)..."
ollama pull nomic-embed-text
echo "  Pulling qwen2.5-coder:3b (TOM local inference)..."
ollama pull qwen2.5-coder:3b
echo ""

# ── 7. Create Nanoprym Home Directory ───────────────────────
echo -e "${CYAN}[7/9] Creating Nanoprym home directory...${RESET}"
NANOPRYM_HOME="$HOME/.nanoprym"
mkdir -p "$NANOPRYM_HOME"/{ledgers,projects,kb/{bugs,decisions,patterns,corrections,inspirations,failed-approaches},research}

# Create prime brain if not exists
if [ ! -f "$NANOPRYM_HOME/prime.brain.md" ]; then
  cat > "$NANOPRYM_HOME/prime.brain.md" << 'BRAIN'
# Nanoprym Prime Brain (L0)

## Code Organization
- File naming: kebab-case always
- 3+ occurrences: extract to _shared/
- One concern = one directory
- Similar things live together

## Architecture Principles
- Always root-cause, never patch
- DB schema first, API second, UI last
- Test branches at 80%
- Cost-conscious: always calculate per-unit economics

## Execution
- Non-interactive: never ask questions during execution
- Read before edit: always examine existing code first
- Match existing code style in the project
- Max 3 retry attempts before escalating

## Review
- Blind review: reviewer never sees builder context
- Evidence required for every acceptance criterion
- Instant reject: TODO/FIXME, silent error swallowing, "phase 2 deferred"

## Quality
- ESLint before every commit (Husky)
- Conventional commits always
- 60% overall coverage, 80% branch coverage
BRAIN
  echo -e "  ${GREEN}✓${RESET} Created prime.brain.md"
fi

# Create status file
cat > "$NANOPRYM_HOME/status.md" << STATUS
# Nanoprym Status

**Version**: 0.1.0
**Last Updated**: $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Status**: Ready

## Active Tasks
None

## Infrastructure
- Qdrant: http://localhost:6333
- Redis: localhost:6379
- Ollama: http://localhost:11434
STATUS
echo -e "  ${GREEN}✓${RESET} Created $NANOPRYM_HOME"
echo ""

# ── 8. Build TypeScript ─────────────────────────────────────
echo -e "${CYAN}[8/9] Building TypeScript...${RESET}"
npx tsc
echo -e "  ${GREEN}✓${RESET} Build complete"
echo ""

# ── 9. Run Tests ────────────────────────────────────────────
echo -e "${CYAN}[9/9] Running tests...${RESET}"
npx vitest run
echo ""

# ── Done ────────────────────────────────────────────────────
echo -e "${GREEN}╔══════════════════════════════════════╗${RESET}"
echo -e "${GREEN}║   NANOPRYM SETUP COMPLETE ✓          ║${RESET}"
echo -e "${GREEN}╚══════════════════════════════════════╝${RESET}"
echo ""
echo "Quick start:"
echo "  nanoprym run \"Fix the auth bug\" -c SIMPLE -t DEBUG"
echo "  nanoprym status"
echo "  nanoprym tom status"
echo ""
echo "Or use make:"
echo "  make help          # show all commands"
echo "  make start         # start orchestrator"
echo "  make tom-start     # start TOM sidecar"
echo "  make infra-status  # check Qdrant + Redis"
echo ""
