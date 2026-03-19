# Decisions Log — Phase 0 Q&A

**Date**: 2026-03-19
**Status**: All open questions resolved

---

## Architecture Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D-01 | Review timing | After PR creation | Copilot reviews via `gh pr edit --add-reviewer @copilot`. Claude as fallback. |
| D-02 | Review style | Simplified blind review | No debate. Reviewer critiques → Builder fixes → re-review → escalate after 2 rejections. |
| D-03 | Cost model | Subscription-based | Claude Max (~$200/mo), Copilot Pro+ (~$39/mo), free tiers, local Ollama. No per-token API. |
| D-04 | Monthly cloud budget (TOM) | $5 hard cap | For non-subscription API calls only (DeepSeek, Gemini paid tier). |
| D-05 | Hardware | MacBook M1 Pro, 16GB RAM | Tight but workable with careful memory management. |
| D-06 | Default model | Sonnet (via Claude Max) | Zero marginal cost per task on subscription. |
| D-07 | Target project | Nanoprym itself (dogfooding) | Bootstrap: Nanoprym builds and improves itself. |
| D-08 | Vector DB | Qdrant (keep in MVP) | Semantic search from day 1. Accept RAM cost (~200-500MB). |
| D-09 | TOM language | Python sidecar | spaCy NLP quality >> JS alternatives. 50MB fixed RAM. Unix socket communication. |
| D-10 | TOM routing rule | Smart bypass | First-time code gen + complex ops → Claude directly. Iterations → TOM compression. Auxiliary → TOM routing to cheapest model. |
| D-11 | Bootstrap approach | AI-assisted from day 1 | Claude Code generates scaffolding/boilerplate. Human reviews everything. |
| D-12 | KB search | Qdrant (not SQLite FTS) | User wants full semantic search capability in MVP. |

## MVP Scope (18 of 20 concerns)

### IN MVP

| Concern | ID | Phase |
|---------|-----|-------|
| Agent Orchestration | C01 | Phase 1 |
| Task Management | C02 | Phase 1 |
| Multi-Model Routing + TOM | C03 | Phase 1 |
| Audit Trail | C04 | Phase 1 |
| Self-Evolution Engine | C05 | Phase 2-3 |
| Human-in-Loop (Slack) | C06 | Phase 2 |
| Knowledge Base (Qdrant) | C07 | Phase 2 |
| Code Generation (Builder) | C08 | Phase 1 |
| Code Review (Reviewer) | C09 | Phase 1 |
| Testing Automation | C10 | Phase 1 |
| Git Workflow | C11 | Phase 1 |
| Project Isolation | C12 | Phase 2 |
| Error Recovery | C13 | Phase 1 |
| Prompt Management | C14 | Phase 1 |
| Metrics & Reporting | C15 | Phase 2 |
| Configuration | C16 | Phase 1 |
| Security | C17 | Phase 1 |
| Plugin System | C20 | Phase 2-3 |

### NOTHING DEFERRED — ALL 20 IN MVP

| Concern | ID | Phase |
|---------|-----|-------|
| Persistence (PostgreSQL) | C18 | Phase 2 |
| Full CLI Interface | C19 | Phase 2 |

**Decision updated 2026-03-19**: Akshay wants ALL 20 concerns in MVP. No cuts. Full spec = MVP.

## TOM Integration Rules

```
IF task.type == "first_code_gen":
    → Claude Code CLI directly (no TOM)
IF task.type == "complex" (architecture, security review, RCA):
    → Claude Code CLI directly (no TOM)
IF task.type == "iteration" (retry, fix, refine):
    → TOM compression → Claude Code CLI (save tokens on input)
IF task.type == "auxiliary" (classify, summarize, KB query, report):
    → TOM routing → cheapest available model (Gemini Free > DeepSeek > local)
```

## Memory Budget (16GB)

| Process | RAM (MB) |
|---------|----------|
| macOS + Desktop Apps | 4,500 |
| Ollama (Qwen2.5-3B Q4) | 2,500 |
| Qdrant | 300 |
| Nanoprym Orchestrator (Node.js) | 500 |
| SQLite + Redis | 300 |
| TOM sidecar (Python + spaCy) | 80 |
| Headroom / Swap | ~7,820 |
| **TOTAL** | **16,000** |
