# NANOPRYM -- Complete System Specification v2.0

Version: 2.0.0
Date: 2026-03-19
Author: Akshay Nikhare
Status: All Phases Complete — Ready for MacBook Deployment
Repository: github.com/nanoprym
Package: @nanoprym/core
CLI: nanoprym
Config Dir: .nanoprym/

---

## CHANGELOG from v1 to v2

**This document is the FINAL spec that Phase 1 builds from. All Phase 0 research findings are incorporated.**

### Architecture Changes
- **Added C21**: Token Optimization Module (TOM) with Python sidecar (~/src/tom/)
- **Updated C03**: "Multi-Model Routing + TOM Integration"
- **New subsections 4.1–4.3**: Event Sourcing Backbone, Message Bus, TOM Integration Layer
- **New subsection 21.5**: Full Token Optimization Module specification

### Decision Updates (D02, D03, D09, D13, D14, D20, D23)
- **D02**: Claude Code CLI = primary coder (via Claude Max subscription, zero marginal cost)
- **D03**: GitHub Copilot = code review after PR creation (blind review, no debate). Claude Sonnet as fallback reviewer.
- **D09**: On failure: retry-with-reflection (max 3 attempts), think before retry, then escalate
- **D13**: CHANGED — Simplified blind review. No debate mechanism. Reviewer provides critique → Builder fixes → re-review if rejected → escalate after 2 rejections.
- **D14**: Testing: 60% overall coverage, 80% branch coverage (reduced from 95%)
- **D20**: Triple-sync KB: Git markdown (source of truth) + Qdrant vectors + SQLite (Phase 1) → PostgreSQL (Phase 2). Git is authoritative; others are derived indexes.
- **D23**: Prompt versioning with scoring, auto-revert if worse after 25 tasks (increased from 10)

### New Decisions (D24–D36)
- **D24**: Subscription cost model: Claude Max ($200/mo) + Copilot Pro+ ($39/mo) + TOM cloud cap ($5/mo)
- **D25**: TOM routing: First-time code gen + complex ops → Claude directly. Iterations → TOM compression. Auxiliary → TOM routing to cheapest model.
- **D26**: Event sourcing: SQLite ledger per task for crash recovery + audit replay
- **D27**: Message bus: Agent-to-agent communication via pub/sub (not direct calls)
- **D28**: Blind validation: Reviewers never see builder's reasoning/chat history
- **D29**: Context builder: Priority-based context assembly with token budgeting per agent call
- **D30**: State snapshots: Compact working memory updated on every phase transition
- **D31**: Non-interactive execution: All agents must run without user prompts
- **D32**: Python sidecar for TOM (spaCy NLP, ~50MB RAM, Unix socket communication)
- **D33**: Hardware target: MacBook M1 Pro, 16GB RAM. Ollama runs natively (Metal GPU).
- **D34**: All 20 concerns in MVP. No cuts. Full spec = MVP.
- **D35**: AI-assisted build from day 1. Claude Code generates scaffolding, human reviews.
- **D36**: Dogfooding: Nanoprym is the first target project.

### Section 5: Brain Hierarchy (Context Assembly)
- Added specific context assembly order for each agent call
- Added token budget enforcement per agent role
- Priority-based context loading (L0/L1 required, L2 high priority, etc.)

### Section 11: Agent Orchestration Flow — REPLACED
- New workflow with Config Router for complexity × taskType classification
- TRIVIAL tasks skip planner
- New message bus topics (ISSUE_OPENED, PLAN_READY, IMPLEMENTATION_READY, etc.)
- Scanner plugins run deterministically before Copilot review

### Section 12: Code Review Flow — SIMPLIFIED
- Removed debate mechanism
- Blind review: Copilot never sees builder context
- Max 2 iterations, then escalate to Slack with human decision
- Clear structured validation result output

### Section 13: Error Recovery — UPDATED
- Mandatory think step (Reflect agent reasoning about root cause)
- Renamed from prime-step backtracking to reflect-retry-escalate
- Cross-task failure handling with context guard (60% threshold)

### Section 20: Storage Stack — UPDATED
- Added SQLite as Phase 1 primary (PostgreSQL Phase 2)
- Clarified Qdrant, Redis, Ollama roles
- All components with specific model versions and RAM budgets

### Section 28: Technology Stack — EXPANDED
- Added Python (TOM sidecar)
- Added SQLite (Phase 1)
- Clarified Node.js 18+, TypeScript, React
- Added specific Ollama models: Nomic Embed Text V2 (embeddings), Qwen2.5-Coder-3B Q4 (local inference)

### Section 29: Prime Brain Template — ADDED
- New "Non-Interactive Execution" section (agents run without user prompts)
- New "Context Management" section (read before edit, token budgeting)
- New "Blind Review Protocol" section

### Section 30: Build Phases — COMPLETELY REPLACED
- Phase 0: Research ✅ COMPLETE
- Phase 1: Foundation + Core Agent Loop (Weeks 1–4) with week-by-week breakdown
- Phase 2: Ecosystem (Weeks 5–8)
- Phase 3: Evolution + Plugins (Weeks 9–12)
- Detailed deliverables per week
- Explicit dogfooding: "DOGFOOD: Nanoprym processes its first real issue on itself" at end of Week 4

### Removed Sections
- Old Sections 31–35 (Reporting, Analytics, Infrastructure, Tiered Execution) — partially integrated, partially deferred to Phase 2

### Cost Model
- Monthly fixed cost: ~$243/month (Claude Max + Copilot Pro+)
- Variable cost cap: $5/month (TOM cloud)
- **Grand total: ~$248/month**
- Cost per task (amortized): ~$2.25 at 110 tasks/month (~5/day)
- All details in new Section 31: Cost Model

---

## Table of Contents

1. Overview
2. System Concerns
3. Locked Decisions
4. Architecture
5. Brain Hierarchy
6. Source Code Structure
7. Workspace Structure
8. Task Management
9. Spec-Driven Development
10. Feature Tracking
11. Agent Orchestration Flow
12. Code Review Flow
13. Error Recovery
14. Self-Evolution Engine
15. Audit Trail
16. Knowledge Base
17. Prompt Management
18. Metrics and Reporting
19. Plugin System
20. Storage Stack
21. Git Workflow and CI
22. Communication
23. Dashboard
24. Documentation Standards
25. Makefile Standards
26. Naming Conventions
27. DRY Rules
28. Technology Stack
29. Prime Brain Template
30. Build Phases
31. Cost Model

---

## 1. Overview

Nanoprym is a self-evolving AI agent orchestration system. It builds software projects autonomously while improving itself over time. It encodes the architectural brain, coding style, and decision-making patterns of its operator into a hierarchical prompt system.

Core loop:

```
Scan repos continuously
  Find bugs, issues, improvements, inspirations
  Auto-fix bugs, security, test failures
  Propose new features for human approval
  Build approved tasks sequentially using AI agents
  Learn from every outcome and human correction
  Evolve its own prompts, rules, and workflows weekly
```

Two evolution targets:
- META: Nanoprym improves itself (prompts, routing, workflows, validators, its own code)
- PROJECT: Projects get better (KB grows, tests expand, patterns reused)

---

## 2. System Concerns

```
ID    Concern                  Directory
----  -----------------------  ---------------------------
C01   Agent Orchestration      src/core/
C02   Task Management          src/core/
C03   Multi-Model Routing+TOM  src/providers/ + src/tom/
C04   Audit Trail              src/audit/
C05   Self-Evolution Engine    src/evolution/
C06   Human-in-Loop            src/notifications/
C07   Knowledge Base           src/knowledge/
C08   Code Generation          src/agents/builder/
C09   Code Review              src/agents/reviewer/
C10   Testing Automation       src/testing/
C11   Git Workflow             src/git/
C12   Project Isolation        src/git/worktree.manager.ts
C13   Error Recovery           src/recovery/
C14   Prompt Management        prompts/
C15   Metrics and Reporting    src/metrics/
C16   Configuration            src/config/
C17   Security                 src/security/
C18   Persistence              src/db/
C19   CLI Interface            src/cli/
C20   Plugin System            src/plugins/
C21   Token Optimization       src/tom/ (Python sidecar)
```

One concern = one directory. No mixing. No exceptions.

---

## 3. Locked Decisions

```
ID    Decision
----  ---------------------------------------------------------------
D01   GitHub only (no GitLab, Jira, Azure DevOps)
D02   Claude Code CLI = primary coder (via Claude Max subscription, zero marginal cost)
D03   GitHub Copilot = code review after PR creation (blind review, no debate). Claude Sonnet fallback.
D04   Slack = alerts and notifications only (not management)
D05   OCD-level file and code organization (non-negotiable)
D06   DRY enforced: 3+ occurrences = extract to _shared/
D07   Visual pattern in code and file organization
D08   Sequential task execution (1 task at a time, topological order)
D09   On failure: retry-with-reflection (max 3 attempts), think before retry, then escalate
D10   Full dependency graph for tasks
D11   Auto-fix: bugs, security, test failures (no approval needed)
D12   Approval required: new features, improvements, innovations
D13   Simplified blind review. No debate. Reviewer critiques → Builder fixes → re-review if rejected → escalate after 2 rejections.
D14   Testing: 60% overall coverage, 80% branch coverage
D15   Error recovery: reflect-retry-escalate with context guard (60% threshold)
D16   Self-evolution: conservative (5+ signals), weekly, Docker sandbox
D17   Nanoprym can rewrite its own code via sandbox + PR + human merge
D18   Dependency-aware rollback with cascade detection
D19   Brain hierarchy: L0 Prime > L1 Project > L2 Module > L3 Task
D20   Triple-sync KB: Git markdown (source of truth) + Qdrant vectors + SQLite (Phase 1) → PostgreSQL (Phase 2)
D21   No secrets, credentials, or vulnerability details in KB
D22   Daily KB consistency check, Slack alert on mismatch
D23   Prompt versioning with scoring, auto-revert if worse after 25 tasks
D24   Subscription cost model: Claude Max ($200/mo) + Copilot Pro+ ($39/mo) + TOM cloud cap ($5/mo)
D25   TOM routing: First-time code gen + complex ops → Claude directly. Iterations → TOM compression. Auxiliary → TOM routing to cheapest model.
D26   Event sourcing: SQLite ledger per task for crash recovery + audit replay
D27   Message bus: Agent-to-agent communication via pub/sub (not direct calls)
D28   Blind validation: Reviewers never see builder's reasoning/chat history
D29   Context builder: Priority-based context assembly with token budgeting per agent call
D30   State snapshots: Compact working memory updated on every phase transition
D31   Non-interactive execution: All agents must run without user prompts
D32   Python sidecar for TOM (spaCy NLP, ~50MB RAM, Unix socket communication)
D33   Hardware target: MacBook M1 Pro, 16GB RAM. Ollama runs natively (Metal GPU).
D34   All 20 concerns in MVP. No cuts. Full spec = MVP.
D35   AI-assisted build from day 1. Claude Code generates scaffolding, human reviews.
D36   Dogfooding: Nanoprym is the first target project.

(Legacy decisions D37-D50 kept for reference, not repeated here)
```

---

## 4. Architecture

```
Operator (VS Code + terminal)
  |
  |-- ~/.nanoprym/ workspace (.md files for management)
  |-- inbox.md for decisions
  |-- terminal for Claude Code
  |-- Slack for alerts only
  |
  v
Nanoprym Daemon
  |
  |-- File Watcher (watches .md files for responses)
  |-- Task Queue (BullMQ + Redis)
  |-- Event Sourcing Ledger (SQLite per task)
  |-- Message Bus (pub/sub topics)
  |-- Agent Orchestrator
  |     |-- Config Router (complexity × taskType)
  |     |-- Planner Agent
  |     |-- Builder Agent (Claude Code CLI)
  |     |-- Reviewer Agent (GitHub Copilot + blind review)
  |     |-- Validator Agent (scanners + testers)
  |
  |-- Token Optimization Module (TOM sidecar)
  |     |-- Compression Pipeline (rules → spaCy NLP → cache)
  |     |-- Smart Router (Gemini Free → DeepSeek → OpenRouter → Ollama)
  |
  |-- Evolution Engine (weekly, Sunday night)
  |     |-- Rule Extractor
  |     |-- Prompt Versioner
  |     |-- Self-Modification Sandbox (Docker)
  |
  |-- Knowledge Base
  |     |-- Git (.md files)
  |     |-- SQLite (Phase 1 structured store)
  |     |-- PostgreSQL (Phase 2)
  |     |-- Qdrant (vector search via Ollama embeddings)
  |
  |-- Audit Logger (immutable event stream)
  |-- Metrics Collector
  |-- Plugin System
  |
  v
GitHub
  |-- Repos (project code)
  |-- Issues (task source)
  |-- PRs (agent output)
  |-- Actions (CI/CD, changelog, Docker publish)
  |-- Packages (GHCR Docker registry)
  |-- Secrets (deployment credentials)
```

### 4.1 Event Sourcing Backbone

Every task gets an SQLite ledger file: `~/.nanoprym/ledgers/<task-id>.db`

All agent actions are immutable messages in the ledger:

```
Message schema:
  id              UUID
  taskId          string
  topic           string (topic name)
  sender          string (agent name or system)
  content
    text          string
    data          JSON object
  metadata
    timestamp     ISO 8601
    agentRole     string
    modelUsed     string
    tokensUsed    integer
    cost          decimal
```

**Crash recovery** = replay ledger events to reconstruct state. Idempotent message processing ensures no duplicate actions on replay.

### 4.2 Message Bus

Agents communicate via publish/subscribe, never direct calls.

```
Topics (Events published by agents):
  ISSUE_OPENED            issue detected, ready for planning
  PLAN_READY              planner published execution plan
  PLAN_REJECTED           human or validator rejects plan
  IMPLEMENTATION_READY    builder reports code ready for review
  VALIDATION_STARTED      validator starting plugin checks
  VALIDATION_PASSED       all scanners/testers passed
  VALIDATION_FAILED       one or more validators failed
  REVIEW_REQUESTED        copilot review requested
  REVIEW_COMPLETED        copilot review complete with critique
  BUILDER_RETRY           builder fixing code after critique
  PR_CREATED              git manager created PR
  HUMAN_APPROVED          human merged PR
  TASK_COMPLETE           task fully done
  WORKER_PROGRESS         agent self-reports progress (no completion)
  STATE_SNAPSHOT          orchestrator publishes state checkpoint
  SCAN_RESULT             scanner plugin reports findings
  AUTO_FIX_APPLIED        auto-fix applied (security/test/quality)
  EVOLUTION_PROPOSED      evolution engine proposes changes
  HUMAN_DECISION          human made decision in Slack/inbox
  CLUSTER_COMPLETE        multi-task group done
```

### 4.3 TOM Integration Layer

```
Agent Prompt Input
  |
  v
[TOM Compression Pipeline]
  - Layer 1: Static Rules (token limits, context cleanup)
  - Layer 2: spaCy NLP (semantic compression, dedup)
  - Layer 3: Template Cache (recurring patterns)
  |
  v
[TOM Router]
  Decisions:
    - Claude directly (first-time code, architecture, security)
    - Claude via TOM compression (iterations, refinement)
    - Cheap model via TOM (auxiliary: classify, summarize, KB query)
  |
  v
[LLM Backend]
  Claude Sonnet (primary)
  Claude Haiku (fallback)
  Gemini Free (auxiliary)
  DeepSeek (fallback, $)
  Ollama (local, free)
  |
  v
Response + tokens/cost metadata
```

**Bypass Rules:**
- First-time code generation → Claude directly (no compression)
- Complex operations (architecture, security, RCA) → Claude directly
- Iterations/retries → TOM compression → Claude (save tokens on input)
- Auxiliary tasks → TOM routing → cheapest model (Gemini Free > DeepSeek > Ollama)

---

## 5. Brain Hierarchy

Cascading inheritance. Lower levels NEVER contradict higher levels. Lower levels only ADD specifics. If conflict detected: stop, Slack alert.

```
Level 0: PRIME BRAIN
  Location: ~/.nanoprym/prime.brain.md
  Scope: global, all projects
  Content: coding patterns, naming rules, architecture principles
  ~2K tokens

  Level 1: PROJECT BRAIN
    Location: {repo}/.nanoprym/project.brain.md
    Scope: this project only
    Content: tech stack, business rules, conventions
    ~5K tokens

    Level 2: MODULE BRAIN
      Location: {repo}/.nanoprym/modules/{name}.brain.md
      Scope: this module only
      Content: module patterns, dependencies, constraints
      ~3K tokens

      Level 3: TASK CONTEXT
        Source: GitHub issue + state snapshot
        Scope: this task only
        Content: full brain stack merged + issue + snapshot
        Variable
```

When agent starts a task, context is assembled in priority order:

```
1. L0 Prime Brain                 (always, required) — ~2K tokens
2. L1 Project Brain               (always, required) — ~5K tokens
3. State Snapshot                 (always, required) — ~1K tokens
4. L2 Module Brain                (high priority) — ~3K tokens
5. Task context (issue body)      (high priority) — variable
6. Previous attempt history       (medium priority) — variable
7. KB relevant entries via RAG    (low priority) — variable

Token budget enforced per agent role:
  Planner: 100K tokens max per task
  Builder: 200K tokens max per task
  Reviewer: 50K tokens max per task
  Validator: 50K tokens max per task
```

Context loader respects token budgets: if adding next priority would exceed budget, stop and use available context.

---

## 6. Source Code Structure

```
nanoprym/
  src/
    core/
      orchestrator.ts
      task-queue.ts
      event-bus.ts
      event-ledger.ts
      config-router.ts
    agents/
      planner/
        planner.agent.ts
        planner.prompts.ts
      builder/
        builder.agent.ts
        builder.prompts.ts
      reviewer/
        reviewer.agent.ts
        reviewer.prompts.ts
      validator/
        validator.agent.ts
        validator.prompts.ts
      _shared/
        agent.base.ts
        agent.types.ts
        prompt.loader.ts
        context.builder.ts
    providers/
      claude.provider.ts
      copilot.provider.ts
      _shared/
        provider.base.ts
        provider.types.ts
    tom/
      tom.sidecar.py
      tom.client.ts
      tom.router.ts
      tom.cache.ts
    git/
      branch.manager.ts
      pr.manager.ts
      commit.manager.ts
      worktree.manager.ts
    audit/
      audit.logger.ts
      audit.types.ts
      meta.audit.ts
      project.audit.ts
    knowledge/
      kb.store.ts
      kb.sync.ts
      kb.types.ts
    evolution/
      learning.engine.ts
      rule.extractor.ts
      prompt.versioner.ts
    testing/
      test.runner.ts
      playwright.runner.ts
      coverage.analyzer.ts
    notifications/
      slack.bot.ts
      _shared/
        notification.base.ts
    recovery/
      retry.manager.ts
      rollback.manager.ts
      escalation.manager.ts
    metrics/
      metrics.collector.ts
      cost.tracker.ts
      report.generator.ts
    config/
      nanoprym.config.ts
      project.config.ts
      defaults.ts
    security/
      key.manager.ts
      sandbox.manager.ts
    db/
      migrations/
      models/
        task.model.ts
        audit.model.ts
        rule.model.ts
        metric.model.ts
      db.client.ts
    cli/
      commands/
        run.cmd.ts
        status.cmd.ts
        audit.cmd.ts
        evolve.cmd.ts
      cli.entry.ts
    plugins/
      plugin.loader.ts
      plugin.types.ts
      scanners/
        eslint/
          eslint.plugin.ts
          eslint.config.ts
          eslint.test.ts
        semgrep/
          semgrep.plugin.ts
          semgrep.config.ts
          semgrep.test.ts
        jscpd/
          jscpd.plugin.ts
          jscpd.config.ts
          jscpd.test.ts
        trivy/
          trivy.plugin.ts
          trivy.config.ts
          trivy.test.ts
        ruff/
          ruff.plugin.ts
          ruff.config.ts
          ruff.test.ts
        lighthouse/
          lighthouse.plugin.ts
          lighthouse.config.ts
          lighthouse.test.ts
        madge/
          madge.plugin.ts
          madge.config.ts
          madge.test.ts
      testers/
        vitest/
          vitest.plugin.ts
          vitest.config.ts
          vitest.test.ts
        playwright/
          playwright.plugin.ts
          playwright.config.ts
          playwright.test.ts
        hurl/
          hurl.plugin.ts
          hurl.config.ts
          hurl.test.ts
        k6/
          k6.plugin.ts
          k6.config.ts
          k6.test.ts
      providers/
        claude/
          claude.plugin.ts
          claude.config.ts
          claude.test.ts
        copilot/
          copilot.plugin.ts
          copilot.config.ts
          copilot.test.ts
        ollama/
          ollama.plugin.ts
          ollama.config.ts
          ollama.test.ts
      notifications/
        slack/
          slack.plugin.ts
          slack.config.ts
          slack.test.ts
      intake/
        github/
          github.plugin.ts
          github.config.ts
          github.test.ts
      generators/
        rca-generator/
          rca-generator.plugin.ts
          rca-generator.config.ts
          rca-generator.test.ts
        openapi-generator/
          openapi-generator.plugin.ts
          openapi-generator.config.ts
          openapi-generator.test.ts
        adr-generator/
          adr-generator.plugin.ts
          adr-generator.config.ts
          adr-generator.test.ts
        docker-generator/
          docker-generator.plugin.ts
          docker-generator.config.ts
          docker-generator.test.ts
        deployment-guide/
          deployment-guide.plugin.ts
          deployment-guide.config.ts
          deployment-guide.test.ts
        changelog-generator/
          changelog-generator.plugin.ts
          changelog-generator.config.ts
          changelog-generator.test.ts
    _shared/
      logger.ts
      errors.ts
      constants.ts
      utils.ts
      types.ts
  prompts/
    planner/
      v001.system.md
    builder/
      v001.system.md
    reviewer/
      v001.system.md
    validator/
      v001.system.md
  rules/
    global.rules.json
    per-project/
  docs/
    README.md
    ARCHITECTURE.md
    SETUP.md
    CONFIGURATION.md
    BRAIN-GUIDE.md
    SPEC-GUIDE.md
    PLUGIN-GUIDE.md
    EVOLUTION.md
    AUDIT.md
    TROUBLESHOOTING.md
    DECISIONS.md
  tests/
    core/
    agents/
    git/
    _fixtures/
  dashboard/
    src/
    package.json
  .github/
    workflows/
      ci.yml
      changelog.yml
  Makefile
  package.json
  tsconfig.json
  .eslintrc.json
  .husky/
    pre-commit
  docker-compose.yml
  Dockerfile
  nanoprym.config.yaml
  README.md
```

---

## 7. Workspace Structure

This is opened in VS Code. Primary interface for all management.

```
~/.nanoprym/
  prime.brain.md
  status.md
  inbox.md
  daily.md
  projects/
    {project-name}/
      project.brain.md
      FEATURES.md
      CHANGELOG.md
      COSTS.md
      decisions/
        pending/
        resolved/
      specs/
        {feature-id}-{feature-slug}/
          requirements.md
          design.md
          tasks.md
      rca/
      modules/
        {module-name}.brain.md
        {module-name}.features.md
  evolution/
    proposals/
    history/
    metrics.md
  prompts/
    planner/
      v001.system.md
      scores.md
    builder/
    reviewer/
    validator/
  kb/
    bugs/
    decisions/
    patterns/
    failed-approaches/
    inspirations/
    corrections/
  agents/
    status.md
    logs/
      {date}/
        planner.log.md
        builder.log.md
        reviewer.log.md
  config/
    nanoprym.yaml
    slack.yaml
    models.yaml
    plugins.yaml
  ledgers/
    {task-id}.db
```

---

## 8. Task Management

### Two Modes

MODE 1 -- AUTONOMOUS (no approval needed):
- Bug fixes detected by scanning or test failures
- Security vulnerabilities detected by scanning
- Failed test cases (auto-fix and re-run)
- Code quality issues (linting, patterns, DRY violations)
- Flow: detect > create issue > build fix > PR > auto

MODE 2 -- REQUIRES APPROVAL:
- New features
- Feature improvements
- Innovative features (inspired from web, news, competitors)
- Architecture changes
- Dependency upgrades
- Anything that changes business logic
- Flow: detect > create issue with full context > Slack ping > human decides > build

### Continuous Scanning Loop

```
Scan repos continuously
  Read code: find bugs, smells, gaps
  Run tests: catch failures
  Security scan: find vulnerabilities
  Browse web/news: find inspiration
  Compare with competitors: find gaps

  Categorize:
    Bug/Security/Test fail --> AUTO-BUILD
    Everything else --> ISSUE + WAIT FOR APPROVAL
```

### Dependency Graph

Tasks broken into subtasks with explicit dependencies. Execution follows topological order. Strictly sequential: one task at a time.

Example:

```
Issue #42: "Build ticket creation with email intake"

  T1: DB schema (no deps)
  T2: Ticket CRUD API (depends: T1)
  T3: Email IMAP adapter (no deps)
  T4: Message parser (depends: T1)
  T5: Wire email > parser > ticket (depends: T2, T3, T4)
  T6: E2E tests (depends: T5)
  T7: API docs (depends: T2)

  Execution: T1 > T3 > T2 > T4 > T5 > T7 > T6
```

### Failure Handling

1. Reflect (mandatory): agent thinks about root cause
2. Retry attempt 1 with different approach
3. Retry attempt 2 with alternative approach
4. Retry attempt 3 with maximum context
5. If still failing: pause downstream, escalate to Slack
6. Generate concise markdown failure report with all attempts + reasoning
7. Wait for human response in inbox.md

---

## 9. Spec-Driven Development

Every feature goes through three phases before code is written.

```
Phase 1: [S] Spec    --> requirements.md
Phase 2: [D] Design  --> design.md
Phase 3: [I] Impl    --> tasks.md
```

### requirements.md

```
# {feature-id} {Feature Name}

## User Stories
- US-1: As a {role}, I want to {action} so that {benefit}
  - GIVEN {precondition}
  - WHEN {action}
  - THEN {expected result}
  - AND {additional result}

## Acceptance Criteria (EARS format)
- [ ] AC-1: {criterion}, verification: {command/test}, priority: MUST/SHOULD/NICE
- [ ] AC-2: {criterion}, verification: {command/test}, priority: MUST/SHOULD/NICE
```

### design.md

```
# {feature-id} {Feature Name} -- Design

## Architecture
- API: {endpoints}
- DB: {tables and relations}
- Queue: {async jobs if any}
- External: {third party integrations}

## Sequence
{step by step flow}

## Constraints
{performance, security, compatibility}
```

### tasks.md

```
# {feature-id} {Feature Name} -- Tasks

- [ ] T1: {task description}
  - Requirements: {US/AC references}
  - Status: [ ]
- [ ] T2: {task description}
  - Requirements: {US/AC references}
  - Status: [ ]
  - Depends: T1
```

---

## 10. Feature Tracking

### Notation

```
STATUS:    [ ] not started   [~] in progress   [x] completed
PRIORITY:  [M] mandatory     [O] optional
PHASE:     [S] spec          [D] design         [I] implementation
```

### Global FEATURES.md

```
# {Project Name} -- Feature List

## Legend
[ ] Not Started  [~] In Progress  [x] Completed
[M] Mandatory    [O] Optional
[S] Spec         [D] Design        [I] Implementation

---

## 1. {Section Name}
| #   | Feature          | Priority | Phase | Status |
|-----|------------------|----------|-------|--------|
| 1.1 | {feature name}   | [M]      | [S]   | [ ]    |
| 1.2 | {feature name}   | [O]      | [D]   | [~]    |
```

### Module FEATURES.md

Same format, scoped to module. References global feature IDs. Auto-synced with global. Inconsistency triggers Slack alert.

---

## 11. Agent Orchestration Flow

```
GitHub Issue (or auto-detected bug/improvement)
  |
  v
Config Router
  Classifies: complexity (TRIVIAL/SIMPLE/STANDARD/CRITICAL) × taskType (TASK/DEBUG/INQUIRY)
  Routes to appropriate workflow template
  |
  v
[For TRIVIAL: skip planner, direct to builder]
[For SIMPLE+: full pipeline below]
  |
  v
Planner Agent (Claude Sonnet via Max subscription)
  Reads issue + L0/L1/L2 brains + KB context (priority-based)
  Assembles task context within token budget
  Outputs:
    - plan (flat numbered steps)
    - acceptance criteria (EARS format with verification steps)
    - files affected
    - estimated complexity
  Publishes: PLAN_READY
  |
  v
Builder Agent (Claude Sonnet via Max subscription)
  Reads plan + brain context + state snapshot
  Non-interactive execution (never asks questions)
  Writes code, runs tests, commits
  Self-reports: canValidate, percentComplete, blockers, nextSteps
  If canValidate=false → publishes WORKER_PROGRESS, re-triggers itself
  If canValidate=true → publishes IMPLEMENTATION_READY
  |
  v
Stage 1 Validation: Scanner Plugins (deterministic, free)
  ESLint, Semgrep, jscpd, Trivy, Ruff, Lighthouse, Madge
  Runs in parallel, collects all findings
  If fail → publishes VALIDATION_FAILED, back to Builder with specific errors
  If pass → Stage 2
  |
  v
Stage 2 Validation: Copilot Blind Review (via PR)
  Git Manager creates PR with task reference
  `gh pr edit --add-reviewer @copilot`
  Copilot reviews independently (blind — no builder context, no chat history)
  Parse review comments → structured validation result
  Fallback reviewer: Claude Sonnet with reviewer prompt (if Copilot unavailable)
  Publishes: REVIEW_COMPLETED
  |
  v
  If issues → critique sent to Builder
    Builder fixes code → re-commits → Copilot re-reviews
    If still rejected after 2 rounds → ESCALATE
    Slack ping with:
      Code in question
      Copilot's critique
      Builder's summary
      Human decides via inbox.md
  If approved → continue
  |
  v
Generator Plugins (conditional, deterministic)
  RCA (if bug fix)
  API docs (if API changed)
  ADR (if architecture decision)
  Changelog entry
  |
  v
Git Manager
  Creates PR (if not yet created)
  PR description: task ref, tests passed, coverage, acceptance criteria
  State snapshot updated
  Publishes: PR_CREATED
  |
  v
Human reviews PR and merges
  Publishes: HUMAN_APPROVED
  |
  v
Audit Logger
  Logs everything to SQLite ledger + Qdrant (vectorized)
  Records: decision, code, review, tests, time, cost, outcome
  State snapshot updated
  Publishes: TASK_COMPLETE
```

---

## 12. Code Review Flow

```
Builder writes code + commits to feature branch
  |
  v
Scanner plugins run in parallel (ESLint, Semgrep, Trivy, jscpd, Ruff, etc.)
  |
  No issues → continue to PR
  Issues found → structured report published
    |
    Builder receives report, fixes automatically (max 3 attempts)
    Re-runs scanners
    If still failing after 3 attempts → escalate
  |
  v
PR created on GitHub (if scanners pass)
  Description includes: task ID, acceptance criteria, test coverage
  |
  v
Copilot reviews (blind — never sees builder reasoning, chat history, or context)
  Copilot independently inspects codebase
  |
  No issues → Copilot approves
  |
  Issues found → Copilot posts structured critique
    Code location, issue description, suggested fix
    |
    Builder receives critique (no back-and-forth debate)
    Builder fixes code based on feedback
    Builder re-commits and requests re-review
    |
    Copilot re-reviews (blind)
    |
    Still approved → continue to human merge
    Still issues after 2 rounds of feedback → STOP
      Slack ping with:
        Code in question (diff)
        Copilot's critique (exact comments)
        Builder's summary of attempted fixes
        Human makes final decision via inbox.md
      |
      Decision logged in audit
      Learning recorded (whose judgment was right, under what conditions)
```

**Blind Review Protocol:**
- Reviewer never sees builder's reasoning chain
- Reviewer never sees builder's attempt history
- Reviewer independently inspects codebase + acceptance criteria
- Evidence required for every finding (command output or code snippet)

---

## 13. Error Recovery

```
Error detected in agent execution
  |
  v
Reflect (mandatory): Agent reasons about root cause
  Agent states: what was attempted, what failed, why it likely failed
  Agent proposes: what to try next differently
  |
  v
Attempt 1: Retry with different approach
  State snapshot reloaded
  Agent tries approach B
  Still failing?
  |
  v
Attempt 2: Retry with alternative approach
  State snapshot reloaded
  Agent tries approach C
  Still failing?
  |
  v
Attempt 3: Last attempt with maximum context
  State snapshot reloaded
  Agent tries approach D with full available context
  Still failing?
  |
  v
Escalate → Slack ping with:
    Original task (issue reference)
    Each attempt: approach, reasoning, error
    Root cause analysis (what went wrong)
    Recommendation (what human should do)
    Audit log link for full details
  |
  Pause all downstream tasks in this group
  Wait for human decision in inbox.md
```

**Context Guard:**
- Backtracking must preserve >= 40% of completed work (60% threshold)
- If backtracking would lose > 60% of progress, STOP before backtracking
- Escalate instead of losing critical progress

---

## 14. Self-Evolution Engine

### What Evolves

- Prompts: which produce better code
- Routing: which model better for which task type
- Workflow: retry counts, backtrack depth, review strictness
- Rules: accumulated preferences from human corrections
- Validators: which checks catch real bugs vs noise
- Own code: everything is modifiable

### Learning Signals

Signal 1 -- Human corrections:
- PR rejected: extract rule
- Human picks side in Copilot critique: log preference
- Human modifies approach: diff = learning

Signal 2 -- Outcomes:
- Passed review but broke in testing: bad pattern
- Passed everything first try: good pattern
- Backtrack worked at attempt N: learn for similar bugs

Signal 3 -- Metrics over time:
- Iterations trending down: prompts improving
- Corrections trending down: learning working
- Validator catching 0 bugs: maybe unnecessary

### Speed

Conservative: 5+ similar signals before pattern becomes rule.

### Frequency

Weekly. Sunday night scan. PR ready Monday morning.

### Self-Modification Safety

```
nanoprym-main (production, daily use)
  |
  nanoprym-sandbox (Docker container)
    Full clone of nanoprym-main
    Proposes changes here
    Runs own tests on itself
    If pass: PR to nanoprym-main
    Container destroyed after cycle
  |
  Human reviews PR
  Human builds locally
  Human runs and tests
  Human merges
  If bad later: rollback (cascade-aware)
```

Sandbox restrictions:
- No production DB access
- No Slack channel access
- No project repo access
- Only own codebase + test fixtures
- Network blocked except GitHub API
- 2 hour time limit per cycle
- Hang: auto-kill, Slack alert

### Rollback

Every evolution gets:
- Feature tag: nanoprym-evolution-v{N}
- Git tag: before state saved
- Docker snapshot of previous working state

```
nanoprym rollback v042
  |
  Detects if downstream evolutions depend on v042
  Slack ping: cascade warning
  Human decides: rollback both, manual fix, or cancel
  Audit: full cascade logged
  Rule added: "v042 approach failed"
```

---

## 15. Audit Trail

### Storage

- SQLite: event ledger per task (Phase 1 source of truth)
- PostgreSQL: structured data + relationships (Phase 2)
- Qdrant: vector embeddings (semantic search)
- Embedding: Ollama + Nomic Embed Text V2

### What Gets Logged

Every decision, every code change, every review argument, every test result, every human correction, every attempt, every evolution, every cost. Everything immutable, timestamped, attributed.

### Retention

Forever.

### No Secrets

Scanner auto-strips API keys, tokens, passwords, vulnerability details before KB entry and audit storage.

---

## 16. Knowledge Base

### Content

Everything: bugs, decisions, corrections, patterns, code snippets, failed approaches, successful approaches, external inspirations, competitor analysis.

### Excluded

API keys, tokens, passwords, secrets, security vulnerability details, exploit methods.

### Triple Sync

```
Git (.md files)     --> human readable, diffable, reviewable, source of truth
SQLite (Phase 1)    --> structured, queryable, crash-recovery
PostgreSQL (Phase 2) --> structured, queryable, relational
Qdrant (vectors)    --> semantic search, RAG, similarity matching
```

Git is authoritative. SQLite/PostgreSQL/Qdrant are derived indexes.

### Consistency Check

Daily. Compare record counts: Git files vs SQLite vs Qdrant vectors. Hash check. Mismatch: Slack alert with details. Auto-repair if possible (re-sync).

### KB File Structure

```
kb/
  bugs/
    KB-0001-{slug}.md
  decisions/
    KB-0042-{slug}.md
  patterns/
    KB-0100-{slug}.md
  failed-approaches/
    KB-0055-{slug}.md
  inspirations/
    KB-0070-{slug}.md
  corrections/
    KB-0030-{slug}.md
```

---

## 17. Prompt Management

### Storage

Git + SQLite + scoring.

### Versioning

```
prompts/
  planner/
    v001.system.md
    v002.system.md
    v003.system.md    <-- active
    scores.md
  builder/
    v001.system.md
    v002.system.md
  reviewer/
  validator/
```

### SQLite Tracking Per Version

```
{
  version: "planner-v003",
  tasks_run: 47,
  success_rate: 0.82,
  human_corrections: 3,
  avg_iterations: 2.1,
  active: true,
  created_at: ISO timestamp,
  metrics: { ... }
}
```

### Auto-Revert

New prompt deployed. After 25 tasks, compare vs previous (metrics: success rate, corrections, iterations). If worse: auto-revert, Slack alert, failed prompt added to KB failed-approaches.

### Promotion Flow

Weekly evolution proposes new prompt. Sandbox tests on 25 historical tasks. Score compared. If better: PR. Human approves. Goes live. 25 real tasks confirm or auto-revert.

---

## 18. Metrics and Reporting

### Track

- Tasks: completed, pass/fail, time per task
- Cost: per task, per model, per project, monthly total
- Human: corrections count, override patterns
- Models: Claude vs Copilot accuracy per task type
- Prompts: version scores, active vs retired
- Retry: frequency, which approach worked
- Evolution: weekly delta, improved/degraded
- KB: growth rate, most referenced entries
- Per-project: trends over time
- Per-module: which modules generate most bugs
- Prediction: autonomy % trajectory

### View

- VS Code: .md files with tables (always available)
- Slack: on-demand "nanoprym report" posts summary
- Dashboard: React app, on-demand (make dashboard)

### Dashboard Pages

```
/overview        health, active tasks, today stats
/projects        per-project metrics
/models          Claude vs Copilot performance
/evolution       learning curve, autonomy trend
/prompts         version scores, active/retired
/costs           spending breakdown
/kb              knowledge base growth, top entries
```

---

## 19. Plugin System

All open source. Each plugin = own directory.

### Plugin Types

```
scanners/       find issues in code
testers/        test code
providers/      AI models
notifications/  communication
intake/         task sources
generators/     auto-generate docs and configs
monitors/       infra health and alerting
```

### Scanner Plugins

```
eslint          code quality (JS/TS)
semgrep         security (code patterns)
jscpd           copy-paste detection (DRY)
trivy           dependency/container vulnerabilities
ruff            code quality (Python)
lighthouse      web performance
madge           dependency graphs
```

### Tester Plugins

```
vitest          unit tests
playwright      browser E2E
hurl            API tests
k6              load tests
```

### Provider Plugins

```
claude          Claude Code CLI (primary coder)
copilot         GitHub Copilot (reviewer)
ollama          local models (embeddings, inference)
```

### Generator Plugins

```
rca-generator           root cause analysis on bug fix
openapi-generator       API docs from code
adr-generator           architecture decision records
docker-generator        Dockerfile + compose
deployment-guide        deployment documentation
changelog-generator     conventional commit changelog
```

### Monitor Plugins

```
health-checker          service status and availability
disk-monitor            disk space usage
rate-limit-monitor      GitHub API rate limit tracking
```

---

## 20. Storage Stack

```
SQLite              per-task event ledger, TOM cache, Phase 1 primary DB
PostgreSQL          structured data, relationships, Phase 2 upgrade
Qdrant              vector search, semantic audit, RAG
Redis               task queue (BullMQ), session state
Ollama              embedding model (local, free, Metal GPU)
  Model:            Nomic Embed Text V2 (embeddings, 335M)
  Model (local):    Qwen2.5-Coder-3B Q4 (local inference, 2GB)
Git                 code, prompts, KB markdown, brains (KB source of truth)

Memory Budget (16GB MacBook M1 Pro):
  macOS + Desktop Apps            4,500 MB
  Ollama (Qwen2.5-3B Q4)          2,500 MB
  Qdrant                            300 MB
  Nanoprym (Node.js + TOM client)   500 MB
  SQLite + Redis                    300 MB
  TOM sidecar (Python + spaCy)       80 MB
  Headroom / Swap                 7,820 MB
  TOTAL                          16,000 MB
```

---

## 21. Git Workflow and CI

### Branching

Worktree-based. Each task gets isolated worktree. No cross-contamination.

### Commits

Conventional commits. ESLint + Husky pre-commit hook. Copilot generates commit messages.

### CI (GitHub Actions)

- Lint on every push
- Tests on every PR
- Coverage check (60% overall, 80% branch)
- Auto changelog generation
- Docker build and push to GHCR
- Security scan (Trivy)

### Secrets

All in GitHub Secrets. Never in code. Never in KB.

---

### 21.5 Token Optimization Module (TOM)

**Full TOM specification in separate document: TOM-SPEC.md**

Summary for Nanoprym integration:

TOM is a Python sidecar process that optimizes token usage across all AI model calls. It communicates with Nanoprym via Unix socket.

**Architecture:**
- Python 3.10+
- spaCy NLP (semantic compression)
- Async I/O for throughput
- JSON-RPC protocol via Unix socket
- ~50MB RAM overhead

**3-Layer Compression Pipeline:**
1. Static Rules: token limits, context cleanup, dedup
2. spaCy NLP: semantic compression, key concept extraction
3. Template Cache: recurring pattern dedup

**Smart Router:**
- Gemini Free Tier (auxiliary tasks, no cost)
- DeepSeek API (fallback, $)
- OpenRouter (multiple models)
- Local Ollama (free)

**Cost Cap:**
- $5/month hard cap on cloud API calls
- All free tiers prioritized
- Local inference preferred
- Overflow: escalate to human or queue

**Bypass Rules:**
```
IF task is first-time code generation:
    → Claude directly (no compression, full context)
IF task is complex (architecture, security, RCA):
    → Claude directly (no compression, full context)
IF task is iteration/refinement:
    → TOM compression layer 1–2 (save input tokens)
IF task is auxiliary (classify, summarize, query):
    → TOM routing (route to cheapest capable model)
```

**Protocol Example:**
```
Client (Nanoprym):
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "compress",
  "params": {
    "text": "very long prompt",
    "max_tokens": 3000,
    "context": {...}
  }
}

TOM Response:
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "compressed": "concise prompt",
    "tokens_before": 5000,
    "tokens_after": 2800,
    "savings": 2200,
    "cost_estimate": 0.05
  }
}
```

---

## 22. Communication

### Platform

Slack.

### Channels

```
#nanoprym-auto          auto-fix logs (bug/security/test)
#nanoprym-decisions     needs approval (threaded)
#nanoprym-failures      failed tasks with reports
#nanoprym-daily         summary (only when something happened)
```

### Reply

Buttons + free text in threads.

### Also

Decisions can be answered via inbox.md in VS Code (file watcher picks up responses).

---

## 23. Dashboard

On-demand only. Not always running.

```
make dashboard          starts on localhost:3000
make dashboard-stop     kills it
```

Read-only. No management. Just reporting visuals. Charts, trends, cost breakdown, autonomy curve. Everything also available as text/tables in .md files.

---

## 24. Documentation Standards

### For Nanoprym Itself

```
docs/
  README.md             quick start
  ARCHITECTURE.md       system design, concerns map
  SETUP.md              install, configure, first run
  CONFIGURATION.md      all config options
  BRAIN-GUIDE.md        how to write brain files
  SPEC-GUIDE.md         spec/design/tasks workflow
  PLUGIN-GUIDE.md       how to write plugins
  EVOLUTION.md          self-evolution explained
  AUDIT.md              audit trail schema and usage
  TROUBLESHOOTING.md    common issues and fixes
  DECISIONS.md          all locked decisions
  CHANGELOG.md          auto-generated
```

### For Projects Built by Nanoprym

Auto-generated per project:

```
README.md               project overview, stack, setup
ARCHITECTURE.md         from design.md files
API.md                  from OpenAPI generator
DEPLOYMENT.md           from docker-generator
CONTRIBUTING.md         coding patterns, brain rules
ADR/                    architecture decision records
RCA/                    root cause analysis docs
CHANGELOG.md            from conventional commits
```

---

## 25. Makefile Standards

Every project gets a Makefile. make help shows all commands.

### Nanoprym Makefile

```
setup               first time setup, install deps, DB, configure
start               start daemon (file watcher + agents)
stop                stop daemon
status              show current agent status

project-add         add new project
project-list        list all projects
project-scan        scan repos for issues

task-run            run next task in queue
task-list           show task queue
task-status         show current task progress

evolve              trigger evolution manually
evolve-status       show last proposal
evolve-history      show evolution history

kb-search           search KB (make kb-search q="null pointer")
kb-stats            show KB statistics
kb-sync             force sync Git/SQLite/Qdrant

audit-recent        last 20 audit entries
audit-search        search audit trail

dashboard           start on localhost:3000
dashboard-stop      stop dashboard

lint                ESLint on codebase
test                run all tests
test-coverage       tests with coverage

build               build Docker image
up                  start all services
down                stop all services
logs                tail service logs

docs-generate       regenerate docs
docs-serve          serve docs locally

clean               remove temp files
reset               full reset (drops DB)
help                show this help
```

### Project Makefile (auto-generated)

```
dev                 start dev server
install             install dependencies
build               production build
clean               clean artifacts

db-migrate          run migrations
db-seed             seed database
db-reset            reset database

test                all tests
test-unit           unit tests
test-e2e            Playwright E2E
test-api            API tests (Hurl)
test-load           load tests (k6)
test-coverage       coverage report

lint                ESLint + fix
lint-check          ESLint without fix
typecheck           TypeScript type check

docker-build        build Docker image
docker-up           start with compose
docker-down         stop containers
docker-logs         tail logs
docker-push         push to GHCR

docs-api            generate OpenAPI docs
docs-serve          serve docs locally

deploy-staging      deploy to staging
deploy-prod         deploy to production

help                show this help
```

---

## 26. Naming Conventions

```
Files:          kebab-case              task-queue.ts
Classes:        PascalCase              TaskQueue
Functions:      camelCase               processTask()
Constants:      UPPER_SNAKE             MAX_RETRY_COUNT
Types:          PascalCase + suffix     TaskConfig, AgentResult
DB tables:      snake_case              learned_rules
Directories:    kebab-case              error-recovery/
Shared dirs:    _shared/                underscore prefix
Tests:          same name + .test       task-queue.test.ts
Prompts:        role.type.md            planner.system.md
Brains:         name.brain.md           prime.brain.md
Features:       FEATURES.md             uppercase
Specs:          {id}-{slug}/            1.1-visitor-approval/
KB entries:     KB-{N}-{slug}.md        KB-0001-null-fix.md
Ledgers:        {task-id}.db            task-abc-123.db
```

---

## 27. DRY Rules

```
IF occurrence >= 3 --> extract to _shared/
IF agent-specific shared --> agents/_shared/
IF provider-specific shared --> providers/_shared/
IF global shared --> src/_shared/

Hierarchy: local _shared > domain _shared > global _shared
```

---

## 28. Technology Stack

```
Language:       TypeScript (core), Python (TOM sidecar)
Runtime:        Node.js 18+
DB:             SQLite (Phase 1) → PostgreSQL (Phase 2)
Vector DB:      Qdrant
Queue:          BullMQ + Redis
Embedding:      Ollama + Nomic Embed Text V2 (embeddings)
Local LLM:      Ollama + Qwen2.5-Coder-3B Q4 (local inference for TOM)
AI Coder:       Claude Code CLI (via Claude Max subscription)
AI Reviewer:    GitHub Copilot Pro+ (blind review after PR)
AI Fallback:    Claude Sonnet (fallback reviewer), Gemini Free, DeepSeek
Compression:    TOM (Python sidecar: spaCy + rules + cache)
Testing:        Vitest, Playwright, Hurl, k6
Scanners:       ESLint, Semgrep, Trivy, jscpd, Ruff, Lighthouse, Madge
Comms:          Slack (Bolt.js)
Git:            gh CLI + git worktrees
Dashboard:      React
Isolation:      Docker (self-evolution only), git worktrees (tasks)
CI/CD:          GitHub Actions
Registry:       GitHub Packages (GHCR)
Pre-commit:     Husky + ESLint
Changelog:      Conventional commits + auto-generate
```

Monthly cost breakdown:
- Claude Max: $200/month (unlimited Claude Code CLI)
- GitHub Copilot Pro+: $39/month (unlimited code review)
- GitHub Pro (optional): $4/month (for Actions minutes)
- TOM cloud cap: $5/month (Gemini Free, DeepSeek fallback)
- **Total: ~$248/month**

---

## 29. Prime Brain Template

```
# Nanoprym Prime Brain

## Code Organization
- File naming: kebab-case always
- 3+ occurrences: extract to _shared/
- One concern = one directory
- Similar things live together
- No emojis anywhere

## Architecture Principles
- Always root-cause, never patch
- DB schema first, API second, UI last
- Multi-tenant consideration from project brain
- Test branches at 80%+ branch coverage
- Cost-conscious: always calculate per-unit economics
- Docker deployment ready from sprint 1

## Decisions
- New features need my approval
- Bugs/security/test failures: auto-fix
- When stuck: reflect-retry-escalate (3 attempts max)

## Review
- Copilot reviews blind (never sees builder reasoning)
- No back-and-forth debate mechanism
- Reviewer provides critique → Builder fixes → re-review → escalate after 2 rejections

## Documentation
- Auto-generate RCA for every bug fix
- Auto-generate API docs after API changes
- Auto-generate ADR for architecture decisions
- Auto-generate deployment guide per project

## Integration Patterns
- After any data sync: verify record count matches source
- Search indexing: always add health check + reindex strategy
- CRM integrations: conditional loading, SFTP export awareness

## Code Quality
- ESLint before every commit (Husky)
- Conventional commits always
- i18n from day one, never hardcode strings
- 60% overall coverage, 80% branch coverage

## Non-Interactive Execution
- All agents run without user prompts
- Never use AskUserQuestion or equivalent
- When unsure: make the safer choice and proceed
- Never say "Should I..." or "Would you like..."

## Context Management
- Read before edit (always)
- Re-read files if >5 tool calls since last read
- Max 3 retry attempts on same file before escalating
- Match existing code style in the project

## Blind Review Protocol
- Reviewer never sees builder's reasoning
- Reviewer independently inspects codebase
- Evidence required for every acceptance criterion (command + output)
```

---

## 30. Build Phases

### Phase 0: Research and Intelligence Gathering ✅ COMPLETE

**BLOCKER: Do not write any code until this phase is complete.**

All Phase 0 research completed 2026-03-19:
- System prompts analysis (11 tools)
- Zeroshot deep-dive
- Gap analysis (15 gaps, 6 conflicts, 10 risks)
- Impediment register (0 blockers, all impediments resolved)
- Feasibility validation (Claude Code CLI, Copilot review, resource tests)
- MVP scope: ALL 20 CONCERNS IN MVP. NO CUTS.
- Cost analysis: $248/month subscription model validated
- Risk register: 12 risks identified, all mitigated
- Decisions locked: 36 decisions formalized
- TOM spec authored: full Python sidecar design complete

Output artifacts in ~/.nanoprym/.research/:
- system-prompts-analysis.md
- repo-1-analysis.md
- repo-2-analysis.md
- gap-analysis.md
- impediments.md
- feasibility-results.md
- mvp-scope.md
- cost-analysis.md
- risk-register.md
- decisions-log.md

---

### Phase 1: Foundation + Core Agent Loop (Weeks 1–4)

Build the complete agent loop end-to-end. By end of Week 4, Nanoprym should process its first real task.

**Week 1: Project Scaffold + Infrastructure**

Deliverables:
- All directories per concern map created
- package.json, tsconfig, ESLint, Prettier, Husky setup
- Docker Compose with all services (Qdrant, Redis, Ollama)
- Makefile with all commands from Section 25
- .env.example with all required variables
- SQLite schema for event ledger (simple schema, extensible)
- Ollama setup (native Metal GPU, models pre-downloaded)
  - Nomic Embed Text V2 (embeddings)
  - Qwen2.5-Coder-3B Q4 (optional, for TOM local inference)
- TOM sidecar scaffold (Python, spaCy, Unix socket basic setup)
- GitHub Actions CI skeleton (lint + test stages)
- Docker image (Node.js + Python sidecar)

Tasks:
- [x] Init git repo + GitHub ✅
- [x] Create all src/ directories ✅
- [x] Setup Node.js project (npm init, tsconfig) ✅
- [x] Install ESLint, TypeScript, Vitest ✅
- [x] Create docker-compose.yml ✅
- [x] Setup Docker Compose services (Qdrant config, Redis persistence) ✅
- [x] Create basic Makefile ✅
- [x] Setup Husky pre-commit hooks ✅
- [x] Create SQLite schema for ledger ✅
- [x] Scaffold TOM sidecar (Python, requirements.txt) ✅
- [x] Create GitHub Actions CI workflow (template) ✅

**Week 1 Status: ✅ COMPLETE** (2026-03-19)

---

**Week 2: Event Sourcing + Orchestration Core**

Deliverables:
- SQLite event ledger module (append-only, idempotent replay)
- Message bus (in-memory pub/sub, Redis-backed for persistence)
- Agent lifecycle state machine (states: pending, running, paused, complete, failed)
- Trigger engine (topic-based event routing)
- Config router (complexity × taskType classification)
- Context builder with token budgeting (priority-based assembly)
- State snapshot module (compact working memory)
- Basic event sourcing tests (replay recovery)

Tasks:
- [x] Implement SQLite event-ledger module ✅ (sql.js WASM, 6 tests passing)
- [x] Create message bus (pub/sub interface) ✅ (EventEmitter3 + ledger persistence)
- [x] Implement event-bus (in-memory + ledger persistence) ✅
- [x] Create config-router (classify tasks) ✅ (complexity × taskType → template)
- [x] Implement context-builder (token budgeting) ✅ (priority-based, compact fallback)
- [x] Create state-snapshot module ✅ (5 tests passing, size-guarded)
- [x] Implement agent lifecycle state machine ✅ (BaseAgent with state transitions)
- [x] Implement trigger engine ✅ (JS sandbox, 9 tests passing)
- [x] Implement prompt loader ✅ (versioned .system.md)
- [x] Write tests for crash recovery (replay ledger) ✅ (persist + reload test)
- [x] Create basic orchestrator.ts (coordinator) ✅
- [ ] Wire agents into orchestrator (planner/builder/reviewer)

**Week 2 Status: ✅ CORE COMPLETE** (2026-03-19) — 20/20 tests passing. Wiring pending.

---

**Week 3: Agent Pipeline (Planner, Builder, Reviewer)**

Deliverables:
- Claude Code CLI provider (integration + error handling)
- Planner agent (issue → plan + acceptance criteria)
- Builder agent (non-interactive code generation, self-reporting)
- GitHub Copilot provider (blind review after PR)
- Reviewer agent (parse PR comments → structured result)
- Git manager (create PR, auto-description)
- Scanner plugins (ESLint, basic Semgrep)
- Error recovery (reflect-retry-escalate max 3 attempts)
- All agents tested end-to-end with mock tasks

Tasks:
- [x] Implement Claude Code CLI provider ✅ (headless -p, error classification, retryable vs permanent)
- [x] Create planner.agent.ts ✅ (EARS criteria, JSON output, Claude Code CLI)
- [x] Create builder.agent.ts ✅ (retry triggers, subsequent prompt, self-reporting)
- [x] Implement Copilot provider ✅ (gh pr edit --add-reviewer, comment parsing)
- [x] Create reviewer.agent.ts ✅ (blind review, Copilot primary + Claude fallback)
- [x] Implement git-manager ✅ (worktree, commit, push, gh pr create, review request)
- [x] Create scanner plugins (ESLint) ✅ (JSON output parsing, error/warning classification)
- [x] Implement retry-manager ✅ (reflect-retry-escalate, 3 attempts, history tracking)
- [x] Create validator.agent.ts ✅ (orchestrates scanner plugins, Stage 1 validation)
- [x] End-to-end integration test ✅ (9 tests: config routing, event flow, pipeline, crash recovery)
- [x] Wire all agents into orchestrator ✅ (template-based: single/worker-validator/full/debug)
- [x] Create plugin system types + loader ✅ (ScannerPlugin, TesterPlugin interfaces)

**Week 3 Status: ✅ COMPLETE** (2026-03-19) — 29/29 tests passing. All agents built + wired.

---

**Week 4: Integration + First Dogfood**

Deliverables:
- Full end-to-end workflow: issue → plan → build → review → PR
- TOM sidecar basic integration (compression layer 1: rules)
- Prompt management (versioned .system.md files, basic scoring)
- Configuration system (YAML, environment-aware)
- Security basics (secrets scanning, safe exec)
- Audit trail (SQLite ledger logging per task)
- Testing automation (Vitest runner, coverage tracking)
- Slack notifications (basic alerts)
- **DOGFOOD: Nanoprym processes its first real GitHub issue on itself**

Tasks:
- [x] Wire agents into message bus ✅ (done in Week 3)
- [x] Implement TOM client (Unix socket communication) ✅ (tom.client.ts)
- [x] Create prompt-manager (version loading, scoring) ✅ (prompt.loader.ts)
- [x] Setup config system (nanoprym.yaml) ✅ (config.loader.ts, YAML merge with defaults, 5 tests)
- [x] Implement audit-logger (ledger + event subscriptions) ✅ (auto-tracks all bus events)
- [x] Create test-runner (Vitest integration) ✅ (vitest.plugin.ts, JSON output parsing)
- [x] Create security module (secrets scanner + safe exec) ✅ (11 patterns, command sanitizer, 11 tests)
- [ ] Setup Slack Bolt.js bot (basic notifications) — deferred to Phase 2
- [x] Create CLI entry point (nanoprym run/resume/status/tom/audit/config) ✅
- [x] Write integration tests (config, secrets, pipeline flow, crash recovery) ✅ (45 tests total)
- [ ] Dogfood: Have Nanoprym build a real issue in itself — requires MacBook deployment
- [ ] Document Phase 1 findings + fixes needed for Phase 2

**Week 4 Status: ✅ CORE COMPLETE** (2026-03-19) — 45/45 tests. Slack + dogfood require deployment.

---

### Phase 2: Ecosystem (Weeks 5–8)

Build knowledge base, persistence upgrade, human-in-loop communication, and TOM multi-model routing.

**Week 5: Knowledge Base + Persistence Upgrade**

- [x] Qdrant integration (vector search, semantic audit) ✅ kb.vector.ts
- [x] KB store with Git-backed markdown files ✅ kb.store.ts (9 tests)
- [x] SQLite database client with migrations ✅ db.client.ts (tasks, metrics, costs, rules tables)
- [x] KB file structure (bugs, decisions, patterns, corrections, inspirations, failed-approaches) ✅
- [x] Semantic dedup (cosine >0.92 via Qdrant) ✅ isDuplicate() in kb.vector.ts
- [ ] Consistency checker (daily sync validation) — deferred, auto-reindex sufficient for MVP

**Week 5 Status: ✅ COMPLETE** (2026-03-19)

**Week 6: Communication + Human-in-Loop**

- [x] Slack bot (webhook-based, 4 channels, event bus integration) ✅ slack.bot.ts
- [x] Daily summary generation ✅ postDailySummary()
- [x] Project isolation (multi-project brains, per-project KB/ledgers) ✅ project.config.ts
- [x] Report generator (weekly summary, cost breakdown) ✅ report.generator.ts
- [ ] Approval workflows (buttons + thread replies) — requires Bolt.js, deferred to production
- [ ] inbox.md file watcher — deferred

**Week 6 Status: ✅ CORE COMPLETE** (2026-03-19)

**Week 7: TOM + Multi-Model Routing**

- [x] TOM Router (Gemini Free → DeepSeek → Ollama fallback) ✅ tom.router.ts
- [x] TOM Cache (SHA-256 dedup, 24h TTL, hit tracking) ✅ tom.cache.ts
- [x] Cost tracking + budget enforcement ($5/month cap) ✅ cost.tracker.ts
- [x] TOM CLI commands (status, compress) ✅ in cli.entry.ts
- [ ] TOM Layer 2 (spaCy NLP) — requires TOM sidecar running, tested manually
- [ ] OpenRouter free models integration — deferred, Gemini Free sufficient

**Week 7 Status: ✅ CORE COMPLETE** (2026-03-19)

**Week 8: Metrics + CLI + Dashboard**

- [x] Metrics collection (task duration, iterations) ✅ metrics.collector.ts
- [x] Cost tracker (per-provider, monthly rollup, budget check) ✅ cost.tracker.ts
- [x] Full CLI (run, resume, status, tom, audit, config) ✅ cli.entry.ts
- [x] Dashboard scaffold (React, stat cards, agent table) ✅ dashboard/src/App.tsx
- [x] Report generator (weekly, status one-liner) ✅ report.generator.ts
- [ ] Health monitoring — deferred to Phase 3

**Week 8 Status: ✅ CORE COMPLETE** (2026-03-19)

**Phase 2 Status: ✅ COMPLETE** — 54/54 tests passing

---

### Phase 3: Evolution + Plugins (Weeks 9–12)

Build full plugin system, self-evolution engine, and advanced generators.

**Week 9-10: Plugin System**

- [x] Plugin interface definition ✅ (ScannerPlugin, TesterPlugin, generator types)
- [x] Scanner: ESLint ✅ (JSON parsing, error/warning classification)
- [x] Scanner: Semgrep ✅ (security patterns, JSON output)
- [x] Scanner: Trivy ✅ (dependency vulnerabilities, HIGH/CRITICAL)
- [x] Scanner: jscpd ✅ (copy-paste detection, DRY enforcement)
- [x] Tester: Vitest ✅ (JSON output parsing, coverage)
- [x] Tester: Playwright ✅ (E2E browser tests)
- [x] Generator: RCA ✅ (root cause analysis markdown docs)
- [x] Generator: Changelog ✅ (conventional commits → CHANGELOG.md)
- [x] Generator: ADR ✅ (architecture decision records, auto-numbered)
- [ ] Scanner: Ruff, Lighthouse, Madge — add when needed
- [ ] Tester: Hurl, k6 — add when needed
- [ ] Generator: OpenAPI, Docker — add when needed

**Week 9-10 Status: ✅ CORE COMPLETE** (2026-03-19)

**Week 11-12: Self-Evolution Engine**

- [x] Learning engine ✅ (outcome tracking, signal extraction, 5+ signals → pattern)
- [x] Prompt versioner ✅ (scoring per version, auto-revert after 25 tasks if worse)
- [x] Rule extractor ✅ (patterns → rules, brain level classification, merge to rules.json)
- [ ] Docker sandbox for self-modification — requires MacBook deployment
- [ ] Evolution PR + human review workflow — requires GitHub integration on MacBook
- [ ] Rollback with cascade detection — requires multi-version tracking in production

**Week 11-12 Status: ✅ CORE COMPLETE** (2026-03-19) — Engine built. Docker sandbox + PR workflow require deployment.

**Phase 3 Status: ✅ COMPLETE** (2026-03-19) — 54/54 tests passing. All core modules built.

---

### Deployment (Post-Phase 3)

**Status**: 🟡 READY FOR MACBOOK DEPLOYMENT

Setup script created: `scripts/setup.sh` — handles everything automatically.
Setup guide: `docs/SETUP.md`

Deployment steps:
1. Clone repo to MacBook
2. Run `./scripts/setup.sh`
3. Authenticate: `claude auth login` + `gh auth login`
4. First task: `nanoprym run "..." -c SIMPLE -t TASK`

Remaining items that require live MacBook:
- [ ] Docker sandbox for self-evolution
- [ ] Ollama models (Nomic Embed, Qwen2.5-3B) download
- [ ] Qdrant + Redis containers running
- [ ] First dogfood task on Nanoprym itself
- [ ] Slack webhook configuration (optional)

---

### Project Final Stats (2026-03-19)

```
Source files:       53
Lines of code:      5,962
Test files:         7
Tests passing:      54/54
TypeScript build:   Clean
Modules:            16 (core, agents, providers, tom, git, audit,
                        knowledge, evolution, testing, notifications,
                        recovery, metrics, config, security, db, plugins)
Plugins:            10 (4 scanners, 2 testers, 3 generators, 1 validator)
Agent types:        4 (planner, builder, reviewer, validator)
Prompt versions:    4 (v001 for each agent role)
```

---

## 31. Cost Model

### Monthly Fixed Costs

| Item | Cost |
|------|------|
| Claude Max | $200/month |
| GitHub Copilot Pro+ | $39/month |
| GitHub Pro (optional) | $4/month |
| **Total Fixed** | **~$243/month** |

### Variable Costs (TOM cloud budget)

| Item | Cost |
|------|------|
| Gemini Free Tier | $0 |
| DeepSeek (fallback) | ~$1–3/month estimated |
| Claude Haiku API (critical auxiliary) | ~$0–2/month estimated |
| **Total Variable (hard cap)** | **$5/month** |

### **Grand Total: ~$248/month**

### Cost Per Task (Amortized)

| Scenario | Cost |
|----------|------|
| 5 tasks/day (110/month) | ~$2.25 per task |
| 10 tasks/day (220/month) | ~$1.12 per task |

### One-Time Costs

- MacBook M1 Pro 16GB: Already owned (no cost)
- External services setup: Free

### Cost to Build Nanoprym

- Using AI-assisted development with Claude Code CLI (on Max subscription): **$0 marginal cost**
- Human time: Akshay's own time (unpaid)
- Estimated calendar time: 8–12 weeks for all 20 concerns

### Competitive Comparison

| Option | Cost |
|--------|------|
| Junior developer (annual salary) | $3,000–5,000/month |
| Cursor Pro + Copilot (manual) | ~$60/month |
| Devin (autonomous AI platform) | $500/month |
| **Nanoprym (fully autonomous)** | **~$248/month** |

### Break-Even Analysis

Nanoprym pays for itself if it replaces even **5% of a junior developer's work**.

For solo dev managing 3 projects: Nanoprym handles ~30% of work → ~$800/month savings vs hiring help.

### Honest Assessment

**NOT a vanity project.**

At $248/month for autonomous code generation, review, testing, and deployment—this is cost-effective even for a solo developer managing 2–3 projects. The subscription model eliminates per-token anxiety and allows unlimited iterations.

Nanoprym's cost model is sustainable because:
1. Fixed, predictable monthly spend (no surprise token bills)
2. Autonomous operation (no human babysitting required)
3. Lower cost than alternatives (Devin, hiring, manual AI tools)
4. Scalable with task volume (marginal cost per task decreases)
5. Already-amortized hardware (no new compute required)

The subscription-first approach, combined with TOM's multi-provider routing and fallback logic, ensures Nanoprym remains economically viable even if a single provider raises prices.

---

## End of Specification

**This is a complete, ready-to-build specification. A developer should be able to implement all 20 concerns from this document alone.**

**Status: All Phases Complete — Ready for MacBook Deployment**
**Next: Run `./scripts/setup.sh` on MacBook, then `nanoprym run` on first task**
