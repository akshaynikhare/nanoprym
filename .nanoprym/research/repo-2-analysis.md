# Zeroshot Deep-Dive Analysis

**Task**: 0.2
**Date**: 2026-03-19
**Source**: github.com/covibes/zeroshot (v5.4.0)
**Type**: Multi-agent orchestration engine for Claude, Codex, Gemini, OpenCode

---

## Executive Summary

Zeroshot is a production-grade, message-driven multi-agent orchestration engine built on event sourcing (SQLite ledger) with blind validation, crash recovery, and provider-agnostic execution. It's the closest existing system to what Nanoprym envisions. Key differences: Zeroshot is task-scoped (one issue → one cluster → done), while Nanoprym aims to be continuous (scan → fix → learn → evolve). This analysis maps every Zeroshot pattern to Nanoprym's spec and identifies what to adopt, adapt, and skip.

---

## 1. Architecture Overview

### Core Philosophy
- **Event sourcing**: All state is immutable messages in SQLite ledger
- **Blind validation**: Validators never see worker context — eliminates bias
- **Crash-recoverable**: Replay from ledger to resume interrupted work
- **Provider-agnostic**: Claude, Codex, Gemini, OpenCode swappable via config
- **Template-driven**: Cluster topology defined in JSON, resolved with `{{params}}`

### Layer Stack

```
CLI Commands (run, resume, status, logs, attach)
  ↓
Orchestrator (cluster lifecycle, recovery)
  ↓
Config Router (complexity × taskType → template)
  ↓
Template Resolver (JSON params → agent config)
  ↓
Agent Lifecycle (state machine per agent)
  ↓
Message Bus (EventEmitter + SQLite ledger)
  ↓
Provider Layer (CLI builder + output parser per provider)
  ↓
Isolation Manager (worktree / Docker / none)
```

---

## 2. Message Bus & Ledger (Event Sourcing)

### Implementation
- **SQLite** with WAL mode for concurrent reads
- Tables: `messages` indexed on `(cluster_id, topic, timestamp, sender)`
- In-memory LRU cache (1000 entries) for repeated queries
- Write-after-close guard prevents race conditions
- Configurable busy timeout (default 5s)
- `batchPublish()` for atomic multi-message transactions

### Message Schema
```
{ id, clusterId, topic, sender, content: { text, data }, metadata, timestamp }
```

### Topic Taxonomy
| Topic | Flow Direction | Purpose |
|-------|---------------|---------|
| ISSUE_OPENED | System → Planner | Bootstrap task |
| PLAN_READY | Planner → Worker | Plan with acceptance criteria |
| IMPLEMENTATION_READY | Worker → Validators | Ready for review |
| WORKER_PROGRESS | Worker → Worker | Self-continuation (not done yet) |
| VALIDATION_RESULT | Validator → Worker/Orchestrator | Approve/reject with evidence |
| STATE_SNAPSHOT | Snapshotter → All | Compact working memory |
| CLUSTER_OPERATIONS | Conductor → Orchestrator | Dynamic agent spawning |
| CLUSTER_COMPLETE | Orchestrator → System | All validators approved |

### Nanoprym Mapping
**Adopt**: Event sourcing is superior to Nanoprym's current PostgreSQL-only plan for task state. SQLite for per-task ledger, PG for aggregated metrics. This gives crash recovery + queryable history + event replay.

**Adapt**: Nanoprym needs additional topics for its unique flows:
- `SCAN_RESULT` (scanner findings)
- `AUTO_FIX_APPLIED` (auto-fix without approval)
- `EVOLUTION_PROPOSED` (self-evolution PR)
- `HUMAN_DECISION` (Slack response)

---

## 3. Cluster Topologies

### Template-Based Configuration (6 base templates)

| Template | When Used | Agents | Cost Profile |
|----------|----------|--------|-------------|
| single-worker | TRIVIAL tasks | 1 worker (level1) | Cheapest |
| worker-validator | SIMPLE tasks | worker + 1 validator (level2) | Low |
| full-workflow | STANDARD/CRITICAL | planner + worker + 2-4 validators | Medium-High |
| debug-workflow | DEBUG tasks | investigator + debugger + validators | Medium |
| quick-validation | Stage 1 (fast) | cheap validators | Low |
| heavy-validation | Stage 2 (thorough) | expensive validators | High |

### Conductor Pattern (Dynamic Routing)
Two-tier conductor system:
1. **Junior conductor** (level2/sonnet): Classifies task on complexity × taskType → routes to template
2. **Senior conductor** (level3/opus): Only activated for UNCERTAIN tasks — makes final classification

Classification dimensions:
- **Complexity**: TRIVIAL, SIMPLE, STANDARD, CRITICAL, UNCERTAIN
- **Task type**: INQUIRY (read-only), TASK (implement), DEBUG (fix)

Cost awareness is baked into classification prompts:
- "CRITICAL uses Opus ($15/M) + 4 validators = EXPENSIVE"
- "STANDARD uses Sonnet ($3/M) + 2 validators = NORMAL"
- "If unsure between STANDARD and CRITICAL, choose STANDARD"

### Conditional Agents
Agents can have `"condition": "{{validator_count}} >= 2"` — resolved at template time, agents not meeting condition are excluded.

### Nanoprym Mapping
**Adopt**: Complexity-based routing is exactly what Nanoprym needs:
- TRIVIAL bugs → auto-fix, no validator
- SIMPLE fixes → builder + 1 validator
- STANDARD features → planner + builder + 2 validators
- CRITICAL (auth/payments/security) → full pipeline + 4 validators

**Adapt**: Nanoprym should replace "junior/senior conductor" with a single `config-router.ts` module that uses the same complexity × taskType matrix but as code, not a separate LLM call (save the API cost for simple routing).

**Skip**: Two-tier conductor with LLM classification. For Nanoprym, task complexity should be set by the issue label or auto-detected from diff scope, not by burning a Sonnet call on every task.

---

## 4. Agent Lifecycle & State Machine

### States
```
idle → evaluating triggers → building context → executing task → idle
```

### Trigger System
Each agent defines triggers as topic + optional JavaScript logic:
```json
{
  "topic": "VALIDATION_RESULT",
  "logic": {
    "engine": "javascript",
    "script": "return responses.some(r => r.content?.data?.approved === false);"
  },
  "action": "execute_task"
}
```

The logic engine runs in a sandboxed JavaScript environment with:
- 1-second timeout
- Frozen prototypes (no prototype pollution)
- Ledger query API: `findLast`, `count`, `since`, `query`
- Cluster API: `getAgents()`, `getAgentsByRole(role)`
- Helpers: `allResponded`, `hasConsensus`, `timeSinceLastMessage`

### Context Pack Builder
Priority-based message selection with token budgeting:
- **Required**: Always included (issue, plan, state snapshot)
- **High**: Included if budget allows (validation results)
- **Medium**: Included if room (worker progress, previous attempts)
- **Low**: Only if spare budget

Token estimation: chars / 4 (conservative). Defensive max-chars guard at 500k.

Compact variants: If full message doesn't fit, try `compactAmount` (usually 1 latest message instead of 5).

### Stuck Detection
Multi-indicator scoring (not just output freshness):
- Process state (R=running vs S=sleeping)
- Wait channel (ep_poll = blocked on epoll)
- CPU usage over sample period
- Context switches (activity indicator)
- Network socket state (data in flight)
- Score ≥ 3.5 = likely stuck, ≥ 4.5 = high confidence

### Nanoprym Mapping
**Adopt**:
- Trigger system with JavaScript sandbox — elegant, composable, testable
- Context pack builder with priority + token budgeting — solves context window management
- Multi-indicator stuck detection — far better than timeout-only
- State snapshots as durable working memory across agent iterations

**Adapt**: Nanoprym's trigger system should additionally support cron-based triggers (for scanning) and file-watcher triggers (for local dev mode), not just message-topic triggers.

---

## 5. Provider Abstraction

### Interface
- Abstract base class with error classification (retryable vs permanent)
- Two execution paths: SDK (fast, API key) and CLI (slower, OAuth)
- Model level hierarchy: level1 (haiku), level2 (sonnet), level3 (opus)
- Per-provider level overrides in settings

### Providers Implemented
| Provider | Models | Auth |
|----------|--------|------|
| Claude (Anthropic) | haiku, sonnet, opus | ANTHROPIC_API_KEY / OAuth CLI |
| Codex (OpenAI) | gpt-4, gpt-4-turbo | OPENAI_API_KEY / CLI |
| Gemini (Google) | gemini-pro, gemini-1.5-pro | GOOGLE_API_KEY / gcloud |
| OpenCode | various | CLI |

### Error Classification
- **Retryable**: rate-limit, 429, timeout, network errors → exponential backoff
- **Permanent**: invalid key, unauthorized, model not found, context exceeded → fail fast
- Unknown errors → treated as retryable (fail-safe)

### Nanoprym Mapping
**Adopt**: Provider abstraction with error classification is exactly what Nanoprym needs for C03 (Multi-Model Routing). The level-based hierarchy maps to Nanoprym's "model per task type" from the spec.

**Adapt**: Nanoprym should add:
- Ollama as a local provider (for embeddings + cheap classification)
- Cost tracking per call (Zeroshot doesn't track actual costs)
- Provider health monitoring (track success rates per provider)

---

## 6. Isolation Modes

| Mode | Mechanism | Speed | Use Case |
|------|-----------|-------|----------|
| None | In-place file modification | Instant | Quick experiments |
| Worktree | `git worktree add` | <1 second | Default for PRs |
| Docker | Clone in container | ~30 seconds | Full isolation, CI |

### Docker Credential Mounting
Pre-configured mount presets:
- Default: gh, git, ssh
- AWS: ~/.aws + AWS_* env vars
- Azure: ~/.azure + AZURE_* env vars
- GCloud: ~/.config/gcloud + CLOUDSDK_* env vars
- Claude: ~/.claude + ANTHROPIC_API_KEY

### Nanoprym Mapping
**Adopt**: Worktree isolation as default — already in Nanoprym spec (C12). Zeroshot confirms this is the right choice: fast setup, full git integration, clean branch per task.

**Skip**: Docker isolation for regular tasks. Nanoprym should reserve Docker only for self-evolution sandboxing (already in spec).

---

## 7. Validation System (Blind Validation)

### Core Principle
Validators NEVER see the worker's chat history or context. They only receive:
- Original issue (ISSUE_OPENED)
- Plan (PLAN_READY)
- State snapshot (STATE_SNAPSHOT)
- Implementation signal (IMPLEMENTATION_READY)

They must independently discover what changed by reading the actual codebase.

### Validator Types in full-workflow

| Validator | Focus | Instant Reject Triggers |
|-----------|-------|------------------------|
| Requirements | Acceptance criteria verification | TODO/FIXME, "Phase 2 deferred", any MUST fails |
| Code | Architecture + DRY + clean design | God functions (>50 lines), DRY violations, backwards-compat shims |
| Security | OWASP Top 10, injection, auth bypass | Missing input validation, leaked secrets |
| Tester | Actually RUNS tests, not just reads them | Any test failure, missing coverage |

### Evidence-Based Validation
Each criterion result requires:
```json
{
  "id": "AC1",
  "status": "PASS|FAIL|CANNOT_VALIDATE",
  "evidence": { "command": "npm test", "exitCode": 0, "output": "..." },
  "reason": "for CANNOT_VALIDATE only"
}
```

### Two-Stage Validation (Critical tasks)
```
Worker → Quick Validators (cheap, fast) → Heavy Validators (expensive, thorough) → Done
```
Meta-coordinator dynamically loads quick-validation template, then heavy-validation template after quick passes.

### Worker Subsequent Prompt (After Rejection)
The "subsequent" prompt is intentionally harsh:
- "YOU FAILED. FIX IT."
- "Root cause, not symptoms"
- "Self-verification before resubmitting"
- Forces the worker to address EVERY validator error, not just some

### Nanoprym Mapping
**Adopt**:
- Blind validation is brilliant — prevents context poisoning and herd bias. Map to Nanoprym's Reviewer agent design.
- Evidence-based criteria results — map to Nanoprym's audit trail
- Two-stage validation for CRITICAL tasks — quick scanners first, then expensive review
- "Subsequent" prompt escalation — worker gets progressively more pointed feedback

**Adapt**: Nanoprym adds a Debate mechanism (Claude vs Copilot arguing). Zeroshot's validators don't debate — they just approve/reject. Nanoprym should add debate as an OPTIONAL step between validation rounds for CRITICAL tasks only.

---

## 8. State Snapshots (Durable Working Memory)

### Schema
```javascript
{
  task: { raw, title, issueNumber, source },
  plan: { text, summary, acceptanceCriteria, filesAffected },
  progress: { canValidate, percentComplete, blockers, nextSteps },
  validation: { approved, errors, criteriaResults },
  debug: { fixPlan, successCriteria, rootCauses }
}
```

### Update Triggers
- ISSUE_OPENED → populate task
- PLAN_READY → populate plan
- WORKER_PROGRESS → populate progress
- VALIDATION_RESULT → populate validation
- INVESTIGATION_COMPLETE → populate debug

### Size Guards
- Text fields: limited (task: 2000, plan: 2500, summary: 300 chars)
- List fields: limited (errors/blockers: 5, criteria: 10 items)
- Empty values pruned before publishing

### Nanoprym Mapping
**Adopt**: State snapshots solve the "context window bloat" problem. Instead of feeding all historical messages to agents, feed one compact snapshot. This is exactly what Nanoprym needs for long-running tasks.

---

## 9. Hook System

### Types
```json
{
  "onComplete": {
    "action": "publish_message",
    "config": { "topic": "...", "content": { ... } },
    "logic": { "engine": "javascript", "script": "..." },
    "transform": { "engine": "javascript", "script": "..." }
  }
}
```

### Hook Capabilities
- **action**: publish_message, execute_command
- **logic**: Conditional execution (return false = skip hook)
- **transform**: Dynamic topic/content generation based on result

### Example: Worker completion hook
```javascript
// If worker says canValidate=false → publish WORKER_PROGRESS (self-continue)
// If worker says canValidate=true → publish IMPLEMENTATION_READY (trigger validators)
if (!result.completionStatus?.canValidate) return { topic: 'WORKER_PROGRESS' };
```

### Nanoprym Mapping
**Adopt**: Hook system enables composable workflows without hardcoded agent-to-agent connections. Map to Nanoprym's plugin hooks (C20).

---

## 10. CLI Patterns

### Commands
```
zeroshot run <issue> [options]     # Start new cluster
zeroshot resume <id> [message]     # Resume from crash/failure
zeroshot status <id>               # Show cluster state
zeroshot logs <id> [-f]            # Stream cluster logs
zeroshot attach <id>               # Interactive attach to running cluster
zeroshot stop <id>                 # Graceful stop
zeroshot kill <id>                 # Force kill
zeroshot list                      # List all clusters
zeroshot providers                 # Show available providers
```

### Nanoprym Mapping
**Adopt**: CLI structure maps well to Nanoprym's Makefile commands:
- `zeroshot run` → `make task-run`
- `zeroshot resume` → `make task-resume` (new, should add to spec)
- `zeroshot status` → `make task-status`
- `zeroshot logs` → `make logs`

---

## 11. What Nanoprym Should Adopt

| # | Pattern | Zeroshot Source | Nanoprym Target |
|---|---------|----------------|-----------------|
| 1 | Event sourcing (SQLite ledger) | src/ledger.js | src/audit/event-ledger.ts |
| 2 | Message bus (pub/sub) | src/message-bus.js | src/core/message-bus.ts |
| 3 | Blind validation | full-workflow.json | Reviewer agent config |
| 4 | State snapshots | src/state-snapshot.js | src/core/state-snapshot.ts |
| 5 | Context pack builder | src/agent/context-pack-builder.js | src/core/context-builder.ts |
| 6 | Provider abstraction | src/providers/ | src/providers/ |
| 7 | Complexity × taskType routing | conductor-bootstrap.json | src/core/config-router.ts |
| 8 | Template-based agent configs | cluster-templates/ | prompts/ + configs/ |
| 9 | Trigger system (topic + logic) | src/agent/agent-trigger-evaluator.js | src/core/trigger-engine.ts |
| 10 | Multi-indicator stuck detection | src/agent/agent-stuck-detector.js | src/recovery/stuck-detector.ts |
| 11 | Worktree isolation | src/isolation-manager.js | src/git/worktree.manager.ts |
| 12 | Evidence-based validation | full-workflow.json validators | Reviewer output schema |
| 13 | Hook system | src/agent/agent-hook-executor.js | src/plugins/hook-executor.ts |
| 14 | Two-stage validation | quick/heavy templates | Validator pipeline |
| 15 | Crash recovery (ledger replay) | src/orchestrator.js | src/recovery/crash-recovery.ts |

## 12. What Nanoprym Should Skip

| # | Pattern | Why Skip |
|---|---------|----------|
| 1 | LLM-based task classification | Wastes API cost; use issue labels + diff analysis instead |
| 2 | Docker for every task | Overkill; reserve for self-evolution sandbox only |
| 3 | Multiple CLI providers (Codex, Gemini, OpenCode) | Nanoprym uses Claude only (locked decision); add others later via plugin |
| 4 | TUI (terminal UI) | Nanoprym uses Slack + VS Code + Dashboard instead |
| 5 | Issue providers (Jira, GitLab, Azure DevOps) | Start with GitHub only (locked decision); add later via plugin |

## 13. What Nanoprym Does That Zeroshot Doesn't

| # | Nanoprym Unique Feature | Gap in Zeroshot |
|---|------------------------|----------------|
| 1 | Self-evolution engine | Zeroshot has no learning/adaptation |
| 2 | Knowledge base (triple sync: Git/PG/Qdrant) | Zeroshot has no persistent KB |
| 3 | Prompt versioning with scoring | Zeroshot uses static prompts |
| 4 | Continuous scanning (not just issue-triggered) | Zeroshot is reactive only |
| 5 | Human-in-loop debate (Claude vs Copilot) | Zeroshot validators don't debate |
| 6 | Auto-generated docs (RCA, ADR, API docs) | Zeroshot doesn't generate docs |
| 7 | Cost tracking per task/model/project | Zeroshot has cost awareness in prompts but no tracking |
| 8 | Dashboard with metrics | Zeroshot has CLI-only monitoring |
| 9 | Prime-step backtracking (1, 3, 5, 7) | Zeroshot has simple retry loops |
| 10 | Brain hierarchy (L0/L1/L2/L3) | Zeroshot has flat prompt system |

---

## 14. Implementation Complexity Assessment

| Feature | Complexity | LOC Estimate | Dependencies |
|---------|-----------|-------------|--------------|
| Message bus + SQLite ledger | Medium | ~400 | better-sqlite3 |
| Provider abstraction (Claude only) | Low | ~200 | Claude SDK |
| Template resolver | Low | ~150 | None |
| Trigger engine (topic + JS sandbox) | Medium | ~300 | vm2 or isolated-vm |
| Context pack builder | Medium | ~350 | Token counter |
| State snapshotter | Low | ~200 | None |
| Agent lifecycle (state machine) | Medium | ~400 | None |
| Stuck detector | Medium | ~250 | process monitoring |
| Worktree isolation | Low | ~150 | git CLI |
| Config router (complexity × taskType) | Low | ~100 | None |
| Hook executor | Low | ~150 | None |
| Blind validation system | Medium | ~300 | Template configs |
| Crash recovery (ledger replay) | Medium | ~300 | SQLite ledger |
| **Total adoptable core** | | **~3,250** | |

---

## 15. Recommended Adoption Order for Nanoprym

### Phase 1 (Foundation — must have before anything else)
1. Message bus + SQLite ledger (event sourcing backbone)
2. Provider abstraction (Claude provider only)
3. Agent lifecycle state machine
4. Template resolver

### Phase 2 (Orchestration — makes agents work together)
5. Trigger engine
6. Context pack builder with token budgeting
7. Config router (complexity × taskType)
8. Hook executor

### Phase 3 (Robustness — production quality)
9. State snapshotter
10. Stuck detector
11. Worktree isolation
12. Crash recovery via ledger replay

### Phase 4 (Validation — quality gates)
13. Blind validation system
14. Evidence-based validation schema
15. Two-stage validation pipeline

---

## Appendix: Files Analyzed

```
src/orchestrator.js
src/task-runner.js
src/claude-task-runner.js
src/ledger.js
src/message-bus.js
src/isolation-manager.js
src/config-validator.js
src/config-router.js
src/logic-engine.js
src/state-snapshot.js
src/agent/agent-lifecycle.js
src/agent/agent-task-executor.js
src/agent/agent-config.js
src/agent/agent-stuck-detector.js
src/agent/validation-platform.js
src/agent/agent-trigger-evaluator.js
src/agent/guidance-queue.js
src/agent/context-pack-builder.js
src/providers/base-provider.js
src/providers/anthropic/index.js
src/providers/anthropic/cli-builder.js
src/providers/index.js
src/template-resolver.js
cluster-templates/base-templates/*.json
cluster-templates/conductor-bootstrap.json
README.md
CLAUDE.md
docs/context-management.md
docs/providers.md
package.json
```
