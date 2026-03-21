# Why Nanoprym?

## Purpose

Nanoprym is a fully autonomous AI agent that maintains software projects without human babysitting. It continuously scans repos, finds bugs/improvements, auto-fixes them, proposes features, builds approved work through a multi-agent pipeline (Planner → Builder → Reviewer → Validator), and evolves its own prompts over time based on outcomes.

The core idea: encode your architectural brain, coding style, and decision-making into a hierarchical prompt system, then let it run autonomously against your repos.

## How It Helps Your Workflow

1. **Autonomous operation** — runs without human babysitting. Drop tasks into an inbox or let it find issues itself; review/merge via the dashboard.
2. **Multi-repo management** — register any number of repos (`nanoprym repo add`), run tasks against any of them with `--repo`. Each repo gets isolated ledgers, KB, and project brain.
3. **Self-improving** — LearningEngine tracks outcomes, detects patterns, feeds rules to the prompt versioner. Auto-reverts if quality drops after 25 tasks.
4. **Knowledge base grows** — every task outcome feeds back into a project-specific KB, accumulating context over time.
5. **Your brain, encoded** — cascading prompts (L0 Prime > L1 Project > L2 Module > L3 Task) capture how you think about code, not generic patterns.

## Why Not Devin (or other autonomous AI platforms)?

### Cost

| Option | Cost/month |
|--------|------------|
| Junior developer (annual salary) | $3,000–5,000 |
| Cursor Pro + Copilot (manual) | ~$60 |
| Devin (autonomous AI platform) | $500 |
| **Nanoprym (fully autonomous)** | **~$248** |

### Key Differentiators

1. **Cost** — roughly half the price of Devin, running on hardware you already own (MacBook M1 Pro, 16GB RAM).
2. **Self-evolution** — Devin doesn't evolve its own prompts/rules based on outcomes. Nanoprym does.
3. **Your brain, not generic** — Nanoprym encodes your specific patterns, style, and decisions. It's your agent, not a generic one.
4. **Full control** — runs locally, you own the data, no vendor lock-in. You control the pipeline, the review flow, the merge decisions.
5. **Multi-repo** — Devin works on one repo at a time per session. Nanoprym manages multiple repos with per-project isolation (KB, ledgers, brain files).
6. **Dogfooding** — Nanoprym improves itself (D36). That feedback loop doesn't exist with external tools.

### Sustainable Cost Model

- Fixed, predictable monthly spend (no surprise token bills)
- Autonomous operation (no human babysitting required)
- Scalable with task volume (marginal cost per task decreases)
- Already-amortized hardware (no new compute required)
- At ~5 tasks/day (110/month), cost per task is ~$2.25
