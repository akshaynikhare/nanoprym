# ============================================================
# NANOPRYM MAKEFILE
# Self-evolving AI agent orchestration system
# ============================================================

.DEFAULT_GOAL := help
SHELL := /bin/bash

# ── Colors ──────────────────────────────────────────────────
CYAN := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

# ── Setup ───────────────────────────────────────────────────
.PHONY: setup
setup: ## First-time setup: install deps, start services, configure
	@bash scripts/setup.sh

# ── Development ─────────────────────────────────────────────
.PHONY: build dev clean
build: ## Build TypeScript
	npx tsc

dev: ## Watch mode (TypeScript compiler)
	npx tsc --watch

clean: ## Remove build artifacts
	rm -rf dist coverage .vitest

# ── Infrastructure ──────────────────────────────────────────
.PHONY: infra-up infra-down infra-logs infra-status
infra-up: ## Start Qdrant + Redis (Docker Compose)
	docker compose up -d
	@echo "$(GREEN)Qdrant: http://localhost:6333  Redis: localhost:6379$(RESET)"

infra-down: ## Stop all infrastructure
	docker compose down

infra-logs: ## Tail infrastructure logs
	docker compose logs -f

infra-status: ## Show infrastructure status
	docker compose ps

# ── Nanoprym Daemon ─────────────────────────────────────────
.PHONY: up down start stop status
up: infra-up tom-start start ## Start infra + TOM + nanoprym (no dashboard dev server)

down: stop dashboard-stop tom-stop infra-down ## Stop everything

serve: infra-up tom-start build ## Start everything: infra + TOM + nanoprym + dashboard dev server
	@echo "$(CYAN)Starting dashboard dev server...$(RESET)"
	@cd dashboard && npm run dev &
	@sleep 2
	@echo "$(CYAN)Starting Nanoprym daemon...$(RESET)"
	@node dist/cli/cli.entry.js serve

start: build ## Start Nanoprym daemon only (API + health)
	@echo "$(CYAN)Starting Nanoprym daemon...$(RESET)"
	node dist/cli/cli.entry.js serve

stop: ## Stop Nanoprym daemon + dashboard
	@echo "$(YELLOW)Stopping Nanoprym...$(RESET)"
	@pkill -f "cli.entry.js serve" 2>/dev/null || echo "Not running"

status: ## Show orchestrator health
	node dist/cli/cli.entry.js health

# ── Task Management ─────────────────────────────────────────
.PHONY: task-run task-list task-status task-resume
task-run: ## Run next task in queue
	@echo "TODO: Implement task runner"

task-list: ## Show task queue
	@echo "TODO: Implement task listing"

task-status: ## Show current task progress
	@echo "TODO: Implement task status"

task-resume: ## Resume a failed task
	@echo "TODO: Implement task resume"

# ── TOM (Token Optimization Module) ────────────────────────
.PHONY: tom-start tom-stop tom-status tom-stats tom-benchmark
tom-start: ## Start TOM sidecar
	python3 src/tom/tom.sidecar.py &
	@echo "$(GREEN)TOM sidecar started$(RESET)"

tom-stop: ## Stop TOM sidecar
	@pkill -f "tom.sidecar.py" 2>/dev/null || echo "TOM not running"

tom-status: ## TOM status and RAM usage
	@echo "TODO: Implement TOM status"

tom-stats: ## Token savings report
	@echo "TODO: Implement TOM stats"

tom-benchmark: ## Run compression benchmark
	@echo "TODO: Implement TOM benchmark"

# ── Evolution ───────────────────────────────────────────────
.PHONY: evolve evolve-status evolve-history
evolve: ## Trigger evolution manually
	@echo "TODO: Implement manual evolution trigger"

evolve-status: ## Show last evolution proposal
	@echo "TODO: Implement evolution status"

evolve-history: ## Show evolution history
	@echo "TODO: Implement evolution history"

# ── Knowledge Base ──────────────────────────────────────────
.PHONY: kb-search kb-stats kb-sync
kb-search: ## Search KB (make kb-search q="null pointer")
	@echo "TODO: Implement KB search"

kb-stats: ## Show KB statistics
	@echo "TODO: Implement KB stats"

kb-sync: ## Force sync Git/Qdrant/SQLite
	@echo "TODO: Implement KB sync"

# ── Audit ───────────────────────────────────────────────────
.PHONY: audit-recent audit-search
audit-recent: ## Last 20 audit entries
	@echo "TODO: Implement audit viewer"

audit-search: ## Search audit trail
	@echo "TODO: Implement audit search"

# ── Testing ─────────────────────────────────────────────────
.PHONY: test test-watch test-coverage lint lint-fix typecheck
test: ## Run all tests
	npx vitest run

test-watch: ## Run tests in watch mode
	npx vitest

test-coverage: ## Tests with coverage report
	npx vitest run --coverage

lint: ## ESLint on codebase
	npx eslint src/ --ext .ts

lint-fix: ## ESLint with auto-fix
	npx eslint src/ --ext .ts --fix

typecheck: ## TypeScript type check (no emit)
	npx tsc --noEmit

# ── Dashboard ───────────────────────────────────────────────
.PHONY: dashboard dashboard-build dashboard-stop
dashboard: ## Start dashboard dev server (hot-reload, port 3000)
	cd dashboard && npm run dev

dashboard-build: ## Build dashboard for production
	cd dashboard && npm run build
	@echo "$(GREEN)Dashboard built → dashboard/dist/$(RESET)"

dashboard-stop: ## Stop dashboard dev server
	@pkill -f "vite" 2>/dev/null || echo "Dashboard not running"

# ── Docker ──────────────────────────────────────────────────
.PHONY: docker-build docker-push
docker-build: ## Build Nanoprym Docker image
	docker build -t nanoprym:latest .

docker-push: ## Push to GHCR
	@echo "TODO: Configure GHCR push"

# ── Documentation ───────────────────────────────────────────
.PHONY: docs-generate docs-serve
docs-generate: ## Regenerate documentation
	@echo "TODO: Implement doc generation"

docs-serve: ## Serve docs locally
	@echo "TODO: Implement doc server"

# ── Reset ───────────────────────────────────────────────────
.PHONY: reset
reset: ## Full reset (drops DBs, clears cache)
	@echo "$(RED)WARNING: This will destroy all data!$(RESET)"
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	$(MAKE) infra-down
	rm -rf dist coverage .vitest
	rm -rf ~/.nanoprym/ledgers/*
	@echo "$(GREEN)Reset complete$(RESET)"

# ── Help ────────────────────────────────────────────────────
.PHONY: help
help: ## Show this help
	@echo ""
	@echo "$(CYAN)NANOPRYM — Self-evolving AI Agent Orchestration$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(RESET) %s\n", $$1, $$2}'
	@echo ""
