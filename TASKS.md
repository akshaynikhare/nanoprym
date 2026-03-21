# Tasks

## Deployment (requires MacBook)

- [x] First dogfood run — full pipeline verified: Builder → Reviewer → CLUSTER_COMPLETE → Awaiting Review in dashboard

## Deferred to Production

- [x] Slack Bolt.js bot — Socket Mode, Block Kit approval buttons, threaded task lifecycle, legacy webhook fallback, shared task-actions module, 101 tests passing
- [x] Health monitoring — HealthMonitor with DB persistence, dependency checks, alerts, API endpoints, dashboard panel, CLI command
- [x] Scanners: Ruff, Lighthouse, Madge — all implemented, registered in plugin loader, JSON output parsing, severity classification
- [x] Testers: Hurl, k6 — TesterPlugin implementations, JSON report parsing (Hurl --report-json, k6 --summary-export), text fallback, TESTER_REGISTRY + getRegisteredTesters/getAvailableTesters/runAllTesters in plugin loader, 13 tests
- [x] Generators: OpenAPI, Docker, Deployment Guide — 3 generator plugins + 22 tests
- [ ] Evolution PR workflow (sandbox → PR → human review → merge)
- [x] Rollback with cascade detection — RollbackManager (evolution registry, dependency-aware cascade detection, git revert, failed-approach rules), CLI `nanoprym rollback run/list/cascade`, 22 tests

## Completed

- [x] Phase 0 — Research & intelligence gathering (system prompts, gap analysis, feasibility, cost model, 36 decisions locked)
- [x] Phase 1 Week 1 — Project scaffold + infrastructure (dirs, tsconfig, Docker Compose, Makefile, SQLite schema, TOM scaffold, CI skeleton)
- [x] Phase 1 Week 2 — Event sourcing + orchestration core (event ledger, message bus, config router, context builder, state snapshots, trigger engine, 20/20 tests)
- [x] Phase 1 Week 3 — Agent pipeline (Claude provider, Planner, Builder, Reviewer, Validator, git manager, ESLint scanner, retry manager, 29/29 tests)
- [x] Phase 1 Week 4 — Integration (TOM client, prompt manager, config system, audit logger, Vitest runner, security module, CLI entry point, 45/45 tests)
- [x] Phase 2 Week 5 — Knowledge base + persistence (Qdrant, KB store with Git-backed markdown, SQLite migrations, semantic dedup)
- [x] Phase 2 Week 6 — Communication (Slack webhook bot, daily summaries, project isolation, report generator)
- [x] Phase 2 Week 7 — TOM + multi-model routing (TOM router, cache, cost tracking with $5/mo cap, CLI commands)
- [x] Phase 2 Week 8 — Metrics + CLI + dashboard scaffold (metrics collector, cost tracker, full CLI, dashboard React scaffold, report generator)
- [x] Phase 3 Weeks 9-10 — Plugin system (4 scanners: ESLint/Semgrep/Trivy/jscpd, 2 testers: Vitest/Playwright, 3 generators: RCA/Changelog/ADR)
- [x] Phase 3 Weeks 11-12 — Self-evolution engine (learning engine, prompt versioner, rule extractor)
- [x] Spec v2 finalized — all phases documented, MacBook deployment readiness
- [x] MacBook setup — `setup.sh` run, npm deps, TOM sidecar, infra up
- [x] Ollama models — nomic-embed-text + qwen2.5-coder:3b-q4_0 pulled
- [x] Qdrant + Redis containers running
- [x] Auth — `claude auth login` + `gh auth login`
- [x] SSE wiring — orchestrator lifecycle events → bus → SSE → dashboard (heartbeat, event IDs, reconnect)
- [x] Dashboard integration — Vite build, API server serves dist, `make dashboard` / `make dashboard-build`
- [x] Makefile unified — `make setup` delegates to `scripts/setup.sh` (single source of truth)
- [x] Setup script — added mandatory Ollama install + model pulls
- [x] Docker sandbox — Dockerfile (multi-stage base+sandbox), sandbox.manager.ts (container lifecycle, 2hr timeout, network isolation), docker-compose sandbox service
- [x] Slack webhook — NotificationsConfig type, env var support (SLACK_WEBHOOK_URL), SlackBot wired into orchestrator event bus, .env.example
- [x] Dashboard dark/light mode — theme toggle with localStorage persistence, full color system for both themes
- [x] Makefile lifecycle commands — `make up`/`down` (full stack), `make start` (build + serve daemon), TOM start/stop, dashboard-build
- [x] npm dashboard scripts — `dashboard`, `dashboard:build`, `dashboard:install` in package.json
- [x] Local dogfood pipeline — git worktree isolation, builder auto-commit, Claude blind review, Docker sandbox testing, CLUSTER_COMPLETE emission
- [x] Dashboard task management — task queue (3 lanes: In Progress/Awaiting Review/Completed), task detail with diff viewer, merge/reject actions
- [x] Task API endpoints — GET /api/tasks, GET /api/tasks/:id, GET /api/tasks/:id/diff, POST /api/tasks/:id/merge, POST /api/tasks/:id/reject
- [x] All dogfooding requires Dashboard merge/reject — no auto-merge for any complexity level
- [x] inbox.md file watcher — InboxWatcher (fs.watch + polling), HUMAN_DECISION events, wired into orchestrator lifecycle
- [x] KB consistency checker — KBConsistencyChecker (Git ↔ Qdrant sync), CLI `nanoprym kb sync/stats`, 6 tests
- [x] TOM Layer 2 (spaCy NLP) — NER preservation, advmod removal, filler adj removal, entity-aware compression
- [x] Dashboard tester integration — GET /api/testers endpoint, Tester Plugins card in Tools panel (availability status), Tests tab in task detail (pass/fail/skip counts, scanner sub-results, k6 metrics, error list), test summary badge on task cards
- [x] Multi-repo support — RepoManager (clone/register/list/remove), CLI `nanoprym repo add/list/remove`, `--repo` flag on `run`, API endpoints GET/POST /api/repos, per-project ledgers/KB/brain isolation via ProjectManager, 14 tests
- [x] LearningEngine wired into orchestrator — self-evolution loop connected (CLUSTER_COMPLETE → signal tracking → pattern detection → rule extraction)
- [x] Evolution + Dashboard enabled in config — `evolution.enabled: true`, `dashboard.enabled: true`
- [x] Dogfood pipeline bugfixes — 4 bugs fixed: (1) worker-validator/debug-workflow contextStrategy required PLAN_READY without a planner, (2) builder onComplete hook logic returned falsy on success (moved topic redirect from `logic` to `transform`), (3) agent result `data` lost during publish (result.data now included in message data field), (4) sandbox.isAvailable() didn't check image exists
- [x] Makefile `make stop` — now kills both tsx and compiled server processes, port-based fallback kill
