# System Prompts Deep-Dive: AI Coding Agents

**Task**: 0.1
**Date**: 2026-03-19
**Source**: github.com/x1xhlol/system-prompts-and-models-of-ai-tools
**Tools Analyzed**: Cursor, Devin, Claude Code, Kiro, Windsurf, Manus, Replit, Lovable, Augment Code, Traycer AI, v0

---

## Executive Summary

Analysis of 11 production AI coding agents reveals strong convergence on core patterns: discovery-before-action, read-before-edit, parallel tool execution, structured task tracking, and safety-first command execution. Key differentiators emerge in agent loop design (parallel vs sequential), context management (persistent memory vs session-only), planning approaches (spec-driven vs freeform), and autonomy levels. This report extracts patterns directly applicable to Nanoprym's architecture.

---

## 1. Agent Loop Architectures

### 1.1 Loop Models Observed

| Agent | Loop Model | Parallelism | Autonomy Level |
|-------|-----------|-------------|----------------|
| Cursor | Discovery → Plan → Execute → Verify | 3-5 tools/batch, DEFAULT PARALLEL | Very High (no user confirmation) |
| Devin | Planning Mode → Standard Mode (approved) | Multiple commands per turn | High (plan requires approval) |
| Claude Code | Read → Edit → Verify (minimal) | Concurrent sub-agents | High (concise, autonomous) |
| Kiro | Classify → Spec/Do → Execute task | Single task at a time | Managed (user gates each phase) |
| Windsurf | Observe → Plan → Act → Verify | Parallel tool calls | High (safe ops auto-run) |
| Manus | Analyze → Select → Execute → Iterate | ONE tool per iteration | Moderate (sequential, observable) |
| v0 | Gather → Plan → Implement → Verify | Parallel reads, sequential writes | High (auto-implements) |

### 1.2 Key Insight for Nanoprym

Two viable models emerge:

**High-throughput (Cursor/Windsurf style)**: 3-5 parallel tool calls per batch, 3-5x faster. Best for Nanoprym's Builder agent where speed matters.

**High-observability (Manus style)**: One action per iteration, perfect audit trail. Best for Nanoprym's Reviewer agent where traceability matters.

**Recommendation**: Nanoprym should implement BOTH models. Builder uses parallel batching. Reviewer uses sequential with full event logging.

---

## 2. Tool System Design Patterns

### 2.1 Universal Tool Categories

Every agent implements these categories (with varying granularity):

| Category | Tools | Notes |
|----------|-------|-------|
| **File Navigation** | find, grep, semantic search, read | 3 search types is the sweet spot |
| **File Mutation** | edit (str_replace), write (create), delete | Edit preferred over write |
| **Command Execution** | shell/terminal with session management | Always non-interactive |
| **Task Tracking** | todo/task list with states | pending → in_progress → completed |
| **Memory/Context** | persistent memory, context retrieval | Varies: some session-only |
| **Web/Browser** | search, navigate, screenshot, DOM | For research and testing |

### 2.2 Search Strategy Hierarchy (Cursor/Windsurf/Devin consensus)

```
1. Semantic search first   → "How does authentication work?" (intent)
2. Exact/grep search       → "functionName", regex patterns (precision)
3. File name search        → Fuzzy/glob when path partially known
4. LSP queries (Devin)     → go_to_definition, hover_symbol (type-aware)
5. Web search              → External docs, current events (fallback)
```

### 2.3 Edit Tool Design (Universal Pattern)

All agents converge on `str_replace` as the primary edit mechanism:
- Requires exact old_string matching (including whitespace)
- old_string must be unique in file
- Read-before-edit is mandatory (Cursor: within last 5 messages)
- Max 3 retry attempts before escalating
- Prefer edit over full file rewrite

### 2.4 Recommendations for Nanoprym

- Implement 3-tier search: semantic (Qdrant), exact (ripgrep), file (fd)
- Use str_replace as primary edit strategy for Builder agent
- Add LSP integration for type-aware refactoring (Devin's strongest pattern)
- Shell commands: always non-interactive, session-tracked, with timeout management
- `find_and_edit` (Devin pattern): regex-match across files, evaluate each match with separate LLM call — excellent for large refactors

---

## 3. Context Management Strategies

### 3.1 Context Gathering (Pre-Action)

All agents follow a discovery-first methodology:

```
Phase 1: Broad semantic search (understand architecture)
Phase 2: Targeted grep/find (locate specific code)
Phase 3: File reading (understand implementation details)
Phase 4: LSP/type queries (understand interfaces)
Phase 5: External research (docs, web search)
```

**Critical Rule (all agents)**: "NEVER assume a library is available. Always check package.json/Cargo.toml/etc."

### 3.2 Memory Systems Comparison

| Agent | Persistence | Scope | Mechanism |
|-------|------------|-------|-----------|
| Cursor | Cross-session | Global | `update_memory` (create/update/delete) |
| Windsurf | Cross-session | Per-workspace (corpus) | `create_memory` with semantic dedup |
| Devin | Session-only | Per-task | LSP state + shell sessions |
| Claude Code | Session-only | Per-conversation | TodoWrite for tracking |
| Manus | Session-only | Per-task | Event stream + todo.md |
| Augment | Cross-session | Per-user | Memories from previous interactions |
| Kiro | Project-level | Per-feature | .kiro/specs/ + .kiro/steering/ |

### 3.3 Recommendations for Nanoprym

- **Knowledge Base (KB)**: Map to Kiro's steering files + Cursor's memory system
- **Per-project context**: Store in `.nanoprym/kb/` as markdown (already in spec)
- **Semantic dedup**: When storing learnings, check for semantically similar entries first (Windsurf pattern)
- **Event stream**: Adopt Manus pattern for audit trail — chronological log of all agent actions/observations
- **Context staleness**: Re-read files if >5 tool calls since last read (Cursor's rule)

---

## 4. Task Planning & Decomposition

### 4.1 Planning Approaches

**Spec-Driven (Kiro)** — Most structured:
```
Requirements (EARS format) → Design (architecture doc) → Tasks (checkbox list)
   ↓ user approval          ↓ user approval           ↓ user approval
```
- Each phase requires explicit user approval before advancing
- Tasks are "prompts for a code-generation LLM"
- Requirement traceability: every task maps to specific acceptance criteria

**Plan-Then-Execute (Devin/v0)** — Balanced:
```
Planning Mode (explore + research) → suggest_plan → User approves → Execute
```
- Agent gathers comprehensive context before committing
- Plan includes specific files, locations, verification steps

**Autonomous Todo (Cursor/Windsurf)** — Fastest:
```
Create todo list → Start executing → Update as you go → Verify at end
```
- No approval gates, maximum autonomy
- Tasks: ≤14 words, verb-led, ≥5 min work each (Cursor)

**Module-Driven (Manus)** — Most observable:
```
Planner module provides numbered pseudocode → Agent follows steps sequentially
```
- External planner, not self-planned
- todo.md as granular supplement to plan

### 4.2 Task State Management (Consensus)

All agents implementing task tracking use the same states:
```
pending → in_progress → completed
                      → cancelled (some agents)
```

Rules across all agents:
- Exactly ONE task in_progress at a time
- Mark complete IMMEDIATELY after finishing (no batching)
- Never include operational overhead as tasks (linting, searching)
- Tasks should represent meaningful units of work

### 4.3 Recommendations for Nanoprym

**Adopt Kiro's 3-phase spec approach** for feature development:
1. Requirements → `specs/{feature}/requirements.md` (EARS format)
2. Design → `specs/{feature}/design.md` (architecture + Mermaid diagrams)
3. Tasks → `specs/{feature}/tasks.md` (checkbox list, each task = agent prompt)

**Adopt Cursor's autonomous todo** for bug fixes and small changes.

**Task sizing**: Each task should take ~20 minutes for a professional dev (Augment Code's guideline), be ≤14 words (Cursor), and be directly executable by a coding agent without clarification (Kiro).

---

## 5. Code Generation Rules (Consensus)

### 5.1 Universal Rules

These rules appear in virtually ALL analyzed agents:

1. **Read before edit** — Always examine existing code conventions first
2. **Match existing style** — Naming, imports, frameworks, error handling
3. **Never assume libraries** — Check package manifests before using
4. **Minimal changes** — Only modify what's needed, don't reformat unrelated code
5. **Immediately runnable** — All imports, dependencies, configs included
6. **No TODO comments** — Implement, don't defer
7. **No unnecessary files** — Prefer editing existing over creating new
8. **Guard clauses** — Early returns, handle errors first, minimize nesting

### 5.2 Naming & Style (Cursor's HIGH-VERBOSITY)

```
DO:  generateDateString, numSuccessfulRequests, handleUserAuthentication
DON'T: genYmdStr, n, handleAuth
```

- Full words over abbreviations
- Functions = verbs/verb-phrases
- Variables = nouns/noun-phrases
- Comments explain "why" not "how"
- No inline comments
- Explicit type annotations on function signatures

### 5.3 Recommendations for Nanoprym

Embed these as **L0 Prime Brain rules** (hardcoded, never overridden):
- Read-before-edit enforced at tool level
- Style matching via KB patterns per project
- Library verification mandatory before use
- HIGH-VERBOSITY naming enforced in review

---

## 6. Error Handling & Recovery

### 6.1 Common Patterns

| Pattern | Used By | Description |
|---------|---------|-------------|
| 3-attempt retry loop | Cursor, Devin | Max 3 retries on same file/test, then escalate |
| Re-read after failure | All | Re-read file before retrying edit |
| Think/reflect step | Devin, Manus | `<think>` before major decisions or after failures |
| Alternative approach | All | If approach A fails 3x, try approach B |
| Escalate to human | All | After exhausting retries, ask for help |
| Environment issue reporting | Devin | Report env issues, don't try to fix them |
| CI fallback | Devin | If local env broken, use CI instead |

### 6.2 Safety Patterns

| Pattern | Used By | Description |
|---------|---------|-------------|
| Never modify tests | Devin | Assume code is wrong, not test (unless told otherwise) |
| Never force push | Devin, Claude Code | Ask for help if push fails |
| Never `git add .` | Devin, Claude Code | Explicitly specify files |
| Safety assessment | Windsurf | `SafeToAutoRun` boolean on every command |
| Non-interactive cmds | All | Always use `-y`, `-f` flags, no stdin prompts |

### 6.3 Recommendations for Nanoprym

- **Error Recovery Flow**: attempt → reflect → retry (max 3) → alternative approach → escalate
- **Mandatory reflection**: Before retrying, agent must reason about root cause (Devin's `<think>`)
- **Test integrity**: Never modify tests without explicit approval
- **Git safety**: Explicit file staging, no force push, branch naming convention
- **SafeToAutoRun**: Classify every shell command as safe/unsafe before execution

---

## 7. Self-Evolution & Learning

### 7.1 Current State of the Art

Most agents have LIMITED self-improvement:

| Agent | Learning Mechanism | Persistence |
|-------|-------------------|-------------|
| Cursor | `update_memory` for patterns/preferences | Cross-session |
| Windsurf | `create_memory` with semantic dedup | Cross-session, per-workspace |
| Augment | Memories from previous interactions | Cross-session |
| Kiro | Steering files + specs | Project-level, human-maintained |
| Devin | None persistent | Session-only |
| Manus | Knowledge module events | Per-task injection |

**Gap identified**: No agent implements systematic self-evolution of its own prompts or workflows. This is Nanoprym's key differentiator.

### 7.2 Recommendations for Nanoprym's Self-Evolution Engine

Build on what works, add what's missing:

1. **Outcome tracking** (new): After every task, record success/failure/corrections
2. **Pattern extraction** (new): Weekly analysis of outcomes to extract new rules
3. **Prompt mutation** (new): A/B test prompt variations, keep winners
4. **KB growth** (Kiro-inspired): Auto-update project KB from successful patterns
5. **Memory with semantic dedup** (Windsurf): Prevent knowledge base bloat
6. **Human correction capture** (new): When human corrects agent, store correction as rule

---

## 8. Unique Patterns Worth Adopting

### 8.1 Devin: `find_and_edit` (Regex + Per-Match LLM)

Apply regex across codebase, send each match to separate LLM for context-aware edit decision. Perfect for large refactors.

### 8.2 Cursor: Mandatory Status Updates

Status updates before every tool batch. Narrative style ("I found...", "I'll..."). Prevents user confusion, creates audit trail.

### 8.3 Kiro: EARS Requirements Format

```
WHEN [event] THEN [system] SHALL [response]
IF [precondition] THEN [system] SHALL [response]
```
Precise, testable, unambiguous acceptance criteria.

### 8.4 Manus: Event Stream Architecture

All state externalized as chronological events. Perfect auditability and ability to resume interrupted tasks.

### 8.5 Windsurf: Trajectory Search

Search within past conversations semantically. Allows agents to learn from previous session context without storing everything in memory.

### 8.6 Augment: Git Commit Retrieval

Search past git commits to understand how similar changes were made historically. Valuable context for making consistent changes.

### 8.7 Traycer: Phase-Based Tech Lead

Read-only tech lead that breaks tasks into phases BEFORE any code is written. Separation of planning (no code access) from execution.

### 8.8 v0: Design Inspiration Generation

Sub-agent that generates design specs before implementation. Separates creative decisions from coding.

---

## 9. Anti-Patterns to Avoid

1. **No persistent learning** (Devin, Manus) — Session-only context means re-learning everything
2. **Over-prompting** (some agents have 800+ line prompts) — Diminishing returns, use hierarchical prompts
3. **Single tool per iteration** (Manus) — Too slow for code generation; reserve for review only
4. **No type awareness** (most agents lack LSP) — Leads to type errors in refactoring
5. **Infinite retry loops** — Without reflection step, retrying doesn't help
6. **Test modification** — Changing tests to make them pass is the #1 agent anti-pattern

---

## 10. Architecture Mapping to Nanoprym

### Brain Hierarchy Mapping

| Nanoprym Level | Maps to | Source Patterns |
|----------------|---------|----------------|
| L0 Prime Brain | System prompt + safety rules | Cursor's core rules, Devin's safety constraints |
| L1 Project Brain | Per-project context | Kiro's steering files, Windsurf's corpus-scoped memory |
| L2 Module Brain | Per-module conventions | KB entries from code analysis |
| L3 Task Brain | Per-task instructions | Kiro's task prompts from specs |

### Agent Mapping

| Nanoprym Agent | Maps to | Key Patterns to Adopt |
|---------------|---------|----------------------|
| Planner | Traycer (read-only tech lead) + Kiro (spec phases) | Phase decomposition, EARS requirements |
| Builder | Cursor (parallel execution) + Devin (LSP-aware) | 3-5 tool batches, find_and_edit, type checking |
| Reviewer | Manus (sequential observability) + Devin (safety) | One-action-per-step, never modify tests |
| Validator | Cursor (linter loop) + Devin (CI fallback) | 3-attempt max, CI as fallback |

### Tool System Mapping

```
Nanoprym Tool Layer:
├── Search: semantic (Qdrant) + exact (ripgrep) + file (fd) + LSP
├── Edit: str_replace (primary) + find_and_edit (bulk refactor)
├── Execute: shell with session tracking + safety classification
├── Git: explicit staging + branch naming + no force push
├── Track: todo with merge semantics + event stream audit log
├── Memory: KB (markdown) + vector store (Qdrant) + semantic dedup
└── Communicate: Slack notifications + status updates
```

---

## 11. Prompt Design Principles (Meta-Analysis)

### What makes effective agent prompts:

1. **Constraints over instructions** — "NEVER do X" more effective than "try to do Y"
2. **Examples > descriptions** — Show don't tell (all top agents include examples)
3. **Hierarchical rules** — Safety > user instructions > agent judgment
4. **Negative examples** — "DON'T: genYmdStr" alongside "DO: generateDateString"
5. **Tool selection guidance** — Explicit rules for when to use which tool
6. **Self-correction rules** — "If you forgot X, correct immediately next turn"
7. **Escape hatches** — Clear escalation paths (ask user, report issue, try alternative)
8. **Verbosity control** — Cursor/Claude Code enforce extreme conciseness (<4 lines)

### Prompt Structure (Best Practice Synthesis)

```
1. Identity & Role
2. Core Behavioral Rules (safety, constraints)
3. Tool Definitions & Selection Rules
4. Code Generation Standards
5. Error Handling & Recovery
6. Communication Protocol
7. Examples (positive + negative)
8. Self-Correction Mechanisms
```

---

## 12. Summary: Top 10 Actionable Takeaways for Nanoprym

1. **Parallel tool execution** for Builder (3-5 tools/batch), sequential for Reviewer
2. **3-tier search**: semantic + exact + file name (all agents converge on this)
3. **str_replace as primary edit** with read-before-edit enforced at tool level
4. **Kiro's 3-phase specs** for features: requirements → design → tasks
5. **EARS format** for acceptance criteria (testable, unambiguous)
6. **Event stream audit log** (Manus): every action logged chronologically
7. **find_and_edit** (Devin): regex + per-match LLM evaluation for bulk refactors
8. **3-attempt retry with reflection**: attempt → think → retry → escalate
9. **Self-evolution is the gap**: No agent does it well — Nanoprym's differentiator
10. **Prompt hierarchy**: L0 (safety/universal) → L1 (project) → L2 (module) → L3 (task)

---

## Appendix: Files Analyzed

```
Cursor Prompts/Agent Prompt v1.0.txt
Cursor Prompts/Agent Prompt v1.2.txt
Cursor Prompts/Agent Prompt 2.0.txt
Cursor Prompts/Agent Prompt 2025-09-03.txt
Cursor Prompts/Agent CLI Prompt 2025-08-07.txt
Cursor Prompts/Chat Prompt.txt
Devin AI/Prompt.txt
Devin AI/DeepWiki Prompt.txt
Anthropic/Claude Code 2.0.txt
Anthropic/Claude Sonnet 4.6.txt
Anthropic/Sonnet 4.5 Prompt.txt
Kiro/Mode_Clasifier_Prompt.txt
Kiro/Spec_Prompt.txt
Kiro/Vibe_Prompt.txt
Windsurf/Prompt Wave 11.txt
Windsurf/Tools Wave 11.txt
Manus Agent Tools & Prompt/Prompt.txt
Manus Agent Tools & Prompt/Agent loop.txt
Manus Agent Tools & Prompt/Modules.txt
Replit/Prompt.txt
Lovable/Agent Prompt.txt
Augment Code/claude-4-sonnet-agent-prompts.txt
Traycer AI/phase_mode_prompts.txt
v0 Prompts and Tools/Prompt.txt
```
