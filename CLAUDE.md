# Nanoprym

Self-evolving AI agent orchestration system. Scans repos, finds bugs/improvements, auto-fixes, proposes features, builds approved tasks via multi-agent pipeline, and evolves its own prompts over time.

**Current Stage**: Post-Phase 3 — Local Dogfood Pipeline Ready
**Version**: 0.1.0
**Stats**: 69 source files, ~11,000 LOC, 172/172 tests passing, 18 modules, 18 plugins, 4 agent types
**Spec**: `specs/NANOPRYM-SPEC-v2.md` (authoritative, all decisions/architecture live here)

## Tech Stack

- **Runtime**: TypeScript 5.6+ (ES2022/NodeNext), Node 18+
- **AI**: Claude API (sonnet), Ollama (local embeddings), Claude blind review
- **Infra**: Redis (queue/cache via BullMQ + ioredis), SQL.js (event ledger), Qdrant (vector DB)
- **Dashboard**: React + Vite (port 9091 API, SSE streaming, dark/light mode, task queue + merge/reject UI)
- **Testing**: Vitest (60% statement, 80% branch coverage)
- **TOM Sidecar**: Python 3.10+ for token compression

## Architecture

- **Event Sourcing** — all actions are immutable events in SQLite ledger → crash recovery via replay
- **Pub/Sub** — EventBus (eventemitter3) routes messages between agents by topic, no direct agent coupling
- **Multi-Agent Pipeline** — Planner → Builder → Reviewer → Validator (configurable workflow templates)
- **Cascading Prompts** — L0 Prime > L1 Project > L2 Module > L3 Task
- **Token-Aware** — TOM sidecar compresses context; budgets: planner 100k, builder 200k, reviewer 50k, validator 50k
- **Multi-Repo** — RepoManager clones/registers repos, ProjectManager isolates per-project ledgers/KB/brain

## Project Structure

```
src/
  _shared/     # Types, constants, logger
  agents/      # Planner, Builder, Reviewer, Validator (BaseAgent subclasses)
  core/        # EventBus, EventLedger, Orchestrator, TaskQueue, InboxWatcher
  cli/         # Commander-based CLI (nanoprym command)
  http/        # Health server + API server (REST + SSE)
  config/      # Config loading, workflow routing, ProjectManager
  providers/   # Claude provider (AI model interface)
  plugins/     # Scanners, testers, generators
  git/         # Worktree management, commits, PRs
  tom/         # Token Optimization Module (Python sidecar)
  knowledge/   # Knowledge base (Qdrant integration)
  repos/       # RepoManager (clone, register, list, remove repos)
  metrics/     # Cost tracking
  security/    # Secrets scanning, Docker sandbox
  evolution/   # LearningEngine, PromptVersioner, RuleExtractor
  recovery/    # RollbackManager (cascade-aware evolution rollback)
dashboard/     # React + Vite web dashboard (dark/light mode)
tests/         # Vitest suite + fixtures
prompts/       # Agent prompt templates
rules/         # Validation rules
.nanoprym/     # Runtime data (ledgers, KB, research, repos, projects)
```

## Conventions

- **Path aliases**: `@core/*`, `@agents/*`, `@providers/*`, `@shared/*`, `@plugins/*`
- **Agent pattern**: static `createConfig()` for defaults, constructor for DI
- **Logger**: `createChildLogger(name)` per module
- **Git**: conventional commits, worktree isolation per task, branch prefix `nanoprym/`
- **Config**: YAML-based (`nanoprym.config.yaml`), env overrides via `process.env`
- **Strict TS**: noUnusedLocals, noUnusedParameters, noImplicitReturns, strictNullChecks

## Key Commands

```bash
# Makefile (preferred)
make up              # start everything: infra + TOM + nanoprym
make down            # stop everything
make start           # build + start nanoprym daemon
make dashboard       # dev server on localhost:3000
make dashboard-build # production build

# npm scripts
npm run build        # tsc compile
npm run dev          # dev mode (watch)
npm test             # vitest
npm run lint         # eslint
npm run start        # run nanoprym
npm run dashboard    # dashboard dev server

# Repo management
nanoprym repo add <url|path>   # clone or register a repo
nanoprym repo list             # list registered repos
nanoprym repo remove <name>    # unregister a repo
nanoprym run "desc" --repo <n> # run task against specific repo
```

## Key Files

| File | Purpose |
|------|---------|
| `src/core/orchestrator.ts` | Task lifecycle: receive → route → plan → build → review → commit |
| `src/core/event-ledger.ts` | SQLite-backed immutable event store |
| `src/core/event-bus.ts` | Pub/Sub routing between agents |
| `src/repos/repo.manager.ts` | Clone, register, list, remove target repos |
| `src/config/project.config.ts` | Per-project isolation (ledgers, KB, brain) |
| `src/evolution/learning.engine.ts` | Outcome tracking, signal detection, pattern extraction |
| `src/cli/cli.entry.ts` | CLI commands (run, serve, repo, rollback, kb, tom, etc.) |
| `src/http/api.server.ts` | REST API + SSE + task/repo CRUD |
| `src/_shared/types.ts` | Core type definitions |
| `src/_shared/constants.ts` | Versions, paths, token budgets |
| `nanoprym.config.yaml` | Main configuration |

## Multi-Repo Architecture

```
~/.nanoprym/
├── repos/                    # Cloned repos live here
│   ├── my-app/
│   └── another-project/
├── projects/                 # Per-project isolated data
│   ├── my-app/
│   │   ├── project.brain.md  # L1 project brain
│   │   ├── modules/          # L2 module brains
│   │   ├── kb/               # Project-specific KB
│   │   └── ledgers/          # Task event ledgers
│   └── another-project/
├── inbox.md                  # Human decision inbox
├── prime.brain.md            # L0 prime brain
├── nanoprym.db               # Health + metrics DB
└── kb/                       # Global KB
```
