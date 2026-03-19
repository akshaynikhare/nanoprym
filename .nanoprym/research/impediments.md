# Impediment Register

**Task**: 0.4
**Date**: 2026-03-19
**Purpose**: List every technical impediment before Phase 1 can start

---

## CRITICAL CLARIFICATION (Updated Post-Q&A)

**Cost Model**: Akshay intends to use **subscription plans**, NOT per-token API billing:
- **Claude Max** subscription ($200/month) — unlimited Claude Code CLI usage
- **GitHub Copilot** subscription (~$10-39/month) — unlimited code review
- **Free tiers** (Gemini, DeepSeek, OpenRouter) — for non-critical tasks
- **Local Ollama** (Qwen2.5-3B) — for offline/cheap tasks
- **TOM (Token Optimization Module)** — middleware to compress prompts + route to cheapest model

This fundamentally changes IMP-03 (costs). The primary LLM (Claude Sonnet via Claude Code CLI on Max plan) has **zero marginal cost per task**. TOM handles routing non-critical tasks to free/local models.

**Hardware**: MacBook M1 Pro, 16GB RAM. Tight but workable with careful memory management.

**Target project**: Nanoprym itself (dogfooding).

**Review model**: Simplified blind review (no debate). Copilot reviews after PR creation.

---

## IMP-01: Claude Code CLI Headless Execution

**Status**: ✅ RESOLVED — No blocker

**Finding**: Claude Code CLI fully supports headless mode via `-p` flag:
```bash
claude -p "Generate unit tests for src/auth.ts" \
  --allowedTools Read,Write,Bash \
  --max-turns 5 \
  --output-format stream-json
```

**Capabilities confirmed**:
- Non-interactive execution (no terminal required)
- Tool allowlisting (restrict which tools agent can use)
- Max turns limiting (prevent runaway execution)
- JSON and stream-JSON output formats
- Works in CI/CD pipelines
- Requires Node.js 18+ and ANTHROPIC_API_KEY

**Severity**: None
**Mitigation**: N/A — works as needed

---

## IMP-02: GitHub Copilot CLI Automated Code Review

**Status**: ✅ RESOLVED — No blocker (with caveats)

**Finding**: As of March 2026, Copilot code review supports:
- `gh pr edit --add-reviewer @copilot` — headless review request via gh CLI
- Agentic architecture (tool-calling, GA for Pro/Business/Enterprise)
- Automatic review configuration available
- CLI agent mode: `copilot --allow-all-tools -p "..."`

**Caveats**:
- Review is PR-scoped (requires a PR to exist on GitHub)
- Review results come as PR comments, not structured JSON
- No direct CLI command to get review as structured output
- Requires Copilot subscription (Pro+ recommended for agentic features)

**Severity**: LOW
**Mitigation**: Use `gh api` to fetch Copilot's PR review comments programmatically. Parse review comments into structured format. If structured output needed pre-PR, use Claude with reviewer prompt as fallback.

**Decision needed**: Should Nanoprym create the PR first (then Copilot reviews), or review code before PR creation? → See Q-01 below.

---

## IMP-03: LLM Costs (REVISED — Subscription Model)

**Status**: ✅ RESOLVED — Subscription-based

**Cost model (updated)**:

| Service | Monthly Cost | Usage |
|---------|-------------|-------|
| Claude Max subscription | ~$200/month | Unlimited Claude Code CLI (Sonnet default) |
| GitHub Copilot Pro+ | ~$39/month | Unlimited code review via gh CLI |
| Gemini Free Tier | $0 | Non-critical tasks via TOM router |
| DeepSeek API | <$5/month | Fallback for medium tasks |
| Ollama (local) | $0 | Offline/cheap tasks |
| **TOTAL** | **~$244/month** | |

**Key change**: Claude Sonnet via Claude Code CLI on Max plan has **zero marginal cost per task**. TOM module routes non-critical tasks (classification, simple extraction, KB queries) to free/local models.

**TOM monthly cloud budget**: $5 hard cap for any paid API calls outside subscriptions.

**Comparison**:
- Junior dev: $3,000-5,000/month
- Cursor Pro + Copilot: $60/month (but manual)
- Devin: $500/month
- **Nanoprym**: ~$244/month (fully autonomous)

**Severity**: None (subscription is predictable, no surprise bills)
**Mitigation**: TOM enforces $5 cloud cap. Subscriptions are fixed cost.

---

## IMP-04: MacBook Resource Limits

**Status**: ⚠️ REQUIRES MEASUREMENT

**Services to run simultaneously**:
| Service | Estimated RAM | Notes |
|---------|-------------|-------|
| PostgreSQL | ~100-200 MB | Lightweight for small datasets |
| Qdrant | ~200-500 MB | Depends on vector count |
| Redis | ~50-100 MB | Minimal for BullMQ |
| Ollama (Nomic Embed) | ~2-4 GB | Model loaded in memory |
| Node.js (Nanoprym) | ~200-500 MB | Orchestrator + agents |
| Docker overhead | ~500 MB | If using Docker Compose |
| **Total** | **~3-6 GB** | |

**Key finding**: On Apple Silicon (M1/M2/M3/M4), Docker cannot access GPU. Ollama runs faster natively (Metal framework) than in Docker.

**Recommended approach**:
- Run Ollama natively (not in Docker) for GPU acceleration
- Run PG, Qdrant, Redis in Docker Compose
- Run Nanoprym natively (Node.js)

**Minimum hardware**: 16 GB RAM (with 32 GB+ recommended)

**Severity**: LOW (assuming 16 GB+ MacBook)
**Mitigation**: Run Ollama natively. Use Docker memory limits for PG/Qdrant/Redis. Lazy-load Ollama model (only when embedding needed, unload after).

**Decision needed**: What MacBook specs do you have? → See Q-03 below.

---

## IMP-05: GitHub API Rate Limits

**Status**: ✅ RESOLVED — No blocker

**Limits**:
- Authenticated REST API: 5,000 requests/hour
- GitHub Actions GITHUB_TOKEN: 1,000 requests/hour/repo
- Enterprise org apps: 15,000 requests/hour

**Nanoprym usage estimate** (per task):
- Create branch: 1 call
- Create/update PR: 2-3 calls
- Read issue: 1 call
- Post comments: 2-5 calls
- Check CI status: 3-5 calls
- **Total per task: ~10-15 calls**

**At 5 tasks/day**: ~75 calls/day = ~3 calls/hour. Well under 5,000 limit.

**Severity**: None
**Mitigation**: N/A. Even at 50 tasks/day, only ~750 calls/day.

---

## IMP-06: Slack API Rate Limits

**Status**: ✅ RESOLVED — No blocker

**Limits**:
- Web API: ~1 request/second per method per workspace (Tier 2-4 varies)
- Events API: No rate limit on receiving
- Message posting: ~1 msg/second

**Nanoprym usage**: A few messages per task (start, completion, failures, daily summary). Well under limits.

**Severity**: None
**Mitigation**: N/A.

---

## IMP-07: Ollama Embedding Speed

**Status**: ⚠️ REQUIRES TESTING (Task 0.5.1)

**Expected performance** (Nomic Embed Text V2, Apple Silicon):
- CPU: ~100ms per embedding
- GPU (Metal, native): ~10-30ms per embedding
- 1,000 entries: ~10-100 seconds depending on mode

**Use cases**:
- Real-time RAG query: 1 embedding (query) + vector search = <200ms ✅
- Bulk KB indexing: 1,000 entries = ~30s with GPU ✅
- Full audit trail embedding: depends on volume

**Severity**: LOW
**Mitigation**: Batch embedding during off-hours. Pre-compute on commit hooks. Cache hot embeddings. Upgrade to Qwen3-Embedding-8B for GPU later.

---

## IMP-08: Worktree Concurrency and Git Locking

**Status**: ⚠️ DESIGN DECISION NEEDED

**Issue**: Git worktrees share the same `.git` directory. Concurrent git operations from multiple agents in different worktrees can cause lock conflicts.

**Scenarios**:
- Builder committing in worktree A while Reviewer reads from worktree B → OK (read is safe)
- Two builders committing simultaneously → LOCK CONFLICT
- Builder committing while scanner runs `git log` → OK usually, occasional lock

**Severity**: MEDIUM
**Mitigation**: Sequential task execution (already in spec — one task at a time). Builder and Reviewer never write to same worktree simultaneously. Add git lock retry with backoff (3 attempts, 1s/2s/4s delay).

---

## IMP-09: Claude Code Context Window vs Codebase Size

**Status**: ⚠️ REQUIRES STRATEGY

**Claude context windows** (March 2026):
- Sonnet 4.6: 200K tokens standard (400K+ extended)
- Opus 4.6: 200K tokens
- Haiku 4.5: 200K tokens

**A typical project** might have:
- 50-200 source files
- 10,000-50,000 lines of code
- ~200K-1M tokens if loaded entirely

**Issue**: Cannot feed entire codebase to agent. Must select relevant context.

**Severity**: HIGH (for large projects)
**Mitigation**: This is GAP-02 (context builder with token budgeting). Also:
- Use semantic search (Qdrant) to find relevant code for each task
- Brain hierarchy provides architectural context without full codebase
- Plan acceptance criteria specify exactly which files to touch
- Prompt caching for repeated context (L0/L1 brains)

---

## IMP-10: Self-Evolution Sandbox Isolation

**Status**: ⚠️ DEFER TO PHASE 3

**Issue**: Spec requires Nanoprym to modify its own code in a Docker sandbox, test itself, and PR changes. This is the hardest feature to implement safely.

**Concerns**:
- Self-modifying code is inherently risky
- Testing "does this prompt produce better code" requires controlled experiments
- Small sample sizes (10 tasks) are statistically unreliable
- Rollback must be guaranteed

**Severity**: HIGH (but not a Phase 1 blocker)
**Mitigation**: Defer automated self-evolution to Phase 3. In Phase 1-2, collect metrics. In Phase 3, implement manual-triggered evolution with human review of every change. Full automation in Phase 4+.

---

## IMP-11: Prompt Caching Strategy

**Status**: ⚠️ DESIGN DECISION NEEDED

**Opportunity**: Claude's prompt caching charges 10% of input price for cache hits. L0 Prime Brain and L1 Project Brain are identical across all calls for a project.

**Savings potential**:
- L0 brain: ~2K tokens, used in every call
- L1 brain: ~5K tokens, used in every call for a project
- At 100 calls/day: 700K tokens cached = saves ~$1.89/day (Sonnet) = ~$41/month

**Implementation**: Use system prompt with `cache_control` breakpoints. First call primes the cache, subsequent calls hit it.

**Severity**: LOW (optimization, not blocker)
**Mitigation**: Implement in Phase 1 as part of provider abstraction.

---

## IMP-12: Testing Nanoprym Itself

**Status**: ⚠️ DESIGN DECISION NEEDED

**Issue**: How do you test an AI orchestration system? Unit tests for utilities are straightforward, but testing "does the planner produce good plans" requires:
- Mock providers (fake Claude responses)
- Integration tests with real API calls (expensive)
- Evaluation datasets (curated task + expected output pairs)

**Severity**: MEDIUM
**Mitigation**:
- Unit tests: pure functions, config validation, template resolution, ledger operations
- Integration tests: mock provider that returns canned responses
- E2E tests: small set of real API calls against a test repo (run weekly, not on every commit)
- Evaluation: maintain 10-20 curated tasks with expected outcomes for prompt regression testing

**Decision needed**: Budget for E2E test API calls? → See Q-04 below.

---

## Summary Table

| ID | Impediment | Severity | Status | Blocker? |
|----|-----------|----------|--------|----------|
| IMP-01 | Claude Code headless | None | ✅ Resolved | No |
| IMP-02 | Copilot CLI review | LOW | ✅ Resolved (caveats) | No |
| IMP-03 | LLM costs (subscription) | None | ✅ Resolved | No |
| IMP-04 | MacBook resources | LOW | ⚠️ Needs specs | No |
| IMP-05 | GitHub API limits | None | ✅ Resolved | No |
| IMP-06 | Slack API limits | None | ✅ Resolved | No |
| IMP-07 | Ollama embedding speed | LOW | ⚠️ Test in 0.5.1 | No |
| IMP-08 | Git worktree locking | MEDIUM | ⚠️ Design needed | No |
| IMP-09 | Context window vs codebase | HIGH | ⚠️ Strategy needed | No (with context builder) |
| IMP-10 | Self-evolution sandbox | HIGH | ⚠️ Defer to Phase 3 | No (deferred) |
| IMP-11 | Prompt caching | LOW | ⚠️ Design in Phase 1 | No |
| IMP-12 | Testing strategy | MEDIUM | ⚠️ Design needed | No |

**Result: No hard blockers identified.** All impediments have mitigations. Key decisions needed from human (see questions below).

---

## Sources

- [Claude Code Headless Mode Docs](https://code.claude.com/docs/en/headless)
- [GitHub Copilot CLI Code Review](https://github.blog/changelog/2026-03-11-request-copilot-code-review-from-github-cli/)
- [Copilot Code Review Agentic Architecture](https://github.blog/changelog/2026-03-05-copilot-code-review-now-runs-on-an-agentic-architecture/)
- [Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [GitHub API Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Qdrant Memory Consumption](https://qdrant.tech/articles/memory-consumption/)
