# Nanoprym Setup Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ | `brew install node` |
| Docker Desktop | latest | https://docker.com/products/docker-desktop |
| Git | any | `brew install git` |
| Python 3 | 3.10+ | `brew install python3` |
| Claude Code CLI | latest | `npm install -g @anthropic-ai/claude-code` |
| GitHub CLI | latest | `brew install gh` |
| Ollama | latest | https://ollama.ai |

## Quick Setup (Automated)

```bash
git clone https://github.com/nanoprym/nanoprym.git
cd nanoprym
./scripts/setup.sh
```

The setup script handles everything: deps, Docker, Ollama models, build, tests.

## Manual Setup

### 1. Install Dependencies

```bash
npm install
cd src/tom && pip3 install -r requirements.txt && cd ../..
python3 -m spacy download en_core_web_sm
```

### 2. Start Infrastructure

```bash
docker compose up -d    # Qdrant + Redis
ollama serve            # In separate terminal (if not running)
ollama pull nomic-embed-text
ollama pull qwen2.5-coder:3b
```

### 3. Build

```bash
npm run build           # TypeScript → dist/
npm test                # Verify 54+ tests pass
```

### 4. Authenticate

```bash
# Claude (needed for builder/planner agents)
claude auth login       # Follow OAuth flow

# GitHub (needed for PR creation + Copilot review)
gh auth login           # Follow OAuth flow
```

### 5. Register Nanoprym as First Project (Dogfooding)

```bash
nanoprym config         # Verify config loads
```

Edit `nanoprym.config.yaml` to set your Slack webhook URL (optional).

## Usage

```bash
# Run a task
nanoprym run "Add input validation to the user registration endpoint" -c STANDARD -t TASK

# Resume a failed task
nanoprym resume <task-id>

# Check status
nanoprym status

# TOM compression test
nanoprym tom compress "Please kindly refactor the authentication module in order to improve performance"

# View config
nanoprym config
```

## RAM Budget (16GB MacBook)

| Process | RAM |
|---------|-----|
| macOS + Apps | ~4.5 GB |
| Ollama (Qwen2.5-3B) | ~2.5 GB |
| Nanoprym (Node.js) | ~500 MB |
| Qdrant | ~300 MB |
| Redis | ~100 MB |
| TOM sidecar (Python) | ~80 MB |
| Headroom | ~8 GB |

## Troubleshooting

**Qdrant won't start**: Check Docker Desktop is running. `docker compose logs qdrant`

**Ollama models slow**: Run Ollama natively (not in Docker) for Metal GPU acceleration.

**Claude CLI not found**: `npm install -g @anthropic-ai/claude-code` then `claude auth login`

**Tests fail**: Run `npm run typecheck` first. If types are clean, run `npm test -- --reporter=verbose`
