# Nanoprym

Self-evolving AI agent orchestration system. Builds software projects autonomously while improving itself over time.

## Core Loop

```
Scan repos continuously
  Find bugs, issues, improvements, inspirations
  Auto-fix bugs, security, test failures
  Propose new features for human approval
  Build approved tasks sequentially using AI agents
  Learn from every outcome and human correction
  Evolve its own prompts, rules, and workflows weekly
```

## Two Evolution Targets

- **META**: Nanoprym improves itself (prompts, routing, workflows, validators, its own code)
- **PROJECT**: Projects get better (KB grows, tests expand, patterns reused)

## Architecture

- **Brain Hierarchy**: L0 Prime > L1 Project > L2 Module > L3 Task (cascading prompt inheritance)
- **Agents**: Planner, Builder (Claude Code CLI), Reviewer (GitHub Copilot), Validator
- **Storage**: PostgreSQL + Qdrant (vectors) + Redis (queue) + Git (markdown KB)
- **Communication**: Slack alerts, VS Code markdown interface

## Technology Stack

- TypeScript / Node.js
- Claude Code CLI (primary coder)
- GitHub Copilot (code reviewer)
- Ollama + Nomic Embed Text V2 (local embeddings)
- PostgreSQL, Qdrant, Redis/BullMQ
- Docker, GitHub Actions
- Vitest, Playwright, Hurl, k6

## Status

Phase 0: Research and Intelligence Gathering

## License

Proprietary
