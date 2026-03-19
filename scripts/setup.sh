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
echo -e "${CYAN}[1/8] Checking prerequisites...${RESET}"

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

# Optional but recommended
check_cmd claude || echo -e "  ${YELLOW}⚠${RESET} claude CLI not found — install from https://claude.ai/download"
check_cmd gh || echo -e "  ${YELLOW}⚠${RESET} gh CLI not found — install from https://cli.github.com"
check_cmd ollama || echo -e "  ${YELLOW}⚠${RESET} ollama not found — install from https://ollama.ai"

if [ "$MISSING" -eq 1 ]; then
  echo -e "\n${RED}Missing required dependencies. Install them and retry.${RESET}"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}Node.js 18+ required (found v$NODE_VERSION)${RESET}"
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} Node.js v$(node -v | sed 's/v//') (>= 18 required)"
echo ""

# ── 2. Install Node.js Dependencies ─────────────────────────
echo -e "${CYAN}[2/8] Installing Node.js dependencies...${RESET}"
npm install
echo ""

# ── 3. Install TOM Sidecar Dependencies ─────────────────────
echo -e "${CYAN}[3/8] Setting up TOM sidecar (Python)...${RESET}"
cd src/tom
python3 -m pip install -r requirements.txt --break-system-packages 2>/dev/null || \
python3 -m pip install -r requirements.txt
python3 -m spacy download en_core_web_sm 2>/dev/null || echo -e "  ${YELLOW}⚠${RESET} spaCy model download failed — TOM Layer 2 will be disabled"
cd ../..
echo ""

# ── 4. Start Infrastructure (Docker) ────────────────────────
echo -e "${CYAN}[4/8] Starting infrastructure (Qdrant + Redis)...${RESET}"
docker compose up -d
echo -e "  ${GREEN}✓${RESET} Qdrant: http://localhost:6333"
echo -e "  ${GREEN}✓${RESET} Redis:  localhost:6379"
echo ""

# ── 5. Setup Ollama Models ──────────────────────────────────
echo -e "${CYAN}[5/8] Setting up Ollama models...${RESET}"
if command -v ollama &>/dev/null; then
  echo "  Pulling nomic-embed-text (embeddings)..."
  ollama pull nomic-embed-text || echo -e "  ${YELLOW}⚠${RESET} Failed — embeddings will be unavailable"
  echo "  Pulling qwen2.5-coder:3b (TOM local inference)..."
  ollama pull qwen2.5-coder:3b || echo -e "  ${YELLOW}⚠${RESET} Failed — TOM local routing will be unavailable"
else
  echo -e "  ${YELLOW}⚠${RESET} Ollama not installed — skipping model downloads"
  echo "  Install from https://ollama.ai then run:"
  echo "    ollama pull nomic-embed-text"
  echo "    ollama pull qwen2.5-coder:3b"
fi
echo ""

# ── 6. Create Nanoprym Home Directory ───────────────────────
echo -e "${CYAN}[6/8] Creating Nanoprym home directory...${RESET}"
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

# ── 7. Build TypeScript ─────────────────────────────────────
echo -e "${CYAN}[7/8] Building TypeScript...${RESET}"
npx tsc
echo -e "  ${GREEN}✓${RESET} Build complete"
echo ""

# ── 8. Run Tests ────────────────────────────────────────────
echo -e "${CYAN}[8/8] Running tests...${RESET}"
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
