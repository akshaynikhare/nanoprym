# Gap Analysis: Reference Repos vs Nanoprym Spec

**Task**: 0.3
**Date**: 2026-03-19
**Inputs**: repo-1-analysis.md (system prompts), repo-2-analysis.md (zeroshot), NANOPRYM-SPEC.md
**Method**: Systematic comparison of every Nanoprym concern (C01-C20) against patterns found in reference repos

---

## 1. GAPS — Things They Do That Nanoprym Does Not Address

### GAP-01: Event Sourcing / Message Bus

**What they do**: Zeroshot uses an immutable SQLite ledger as the backbone. All state changes are messages. Crash recovery is just ledger replay. Every agent communicates through pub/sub, never directly.

**What Nanoprym spec says**: BullMQ + Redis for task queue. PostgreSQL for audit. No mention of event sourcing or message bus.

**Risk**: Without event sourcing, Nanoprym has no crash recovery, no audit replay, and agents are tightly coupled through the task queue.

**Recommendation**: Add SQLite ledger per task (for crash recovery) alongside PG (for aggregated metrics). Add a lightweight message bus (EventEmitter + ledger persistence). BullMQ stays for job scheduling, but agent-to-agent communication should be pub/sub, not queue-based.

---

### GAP-02: Context Window Management / Token Budgeting

**What they do**: Zeroshot's context-pack-builder uses priority-based selection with token budgets. Required messages always included, optional messages selected until budget exhausted, compact variants as fallback. Cursor limits file reads to 250 lines, re-reads after 5 messages.

**What Nanoprym spec says**: Brain hierarchy (L0/L1/L2/L3) is defined but no mention of how context is assembled, prioritized, or bounded for each agent call.

**Risk**: Without token budgeting, agents will either get too little context (miss important info) or too much (blow context window, increase cost).

**Recommendation**: Add `src/core/context-builder.ts` implementing priority-based context assembly:
- L0 Prime Brain: always included (required)
- L1 Project Brain: always included (required)
- L2 Module Brain: high priority
- L3 Task Brain: high priority
- State snapshot: required
- Previous attempt history: medium priority
- KB relevant entries: low priority
- Token budget per agent role (planner: 100k, builder: 200k, reviewer: 50k)

---

### GAP-03: State Snapshots / Durable Working Memory

**What they do**: Zeroshot publishes STATE_SNAPSHOT messages that compact all working memory (task, plan, progress, validation, debug) into one message. Size-guarded (2500 chars for plan, 5 items for errors). Updated on every major event.

**What Nanoprym spec says**: No equivalent. The spec mentions audit logging but not compact state representation for ongoing tasks.

**Risk**: Without state snapshots, agents in multi-iteration tasks must re-read full history, wasting tokens and causing context drift.

**Recommendation**: Add state snapshot module. Update on every phase transition. Include in agent context as "required" priority.

---

### GAP-04: Stuck Detection (Multi-Indicator)

**What they do**: Zeroshot scores stuck-ness using 5 indicators: process state, wait channel, CPU usage, context switches, network sockets. Score ≥ 3.5 = likely stuck.

**What Nanoprym spec says**: Error recovery uses prime-step backtracking (1, 3, 5, 7 steps), but no mention of detecting when an agent is stuck vs slow.

**Risk**: Without stuck detection, a hung agent burns API credits and blocks the pipeline indefinitely until timeout.

**Recommendation**: Add `src/recovery/stuck-detector.ts` with multi-indicator scoring. Integrate with error recovery — stuck detection triggers the first backtrack step.

---

### GAP-05: Blind Validation

**What they do**: Zeroshot validators never see the worker's context or chat history. They independently inspect the codebase. This prevents context poisoning and herd bias.

**What Nanoprym spec says**: Reviewer agent (Copilot) reviews code, but no mention of whether reviewer sees builder's context or not.

**Risk**: If reviewer sees builder's reasoning, it biases toward agreement. The Claude-vs-Copilot debate mechanism helps, but only if Copilot reviews code independently.

**Recommendation**: Make blind validation explicit: Reviewer receives issue + plan + acceptance criteria + the code diff, but NOT the Builder's reasoning or chat history. This is a configuration concern, not a code change.

---

### GAP-06: Template-Based Agent Configuration

**What they do**: Zeroshot defines entire cluster topologies in JSON templates with `{{params}}`. Conditional agents (`"condition": "{{validator_count}} >= 2"`). Template resolver validates params and resolves placeholders.

**What Nanoprym spec says**: Prompt management with versioned `.system.md` files, but no template system for agent topology configuration.

**Risk**: Without templates, adding new workflow types (debug, refactor, security audit) requires code changes instead of config changes.

**Recommendation**: Add `configs/workflows/` with JSON templates for each task type. Template resolver as a thin utility. Agent prompts stay in `prompts/` as `.system.md`, but workflow orchestration is template-driven.

---

### GAP-07: Trigger System with Logic Scripts

**What they do**: Zeroshot agents wake on topic + optional JavaScript logic. Logic scripts run in a sandboxed environment with ledger query API. This enables complex conditional flows without code changes.

**What Nanoprym spec says**: Task queue with topological sort. Sequential execution. No trigger-based or event-driven agent activation.

**Risk**: Without triggers, complex workflows (two-stage validation, conditional agents, debug investigation) require hardcoded orchestration logic.

**Recommendation**: Add trigger engine. For MVP, topic-based triggers are sufficient (no JS sandbox needed). The topological sort from the spec works for task ordering, but agent activation should be event-driven.

---

### GAP-08: Complexity-Based Cost Routing

**What they do**: Zeroshot routes tasks based on complexity × taskType to different templates with different model levels and validator counts. Cost awareness in prompt: "CRITICAL uses Opus ($15/M) + 4 validators = EXPENSIVE."

**What Nanoprym spec says**: Multi-model routing (C03) mentioned as a concern. Spec says Claude for coding, Copilot for review. No complexity-based routing within Claude (haiku vs sonnet vs opus).

**Risk**: Using Opus for every task is unnecessarily expensive. Using Haiku for critical tasks is dangerously cheap.

**Recommendation**: Add complexity router in `src/core/config-router.ts`:
- TRIVIAL (auto-fix, typo): Haiku builder, no validator
- SIMPLE (small bug): Sonnet builder, 1 Sonnet validator
- STANDARD (feature): Sonnet planner, Sonnet builder, 2 Sonnet validators
- CRITICAL (auth/payments): Opus planner, Sonnet builder, 3 validators (security + code + test)

---

### GAP-09: Evidence-Based Acceptance Criteria

**What they do**: Zeroshot's planner outputs acceptance criteria with id, criterion, verification steps, and priority (MUST/SHOULD/NICE). Validators must provide evidence (command, exit code, output) for each criterion.

**What Nanoprym spec says**: Spec-driven development (Section 9) mentions requirements.md, design.md, tasks.md, but no structured acceptance criteria format.

**Risk**: Without structured acceptance criteria, validators don't know what to check, and there's no traceable link between requirements and validation.

**Recommendation**: Adopt Zeroshot's acceptance criteria schema. Require planner to output AC with EARS format (from Kiro analysis). Validator must provide evidence per criterion.

---

### GAP-10: Non-Interactive Agent Execution

**What they do**: Every system prompt in ALL analyzed tools includes "YOU CANNOT ASK QUESTIONS" or equivalent. Cursor: "Do NOT wait for user confirmation." Zeroshot: blocks AskUserQuestion tool via hook.

**What Nanoprym spec says**: Human-in-loop (C06) is defined for approval gates, but no mention of ensuring agents themselves are non-interactive during execution.

**Risk**: If Claude Code prompts for input during headless execution, the process hangs.

**Recommendation**: Add non-interactive execution as an L0 Prime Brain rule. All agent prompts must include the non-interactive constraint. Claude Code CLI should be invoked with `--no-input` or equivalent flag.

---

### GAP-11: Find-and-Edit Pattern (Bulk Refactoring)

**What they do**: Devin implements `find_and_edit`: apply regex across codebase, evaluate each match with separate LLM call for context-aware edit decisions. Handles large refactors that span dozens of files.

**What Nanoprym spec says**: No mention of bulk refactoring patterns.

**Risk**: Without this pattern, renaming a function used in 50 files requires 50 sequential edit calls or a risky global find-and-replace.

**Recommendation**: Add as a Builder tool: `find_and_edit(regex, evaluator_prompt)`. Low priority for MVP but important for evolution engine (which modifies its own code).

---

### GAP-12: LSP Integration for Type-Aware Editing

**What they do**: Devin uses LSP queries (go_to_definition, find_references, hover_symbol) for type-aware refactoring. No other tool does this.

**What Nanoprym spec says**: No mention of LSP integration.

**Risk**: Without LSP, type-checking is post-hoc (run tsc, find errors, fix). With LSP, agents can navigate code by type relationships, reducing errors.

**Recommendation**: Defer to post-MVP. TypeScript compiler API can serve as a lightweight alternative (cheaper than full LSP server).

---

### GAP-13: Semantic Search Deduplication for KB

**What they do**: Windsurf's memory system checks for semantically similar entries before storing new ones. Prevents knowledge base bloat.

**What Nanoprym spec says**: KB growth mentioned but no deduplication strategy.

**Risk**: KB grows linearly with tasks. After 1000 tasks, searching becomes slow and results noisy.

**Recommendation**: Before inserting new KB entry, query Qdrant for semantic similarity. If cosine similarity > 0.92, merge instead of creating new entry. Add as KB concern.

---

### GAP-14: Rate Limit Handling with Backoff

**What they do**: Zeroshot classifies errors as retryable vs permanent. Retryable errors get exponential backoff. All system prompts analyzed mention rate limiting as a concern.

**What Nanoprym spec says**: No mention of API rate limiting or backoff strategy.

**Risk**: Claude API rate limits (especially on Opus) can stall the entire pipeline without proper backoff.

**Recommendation**: Add rate limit handling in provider layer. Exponential backoff: base_delay × 2^(attempt-1). Max 3 retries for retryable, immediate fail for permanent errors.

---

### GAP-15: Resume/Attach for Running Tasks

**What they do**: Zeroshot supports `resume <id>` (continue from crash) and `attach <id>` (connect to running cluster's output stream). Essential for long-running tasks.

**What Nanoprym spec says**: No resume or attach capability mentioned.

**Risk**: If a 30-minute task crashes at minute 25, all work is lost without resume.

**Recommendation**: Resume is enabled by event sourcing (GAP-01). If ledger exists, replay events to reconstruct state and continue. Add `make task-resume` to Makefile.

---

## 2. CONFLICTS — Things They Do Differently Than Our Decisions

### CONFLICT-01: Task Queue Architecture

**Nanoprym**: BullMQ + Redis for task queue with topological sort.
**Zeroshot**: Message bus + SQLite ledger. No external queue.

**Analysis**: Both work. BullMQ is better for job scheduling (cron, retry, priority). Message bus is better for agent-to-agent communication. These serve different purposes.

**Resolution**: Keep BullMQ for job scheduling (scanning cron, task ordering). Add message bus for agent communication within a task. They coexist.

---

### CONFLICT-02: Reviewer Model

**Nanoprym**: GitHub Copilot for code review.
**Zeroshot/Cursor/Devin/all others**: Same provider (Claude/etc.) for all roles, just different model levels.

**Analysis**: Using Copilot as reviewer creates a cross-provider dependency. GitHub Copilot doesn't have a reliable headless CLI for automated code review. This is a potential blocker (Task 0.4 will investigate).

**Resolution**: Keep as spec'd but add Claude as fallback reviewer. If Copilot CLI doesn't support headless review, use Claude Sonnet as reviewer with blind validation (different from builder's context). The debate mechanism still works — just two Claude sessions with different prompts arguing.

---

### CONFLICT-03: Prompt Storage Format

**Nanoprym**: Versioned `.system.md` files in `prompts/` directory.
**Zeroshot**: Prompts embedded in JSON template files.

**Analysis**: Nanoprym's approach is better for human editing and prompt evolution. Zeroshot's approach is better for parameterization (`{{complexity}}`).

**Resolution**: Keep `.system.md` files but add a thin template layer. Prompts reference brain levels and task variables: `{{L0_PRIME_BRAIN}}`, `{{TASK_TYPE}}`, `{{COMPLEXITY}}`. Template resolver injects these at runtime.

---

### CONFLICT-04: Validation Approach

**Nanoprym**: Scanner plugins (ESLint, Semgrep, Trivy, etc.) + Copilot review.
**Zeroshot**: AI-powered validators (requirements, code, security, test) that actually RUN tests and READ code.

**Analysis**: Nanoprym's scanner plugins are deterministic and cheap. Zeroshot's AI validators are thorough but expensive. Both are valuable.

**Resolution**: Two validation stages:
1. **Stage 1 (cheap, fast)**: Scanner plugins (ESLint, Semgrep, Trivy, jscpd) — deterministic, no API cost
2. **Stage 2 (expensive, thorough)**: AI validators (code quality, security, requirements) — only if Stage 1 passes

This matches Zeroshot's two-stage validation pattern but uses Nanoprym's scanner plugins for Stage 1.

---

### CONFLICT-05: Error Recovery Model

**Nanoprym**: Prime-step backtracking (1, 3, 5, 7 steps back).
**Zeroshot/Cursor/Devin**: Simple retry loop (max 3-5 attempts) with reflection step.

**Analysis**: Prime-step backtracking is novel but unproven. Reference systems converge on retry-with-reflection. Nanoprym's approach assumes granular steps exist to backtrack to.

**Resolution**: Hybrid. For within-task errors: use retry-with-reflection (max 3 attempts, think before retry). For cross-task errors: use prime-step backtracking (undo previous task outcomes). This makes both approaches applicable at their appropriate scope.

---

### CONFLICT-06: Agent Communication

**Nanoprym**: Agents are separate tools (Claude Code CLI, Copilot CLI). Communication through task queue and Git artifacts.
**Zeroshot**: Agents are processes within one orchestrator. Communication through message bus.

**Analysis**: Nanoprym's approach has more isolation but less coordination. Zeroshot's approach has tighter coordination but is a single point of failure.

**Resolution**: Adopt Zeroshot's message bus for intra-task coordination. Keep separate CLI processes for actual code generation (isolation). The orchestrator manages the message bus; agents read context from it but execute independently.

---

## 3. RISKS — Things That Look Good on Paper But Are Hard to Implement

### RISK-01: Self-Evolution Engine Complexity

**What spec says**: Weekly evolution of prompts, routing, workflow rules, validators, and own code. Sandbox testing. Auto-revert after 10 tasks if worse.

**Reality**: No reference system implements this. It requires: (a) reliable metrics per prompt version, (b) statistical significance testing with small samples, (c) safe self-modification, (d) rollback automation. Each alone is hard; combined, it's the hardest part of Nanoprym.

**Mitigation**: Start with human-triggered evolution only. No automated weekly cycle in MVP. Collect metrics from day 1, but prompt changes are manual PRs reviewed by human. Add automation in Phase 3.

---

### RISK-02: Claude vs Copilot Debate Mechanism

**What spec says**: Claude defends its code, Copilot challenges it, max 2 rounds, then Slack.

**Reality**: This requires two separate AI sessions maintaining context of an ongoing debate. Copilot's API doesn't natively support multi-turn code review discussions. Response quality degrades with artificial debate framing.

**Mitigation**: Simplify to blind review + optional re-review. Reviewer provides critique. Builder fixes. If fix rejected again, escalate to human. No "debate" — just iterate. The audit trail captures both perspectives.

---

### RISK-03: 95% Branch Coverage Target

**What spec says**: 60% overall, 95% branch coverage.

**Reality**: 95% branch coverage for AI-generated code is extremely ambitious. Even senior devs struggle with this. It encourages test-to-coverage rather than test-to-behavior.

**Mitigation**: Start with 60% overall, 80% branch. Increase targets as the system matures. Track coverage trend over time. Quality of tests matters more than coverage percentage.

---

### RISK-04: Triple Sync (Git + PG + Qdrant) for KB

**What spec says**: Every KB entry exists in Git (.md), PostgreSQL (structured), and Qdrant (vector). Daily consistency check.

**Reality**: Three-way sync is notoriously fragile. Race conditions, partial failures, schema drift. Every write must succeed in all three or roll back.

**Mitigation**: Make Git the source of truth. PG and Qdrant are derived indexes. On write: commit to Git first, then async update PG and Qdrant. On inconsistency: rebuild PG/Qdrant from Git (idempotent). This simplifies to "Git + async indexing" instead of "three-way sync."

---

### RISK-05: Real-Time Scanning + Auto-Fix

**What spec says**: Continuous scanning of repos, auto-fix bugs/security/test failures.

**Reality**: "Continuous" scanning with Claude API calls is expensive. Every scan that triggers a fix burns tokens. A repo with 100 open issues could generate enormous API costs.

**Mitigation**: Scan on schedule (not continuous). Daily or on-push, not real-time. Auto-fix only for categories with >90% success rate historically. All others require human approval. Add cost guards: max $X/day per project.

---

### RISK-06: Copilot CLI for Headless Review

**What spec says**: GitHub Copilot as reviewer agent.

**Reality**: GitHub Copilot's CLI capabilities for automated code review are limited and evolving. It may not support the headless, programmable review that Nanoprym requires.

**Mitigation**: Task 0.5.1 will test this. Fallback: use Claude with a "reviewer" prompt (different from builder). The debate mechanism becomes two Claude sessions with different system prompts — one optimistic (builder), one critical (reviewer).

---

### RISK-07: Ollama Embedding Performance

**What spec says**: Ollama + Nomic Embed Text V2 for embeddings, running locally.

**Reality**: Local embedding on MacBook will be slow for large KB. Nomic Embed is good quality but CPU inference is ~100ms per embedding. Embedding 1000 audit entries = ~2 minutes.

**Mitigation**: Batch embedding during off-hours. Pre-compute embeddings on commit (hook). For real-time RAG queries, cache hot embeddings in memory. If too slow, upgrade to Qwen3-Embedding with GPU as spec mentions.

---

### RISK-08: Agent Coordination in Worktrees

**What spec says**: Each task gets isolated worktree.

**Reality**: If Builder and Reviewer need to look at the same code, they need to be in the same worktree (or the reviewer needs to checkout the same branch). Git worktree management with concurrent agents requires careful locking.

**Mitigation**: Builder works in worktree, commits, pushes branch. Reviewer checks out same branch in a separate read-only worktree (or just reads from the branch). No concurrent writes to same worktree.

---

### RISK-09: Prompt Versioning Auto-Revert

**What spec says**: New prompt deployed, after 10 tasks compare vs previous, auto-revert if worse.

**Reality**: 10 tasks is statistically insufficient for reliable comparison. Task difficulty varies enormously — a prompt might fail on hard tasks but succeed on easy ones. Success rate comparison with n=10 has huge variance.

**Mitigation**: Increase sample size to 25-50 tasks before comparing. Use paired comparison (same tasks, different prompts) rather than sequential comparison. Report confidence intervals, not just averages. Start with manual review of prompt changes.

---

### RISK-10: Multiple Scanner Plugins Running Together

**What spec says**: ESLint, Semgrep, Trivy, jscpd, Ruff, Lighthouse, Madge, es-health, i18n-checker — all as scanner plugins.

**Reality**: Running all scanners on every commit is slow (Lighthouse alone takes 30+ seconds). Some scanners conflict or produce overlapping results.

**Mitigation**: Categorize scanners by trigger:
- On every commit: ESLint, jscpd (fast, essential)
- On PR: Semgrep, Trivy (security, medium speed)
- Weekly: Lighthouse, Madge, i18n-checker (slow, strategic)
- On demand: es-health, Ruff (project-specific)

---

## 4. SUMMARY MATRIX

| ID | Type | Severity | Action |
|----|------|----------|--------|
| GAP-01 | Gap | HIGH | Add event sourcing + message bus |
| GAP-02 | Gap | HIGH | Add context builder with token budgeting |
| GAP-03 | Gap | MEDIUM | Add state snapshot module |
| GAP-04 | Gap | MEDIUM | Add multi-indicator stuck detection |
| GAP-05 | Gap | HIGH | Make blind validation explicit |
| GAP-06 | Gap | MEDIUM | Add template-based workflow configs |
| GAP-07 | Gap | MEDIUM | Add trigger engine |
| GAP-08 | Gap | HIGH | Add complexity-based cost routing |
| GAP-09 | Gap | HIGH | Add structured acceptance criteria |
| GAP-10 | Gap | HIGH | Add non-interactive execution constraint |
| GAP-11 | Gap | LOW | Add find-and-edit tool (post-MVP) |
| GAP-12 | Gap | LOW | Add LSP integration (post-MVP) |
| GAP-13 | Gap | MEDIUM | Add semantic dedup for KB |
| GAP-14 | Gap | HIGH | Add rate limit handling with backoff |
| GAP-15 | Gap | HIGH | Add resume capability |
| CONFLICT-01 | Conflict | LOW | Coexist: BullMQ for scheduling, message bus for agents |
| CONFLICT-02 | Conflict | HIGH | Keep Copilot, add Claude as fallback reviewer |
| CONFLICT-03 | Conflict | LOW | Keep .md files, add template variables |
| CONFLICT-04 | Conflict | MEDIUM | Two-stage: scanners first, AI validators second |
| CONFLICT-05 | Conflict | MEDIUM | Hybrid: retry-with-reflection + prime-step backtracking |
| CONFLICT-06 | Conflict | MEDIUM | Message bus for coordination, CLI for execution |
| RISK-01 | Risk | HIGH | Defer automated evolution to Phase 3 |
| RISK-02 | Risk | MEDIUM | Simplify debate to blind review + iterate |
| RISK-03 | Risk | LOW | Reduce to 80% branch coverage initially |
| RISK-04 | Risk | MEDIUM | Git as source of truth, PG/Qdrant as derived indexes |
| RISK-05 | Risk | HIGH | Scheduled scanning, cost guards per project |
| RISK-06 | Risk | HIGH | Test in Task 0.5.1, Claude fallback ready |
| RISK-07 | Risk | MEDIUM | Batch embeddings, cache hot entries |
| RISK-08 | Risk | LOW | Separate worktrees for builder and reviewer |
| RISK-09 | Risk | MEDIUM | Increase sample to 25-50, paired comparison |
| RISK-10 | Risk | LOW | Categorize scanners by trigger frequency |

---

## 5. TOP PRIORITIES FOR SPEC V2

Based on this analysis, the following changes should be incorporated into NANOPRYM-SPEC-v2.md:

1. **Add event sourcing backbone** (GAP-01, GAP-15) — foundational change
2. **Add context builder with token budgeting** (GAP-02) — required for all agent calls
3. **Add complexity-based cost routing** (GAP-08) — prevents cost blowout
4. **Make blind validation explicit** (GAP-05) — quality differentiator
5. **Add non-interactive execution constraint** (GAP-10) — prevents hangs
6. **Add rate limit handling** (GAP-14) — operational necessity
7. **Resolve Copilot CLI feasibility** (CONFLICT-02, RISK-06) — potential blocker
8. **Defer automated self-evolution** (RISK-01) — reduce MVP scope
9. **Git as KB source of truth** (RISK-04) — simplify triple sync
10. **Add structured acceptance criteria** (GAP-09) — closes planning-validation loop
