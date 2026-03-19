# Risk Register for Nanoprym

## Task 0.5.4 — Top risks to Nanoprym project success

---

## RISK-01: Scope Creep (All 20 Concerns in MVP)

| Attribute | Value |
|-----------|-------|
| **Probability** | HIGH |
| **Impact** | HIGH |
| **Risk Score** | 9/10 |

**Description**: Attempting to deliver all 20 concerns in a single MVP release will delay launch, consume budget, and increase the risk of systematic failure (if core agent fails, entire project fails).

**Mitigation Strategy**:
1. **Phase the 20 concerns across 3 phases**:
   - **Phase 1 (Core)**: 11 core concerns (agent loop, builder, reviewer, TOM, KB, basic monitoring)
   - **Phase 2 (Ecosystem)**: Advanced concerns (self-evolution, multi-repo, advanced caching)
   - **Phase 3 (Hardening)**: Production polish (legal, SOC2, advanced telemetry)
2. **Gate progression**: Don't start Phase 2 until Phase 1 works end-to-end
3. **Accept Phase 2/3 deferral** if timeline pressure mounts

---

## RISK-02: 16GB RAM Insufficient for All Services

| Attribute | Value |
|-----------|-------|
| **Probability** | MEDIUM |
| **Impact** | MEDIUM |
| **Risk Score** | 6/10 |

**Description**: Running Ollama, Qdrant, PostgreSQL, and other services on 16GB RAM could hit memory limits under concurrent task load, causing OOM kills or performance degradation.

**Mitigation Strategy**:
1. **Optimize Ollama**: Run natively with Metal GPU acceleration (no Docker overhead)
2. **Lazy-load models**: Load Qwen2.5-3B only when needed; unload after task completion
3. **Docker memory limits**: Cap each service (Ollama: 6GB, Qdrant: 2GB, DB: 1GB, Agent: 2GB, Reserve: 4GB)
4. **Measured capacity estimate**: ~8.3GB total under typical load (headroom available)
5. **Fallback plan**: If memory pressure becomes chronic, reduce Qdrant collection size or defer Qdrant to Phase 2

---

## RISK-03: Claude Code CLI Behavior Changes (API/CLI Updates)

| Attribute | Value |
|-----------|-------|
| **Probability** | MEDIUM |
| **Impact** | HIGH |
| **Risk Score** | 8/10 |

**Description**: Anthropic may update the Claude Code CLI API, behavior, or rate limits, breaking Nanoprym's integration.

**Mitigation Strategy**:
1. **Pin CLI version** in dependencies (document the pinned version in README)
2. **Abstract provider interface**: All CLI calls go through a `ClaudeCodeProvider` class; swap implementations if needed
3. **Monitor for updates**: Check CLI release notes monthly
4. **Test against new versions** before upgrading in production
5. **Maintain fallback**: If CLI breaks, route via REST API as last resort

---

## RISK-04: Copilot Review Quality Insufficient for Automated Pipeline

| Attribute | Value |
|-----------|-------|
| **Probability** | MEDIUM |
| **Impact** | MEDIUM |
| **Risk Score** | 6/10 |

**Description**: GitHub Copilot may miss bugs, security issues, or code quality problems, leading to bad PRs merged into production.

**Mitigation Strategy**:
1. **Claude Sonnet as fallback reviewer**: If Copilot score is low or confidence is uncertain, trigger blind Sonnet review
2. **Blind review prompt**: Reviewer doesn't know Copilot's decision; evaluates code independently
3. **Track quality metrics**: Compare Copilot vs Claude review decisions over time (e.g., bugs found, false positives)
4. **Iterative tuning**: Adjust thresholds and prompts based on observed accuracy
5. **Human override**: Always allow manual review before merge for critical code

---

## RISK-05: Self-Evolution Produces Regressions

| Attribute | Value |
|-----------|-------|
| **Probability** | HIGH |
| **Impact** | HIGH |
| **Risk Score** | 9/10 |

**Description**: Self-evolution (Agent modifying its own prompts/logic) could accidentally degrade performance, break existing workflows, or create infinite loops.

**Mitigation Strategy**:
1. **Sandbox testing**: Every evolution candidate runs in isolated test environment before applying to production agent
2. **Manual review**: Every evolution PR requires human review and approval before merge
3. **Auto-revert safeguard**: If task success metrics worsen after 25 consecutive tasks, auto-revert to previous agent version
4. **Phased rollout**: Start with manual-triggered evolution only (not automatic); move to autonomous after 100 successful manual evolutions
5. **Metrics guardrails**: Monitor task success rate, cycle time, cost per task; fail-safe if any metric degrades >5%

---

## RISK-06: AI-Generated Code Not Production-Ready

| Attribute | Value |
|-----------|-------|
| **Probability** | MEDIUM |
| **Impact** | HIGH |
| **Risk Score** | 8/10 |

**Description**: AI-generated code may contain subtle bugs, security vulnerabilities, or performance problems not caught by automated review.

**Mitigation Strategy**:
1. **Blind validation**: Separate team member (or Claude Code in blind mode) reviews code without knowing it's AI-generated
2. **Scanner plugins**:
   - ESLint (code quality)
   - Semgrep (security patterns)
   - Trivy (dependency vulnerabilities)
3. **Comprehensive test automation**:
   - Unit tests (80%+ coverage target)
   - Integration tests
   - Security tests (OWASP, input validation)
4. **Human review gates**: All PRs manually reviewed by team lead before merge
5. **Quality metrics tracking**: Monitor production error rate, security incidents, and performance regressions over time

---

## RISK-07: TOM Over-Compression Degrades Output Quality

| Attribute | Value |
|-----------|-------|
| **Probability** | MEDIUM |
| **Impact** | MEDIUM |
| **Risk Score** | 6/10 |

**Description**: TOM's token optimization (removing boilerplate, compressing context) may strip important information, causing lower-quality task outputs.

**Mitigation Strategy**:
1. **A/B testing**: Run 100 tasks with TOM enabled vs disabled; compare task success rate and quality metrics
2. **Entity preservation**: spaCy layer explicitly preserves critical entities (variable names, function signatures, error types)
3. **Configurable aggressiveness**: Allow TOM compression ratio to be tuned (conservative/moderate/aggressive); default to conservative
4. **Smart bypass**: Automatically disable TOM compression for:
   - First-time code generation (higher quality needed)
   - Complex refactoring tasks
   - Security-sensitive code
5. **Quality monitoring**: Track output quality metrics; revert TOM changes if degradation >3%

---

## RISK-08: Calendar Time Exceeds 12 Weeks

| Attribute | Value |
|-----------|-------|
| **Probability** | HIGH |
| **Impact** | MEDIUM |
| **Risk Score** | 7/10 |

**Description**: Delivering all concerns and hardening Nanoprym may take longer than 12 weeks, causing project delay, budget overrun, or loss of motivation.

**Mitigation Strategy**:
1. **Phase 1 must complete in 4 weeks**: Core agent loop, builder, reviewer, basic TOM—this is the critical path
2. **If behind schedule**: Cut Phase 2–3 features ruthlessly (defer self-evolution, multi-repo, advanced monitoring)
3. **Ship a working core first**: Get Phase 1 into production use before adding ecosystem features
4. **Weekly sprint reviews**: Reassess burn rate and adjust scope weekly
5. **Parallel workstreams**: Testing and documentation happen alongside development (don't serialize)

---

## RISK-09: Free Tier API Rate Limits Block TOM Routing

| Attribute | Value |
|-----------|-------|
| **Probability** | MEDIUM |
| **Impact** | LOW |
| **Risk Score** | 4/10 |

**Description**: Gemini Free Tier and OpenRouter Free may hit rate limits during peak load, causing TOM routing to fail and forcing fallback to paid APIs.

**Mitigation Strategy**:
1. **Multi-provider fallback chain**:
   - Primary: Gemini Free
   - Secondary: OpenRouter Free
   - Tertiary: DeepSeek
   - Last resort: Local Ollama (offline)
2. **Request queuing**: Queue requests if rate limit hit; retry after backoff
3. **Never fully blocked**: Always have a working provider (degraded but operational)
4. **Monitor rate limits**: Track daily API calls; alert if approaching limits
5. **Cost tracking**: If forced to use paid providers frequently, consider adjusting task routing strategy

---

## RISK-10: Knowledge Base Becomes Noisy/Low-Quality

| Attribute | Value |
|-----------|-------|
| **Probability** | MEDIUM |
| **Impact** | MEDIUM |
| **Risk Score** | 6/10 |

**Description**: As the knowledge base grows, it may accumulate duplicate or low-quality rules, reducing context quality and increasing irrelevant retrieval.

**Mitigation Strategy**:
1. **Semantic deduplication**: Merge KB entries with cosine similarity >0.92
2. **Conservative learning**: Only add new KB rules after 5+ positive signals (multiple successful tasks with that pattern)
3. **Human review cadence**: Review KB growth weekly; flag suspicious or duplicate entries
4. **Quality metrics**: Track KB hit rate, false positive rate, and user feedback on KB suggestions
5. **Periodic cleanup**: Monthly pruning of stale or low-impact rules (retention: 6 months minimum, then review)

---

## RISK-11: Git Worktree Conflicts with Concurrent Operations

| Attribute | Value |
|-----------|-------|
| **Probability** | LOW |
| **Impact** | LOW |
| **Risk Score** | 2/10 |

**Description**: Git worktrees used by Builder and Reviewer may conflict if operations overlap, causing merge conflicts or corrupted state.

**Mitigation Strategy**:
1. **Sequential task execution**: Only one task runs at a time (Builder → Reviewer → Deploy) within a single repo
2. **Git lock retry logic**: If worktree is locked, retry with exponential backoff (max 3 retries)
3. **Separate worktrees**: Builder and Reviewer never write to the same worktree simultaneously
4. **Lock monitoring**: Track worktree lock acquisition time; alert if stuck >2 minutes
5. **Manual intervention**: If deadlock occurs, kill orphaned process and restart

---

## RISK-12: Subscription Plan Changes or Discontinuation

| Attribute | Value |
|-----------|-------|
| **Probability** | LOW |
| **Impact** | HIGH |
| **Risk Score** | 5/10 |

**Description**: Claude Max subscription or GitHub Copilot Pro+ pricing may change or be discontinued, breaking Nanoprym's economics.

**Mitigation Strategy**:
1. **Provider abstraction layer**: All API calls go through a `ModelProvider` interface; swap providers without changing core logic
2. **TOM already supports multi-provider**: Gemini, OpenRouter, DeepSeek, Ollama—any can become primary
3. **Scenario planning**:
   - If Claude Max discontinues: Route more tasks through Haiku + free Gemini + local Ollama
   - If Copilot Pro+ increases: Replace with open-source linting + Semgrep (free tier)
   - If both fail: Use local models (Qwen, Llama) + free APIs for critical tasks only
4. **Flexible cost model**: TOM's $5/month cap means even if subscription models change, variable costs stay controlled
5. **Nanoprym's value is not tied to one provider**: The core value (autonomous agent, self-evolution, multi-step orchestration) works with any model provider

---

## Risk Summary Table

| Risk ID | Description | Prob | Impact | Score | Priority |
|---------|-------------|------|--------|-------|----------|
| RISK-01 | Scope creep | HIGH | HIGH | 9/10 | CRITICAL |
| RISK-02 | Insufficient RAM | MEDIUM | MEDIUM | 6/10 | MEDIUM |
| RISK-03 | CLI API changes | MEDIUM | HIGH | 8/10 | HIGH |
| RISK-04 | Copilot review quality | MEDIUM | MEDIUM | 6/10 | MEDIUM |
| RISK-05 | Self-evolution regressions | HIGH | HIGH | 9/10 | CRITICAL |
| RISK-06 | Code quality issues | MEDIUM | HIGH | 8/10 | HIGH |
| RISK-07 | TOM compression quality loss | MEDIUM | MEDIUM | 6/10 | MEDIUM |
| RISK-08 | Timeline overrun | HIGH | MEDIUM | 7/10 | HIGH |
| RISK-09 | Rate limit blocking | MEDIUM | LOW | 4/10 | LOW |
| RISK-10 | KB degradation | MEDIUM | MEDIUM | 6/10 | MEDIUM |
| RISK-11 | Git worktree conflicts | LOW | LOW | 2/10 | LOW |
| RISK-12 | Subscription changes | LOW | HIGH | 5/10 | MEDIUM |

**Critical Risks** (9/10): RISK-01, RISK-05 — require immediate mitigation planning
**High Risks** (8/10): RISK-03, RISK-06 — require proactive safeguards
**Medium Risks** (4–7/10): RISK-02, RISK-04, RISK-07, RISK-08, RISK-10, RISK-12 — standard risk management
**Low Risks** (2/10): RISK-09, RISK-11 — monitor but low priority

---

## Review Cadence

- **Monthly**: Review risk status, update probabilities/impacts based on progress
- **Per-phase**: New risks may emerge during Phase 2 (self-evolution) and Phase 3 (production hardening)
- **On-incident**: If a risk materializes, perform root cause analysis and update mitigation strategy
