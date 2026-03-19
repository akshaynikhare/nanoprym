# Nanoprym MVP Scope: All 20 Concerns

## Overview

All 20 architectural concerns are incorporated into the Nanoprym MVP and product roadmap, distributed across three phases:

- **Phase 1**: Core agent orchestration loop (11 concerns)
- **Phase 2**: Ecosystem and human integration (7 concerns)
- **Phase 3**: Advanced evolution and extensibility (2 concerns)

---

## Concern Catalog

### **C01: Agent Orchestration**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- Message-driven agent coordination via in-memory event bus
- SQLite-backed ledger for task state and decision history
- Agent lifecycle management (spawn, execute, retire)
- Trigger engine: time-based and event-based task initiation
- Single orchestrator process managing all active agents

**Full Version** (Future):
- Multi-process orchestration with load balancing
- Distributed event bus (e.g., RabbitMQ, Kafka)
- Hierarchical agent supervision (parent-child agent trees)
- Dynamic agent pool scaling based on queue depth
- Persistent message replay and recovery

**Rationale**: MVP establishes the message-driven architecture foundation. Scaling and distribution deferred to Phase 2–3.

---

### **C02: Task Management**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- BullMQ for persistent job queue (backed by Redis)
- Sequential task execution per project
- Job status tracking (queued, running, completed, failed)
- Basic retry on transient failures
- In-process job consumption with configurable concurrency (1 by default)

**Full Version** (Future):
- Parallel task execution with dependency graphs (DAGs)
- Priority-based scheduling
- Task grouping and rollup (batch N tasks into a single composite task)
- Worker pool abstraction for horizontal scaling
- Task cancellation and timeout enforcement

**Rationale**: MVP delivers deterministic, auditable task execution. Parallelization deferred until Phase 2.

---

### **C03: Multi-Model Routing & TOM**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- Task Orchestration Module (TOM) as Python sidecar service
- Model selection logic: route to Claude, Copilot CLI, or Ollama based on task type
- Compression pipeline: transform prompts to minimize token use (semantic summarization, code tree walks)
- Cost tracking per model invocation
- Simple router: hardcoded decision rules (code gen → Claude Code, review → Copilot, embedding → Ollama)

**Full Version** (Future):
- Learned routing: ML-based model selection using historical cost/latency/quality metrics
- Dynamic compression strategy: test multiple compression levels and pick optimal
- Model fallback chains (e.g., if Claude unavailable, use Copilot)
- A/B testing infrastructure for model comparison
- Provider abstraction layer for new model additions

**Rationale**: MVP establishes routing framework and compression baseline. Learned routing deferred to Phase 3 (Self-Evolution).

---

### **C04: Audit Trail**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- SQLite event ledger: immutable log of all decisions, agent actions, and outcomes
- Event schema: timestamp, agent ID, action type, input, output, cost, decision rationale
- Query interface: retrieve events by agent, task, or time range
- Human-readable event export (JSON, CSV)
- No automatic retention limits (manual cleanup)

**Full Version** (Future):
- PostgreSQL migration for scale (Phase 2)
- Retention policies and archival (cold storage)
- Real-time event streaming for dashboards
- Event-driven hooks for external systems (webhooks, Slack notifications)
- Advanced search and filtering (full-text, faceted)

**Rationale**: MVP captures all critical data. PostgreSQL migration and automation deferred to Phase 2.

---

### **C05: Self-Evolution Engine**

**Phase Assignment**: Phase 3 (Advanced)

**MVP Version** (Phase 1–2 Prep):
- Collect metrics during Phase 1–2: execution time, token cost, success rate, human feedback
- Log all outcomes and decisions to audit trail
- Export metrics for offline analysis
- Manual review of metrics to inform prompt tuning

**Full Version** (Phase 3):
- Automated prompt optimization: use Claude to iterate on .system.md files based on collected metrics
- Dynamic model routing: retrain TOM router based on cost/quality tradeoffs observed
- Agent capability expansion: automatically add new tools or refine existing triggers
- Feedback loop closure: embed human feedback (Slack approvals, manual corrections) into continuous improvement
- A/B test harness: compare variants of prompts or routing strategies in production

**Rationale**: Requires two phases of data collection before Phase 3 automation can be effective. MVP lays groundwork.

---

### **C06: Human-in-Loop**

**Phase Assignment**: Phase 2 (Ecosystem)

**MVP Version**:
- Slack Bolt.js integration via webhook
- Four channels: #nanoprym-status (all tasks), #nanoprym-approvals (high-risk decisions), #nanoprym-alerts (failures), #nanoprym-logs (verbose trace)
- Approval UI: Slack button interactions (✅ Approve, ❌ Reject, 🔄 Modify & Resubmit)
- Blocking gates: high-risk operations (e.g., deleting branches, merging to main) require explicit human approval before execution
- Response timeout: 1 hour; auto-reject if no approval received

**Full Version** (Future):
- Email integration (threading, rich formatting)
- Dashboard UI for approvals (web interface)
- Customizable approval rules: define which operations require human gates
- Escalation workflows: route to on-call teams if escalation required
- Audit trail integration: link approvals to decisions in audit ledger

**Rationale**: MVP delivers core blocking approval. Dashboard and advanced routing deferred.

---

### **C07: Knowledge Base**

**Phase Assignment**: Phase 2 (Ecosystem)

**MVP Version**:
- Qdrant vector database for semantic search over embeddings
- Source: Git markdown files in project root and `/.nanoprym/docs/`
- Sync mechanism: triple-sync pattern (Git → local → Qdrant) triggered on task start and hourly
- Embedding model: Nomic Embed Text V2 via Ollama (10–30ms latency per embedding)
- Search interface: retrieve top-K relevant documents for agent context
- No full-text indexing or advanced ranking

**Full Version** (Future):
- Hybrid search: vector similarity + keyword matching (BM25)
- Incremental updates: only re-embed changed documents
- Metadata tagging: document categories, importance scores, ownership
- Semantic caching: avoid re-embedding identical passages
- Integration with code symbol index (AST-based doc generation)

**Rationale**: MVP enables semantic retrieval. Full-text and hybrid search deferred to Phase 2+.

---

### **C08: Code Generation**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- Claude Code CLI integration: invoke with `-p` flag, `--allowedTools` sandbox, structured output
- Builder agent: orchestrates code generation via Anthropic API (or Claude Code for advanced synthesis)
- Output validation: linting, type checking, import resolution
- Version tracking: Git commits each generated artifact with structured metadata
- Single-language support: prioritize Python (easily extended)

**Full Version** (Future):
- Multi-language code gen (TypeScript, Go, Rust, etc.)
- Contextual code libraries: generate and maintain domain-specific code templates
- Interactive refinement: allow agents to iterate based on test feedback
- Plugin architecture for custom generators

**Rationale**: MVP generates code via Claude and Copilot. Extensibility deferred.

---

### **C09: Code Review**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- GitHub Copilot CLI blind review: invoke via `gh pr edit --add-reviewer @copilot`
- Review scope: PR diffs only (no full file context)
- Automated pass/fail: Copilot recommendations inform approval decision
- No human code review in Phase 1 (deferred to Phase 2 optional manual gate)
- Result reporting: review summary posted as PR comment

**Full Version** (Future):
- Multi-reviewer consensus (Copilot + human reviewers)
- Configurable review strictness
- Custom review prompts for domain-specific concerns
- Integration with C06 (Human-in-Loop) for escalations
- Metrics on review acceptance rate and false positive rate

**Rationale**: MVP uses Copilot blind review. Human review gates deferred.

---

### **C10: Testing Automation**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- Vitest runner for unit/integration test execution
- Coverage instrumentation: track code coverage % per task
- Automated test generation: Claude-generated test cases (mock-based)
- Pass/fail verdict as task gate: failing tests block task completion
- Coverage reports: human-readable summaries, stored in audit trail

**Full Version** (Future):
- E2E test execution (Playwright, Cypress)
- Performance benchmarking and regression detection
- Flaky test detection and isolation
- Test result trending and visualization
- Integration with C15 (Metrics & Reporting) for dashboard display

**Rationale**: MVP covers unit/integration testing. E2E and performance defer to Phase 2+.

---

### **C11: Git Workflow**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- Worktree isolation: each agent task operates in a separate Git worktree (no merge conflicts)
- Conventional commits: enforce message format (`feat:`, `fix:`, `test:`, etc.)
- PR creation automation: agents create PRs with structured titles and descriptions
- Branch protection: main branch requires Copilot review pass before merge
- Cleanup: automatic worktree deletion on task completion

**Full Version** (Future):
- Merge strategy selection (squash, rebase, merge commit)
- Conflict resolution automation (semantic merge)
- Release automation (version bumping, changelog generation)
- Multi-branch strategies (staging, production pipelines)

**Rationale**: MVP establishes deterministic, isolated workflow. Advanced merge strategies deferred.

---

### **C12: Project Isolation**

**Phase Assignment**: Phase 2 (Ecosystem)

**MVP Version**:
- Single-project operation in MVP
- Per-project brain structure: each project has its own SQLite ledger, knowledge base, config
- Project root detection: `.nanoprym/config.yaml` marks project boundary

**Full Version** (Future):
- Multi-project orchestration: manage N projects with shared infrastructure
- Cross-project task dependencies and communication
- Organization-level metrics and dashboards
- Shared prompt libraries (org-level vs. project-level)
- Project templates for quick onboarding

**Rationale**: MVP focuses on single project. Multi-project support scales in Phase 2.

---

### **C13: Error Recovery**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- Retry-with-reflection: up to 3 attempts on task failure
- Reflection logic: Claude analyzes failure, proposes fix to prompt or approach
- Stuck detection: if all 3 retries fail, mark task as stuck (requires human intervention)
- Prime-step backtracking: revert to last known-good agent state and retry from checkpoint
- Minimal instrumentation: errors logged with stack traces and context

**Full Version** (Future):
- Circuit breaker pattern for cascading failures
- Partial success handling (execute recoverable subset of task)
- Automated rollback for side-effect operations
- Machine learning–based failure prediction and prevention
- Detailed failure taxonomy and mitigation strategies

**Rationale**: MVP covers basic retry and reflection. Sophisticated strategies deferred.

---

### **C14: Prompt Management**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- Versioned `.system.md` files: system prompts stored in Git with version history
- Brain hierarchy (L0–L3):
  - **L0**: Base instructions (agent role, core capabilities)
  - **L1**: Task-specific context (e.g., "code gen" vs. "testing")
  - **L2**: Domain context (project structure, conventions, dependencies)
  - **L3**: Instance context (current task state, recent decisions)
- Template variables: inject dynamic values (project name, branch, recent errors) into prompts
- No automated prompt evolution in Phase 1 (deferred to Phase 3)

**Full Version** (Future):
- Prompt versioning and rollback
- A/B testing infrastructure for prompt variants
- Automated optimization (Phase 3: Self-Evolution)
- Prompt composition from reusable modules
- Semantic similarity search for finding related prompts

**Rationale**: MVP establishes hierarchy and templates. Evolution deferred to Phase 3.

---

### **C15: Metrics & Reporting**

**Phase Assignment**: Phase 2 (Ecosystem)

**MVP Version**:
- Metrics collection: latency, token cost, success rate per task, per agent type
- Cost tracking: cumulative spend across Claude API, Copilot, Ollama invocations
- Autonomy curve: % of decisions made without human approval over time
- Export interface: JSON/CSV export of metrics
- Manual dashboard: spreadsheet-based view of key metrics

**Full Version** (Future):
- Web-based dashboard: real-time metrics visualization
- Trend analysis: identify bottlenecks, cost drivers, quality improvements
- Alerting: trigger notifications on anomalies (cost spike, success rate drop)
- Forecasting: project future token spend and operational costs
- Segmentation: break down metrics by project, agent type, decision category

**Rationale**: MVP collects and exports data. Interactive dashboard deferred to Phase 2.

---

### **C16: Configuration**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- YAML configuration: `.nanoprym/config.yaml` for project settings
- Settings: API keys, model selection, retry policy, approval thresholds, rate limits
- Per-project overrides: environment-specific configs (dev vs. prod)
- Secrets management: read from `NANOPRYM_*` environment variables, never hardcode
- No hot-reload: configuration changes require agent restart

**Full Version** (Future):
- Configuration versioning and rollback
- Hot reload: apply config changes without restart
- Config validation schema
- Multi-environment templates (dev, staging, production)
- Configuration drift detection

**Rationale**: MVP covers basic config management. Advanced features deferred.

---

### **C17: Security**

**Phase Assignment**: Phase 1 (Core)

**MVP Version**:
- Secrets scanning: block commits containing API keys, tokens, credentials using pre-commit hooks
- Safe command execution: whitelist subprocess calls, prevent code injection
- `.gitignore` enforcement: ensure sensitive files are never staged
- Environment variable isolation: agent processes inherit only whitelisted vars
- Audit logging: all privileged operations logged with timestamp and authorization

**Full Version** (Future):
- Role-based access control (RBAC) for approval gates
- Encryption at rest for sensitive configuration
- Network isolation (if multi-agent deployment)
- Compliance reporting (SOC2, ISO 27001)
- Automated penetration testing

**Rationale**: MVP covers prevention and detection. Encryption and compliance defer to Phase 2+.

---

### **C18: Persistence (PostgreSQL)**

**Phase Assignment**: Phase 2 (Ecosystem)

**MVP Version** (Phase 1):
- SQLite for structured data: task history, agent logs, metrics
- Single-file database: portable, no setup overhead
- Schema versioning: handle migrations manually

**Full Version** (Phase 2 and beyond):
- PostgreSQL migration: scalable, multi-user, replication-ready
- Automatic schema migrations (Alembic or Flyway)
- Connection pooling and optimization
- Backup and recovery procedures
- Multi-tenant data isolation (if supporting multiple orgs)

**Rationale**: MVP uses SQLite for simplicity. PostgreSQL scales with multi-project support in Phase 2.

---

### **C19: CLI Interface**

**Phase Assignment**: Phase 2 (Ecosystem)

**MVP Version** (Phase 1):
- Makefile-based CLI: `make run-task`, `make review`, `make status`, etc.
- Limited subcommands: focus on core operations
- Output: plain text and JSON export

**Full Version** (Phase 2 and beyond):
- Full `nanoprym` CLI with subcommands:
  - `nanoprym task create <task-id>` — start a new task
  - `nanoprym task status <task-id>` — get task state
  - `nanoprym config set <key> <value>` — update configuration
  - `nanoprym metrics export` — export metrics
  - `nanoprym brain inspect` — query knowledge base
  - `nanoprym log tail` — stream task logs
- Interactive mode: REPL-like interface for testing prompts
- Shell completion (bash, zsh, fish)

**Rationale**: MVP uses Makefile for simplicity. Full CLI scaffolding deferred to Phase 2.

---

### **C20: Plugin System**

**Phase Assignment**: Phase 2–3 (Advanced)

**MVP Version** (Phase 1):
- No plugin system (hardcoded integrations)
- Extensibility by code modification only

**Full Version** (Phase 2):
- Plugin architecture: scanners, testers, providers, generators
- **Scanners**: analyze code for issues (linting, security, quality gates)
- **Testers**: generate and execute test suites
- **Providers**: fetch external data (APIs, databases, documentation)
- **Generators**: create artifacts (code, configs, docs)
- Plugin discovery: filesystem scanning for `.plugin.json` manifests
- Plugin versioning and dependency resolution
- Sandboxed plugin execution (subprocess isolation)

**Full Version** (Phase 3):
- Plugin marketplace: share and discover community plugins
- Plugin auto-update mechanism
- Revenue/credit system for premium plugins
- Plugin performance profiling and optimization

**Rationale**: MVP operates with built-in integrations. Extensibility scales in Phase 2–3.

---

## Phase Summary

### Phase 1: Core Agent Loop (11 Concerns)
Delivers a functional, autonomous agent orchestration system with code generation, review, and testing. Suitable for single-project use.

| ID | Concern | Status |
|----|---------|--------|
| C01 | Agent Orchestration | ✅ Full |
| C02 | Task Management | ✅ Full |
| C03 | Multi-Model Routing & TOM | ✅ Full |
| C04 | Audit Trail | ✅ Full |
| C08 | Code Generation | ✅ Full |
| C09 | Code Review | ✅ Full |
| C10 | Testing Automation | ✅ Full |
| C11 | Git Workflow | ✅ Full |
| C13 | Error Recovery | ✅ Full |
| C14 | Prompt Management | ✅ Full |
| C16 | Configuration | ✅ Full |
| C17 | Security | ✅ Full |

**Delivery Target**: Q2 2026 (12 weeks)

---

### Phase 2: Ecosystem & Scale (7 Concerns)
Adds human-in-loop approvals, knowledge base, project isolation, metrics, CLI, and PostgreSQL scaling.

| ID | Concern | Status |
|----|---------|--------|
| C05 | Self-Evolution Engine | 🔧 Prep (collect data) |
| C06 | Human-in-Loop | ✅ MVP |
| C07 | Knowledge Base | ✅ MVP |
| C12 | Project Isolation | ✅ MVP |
| C15 | Metrics & Reporting | ✅ MVP |
| C18 | Persistence (PG) | ✅ Migration |
| C19 | CLI Interface | ✅ MVP |
| C20 | Plugin System | 🔧 Prep (architecture) |

**Delivery Target**: Q3 2026 (12 weeks)

---

### Phase 3: Advanced & Evolution (2 Concerns)
Completes self-evolution automation and plugin marketplace.

| ID | Concern | Status |
|----|---------|--------|
| C05 | Self-Evolution Engine | ✅ Full |
| C20 | Plugin System | ✅ Full |

**Delivery Target**: Q4 2026 (8 weeks)

---

## Conclusion

All 20 concerns are addressed in the MVP roadmap. Phase 1 focuses on the core autonomous loop. Phase 2 adds ecosystem maturity. Phase 3 enables self-improvement and community extensibility. This staged approach balances feature velocity with stability and risk.
