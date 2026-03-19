# KB-0002: Context7 Library IDs for Nanoprym Dependencies

## Purpose
Reference library IDs for querying Context7 docs when troubleshooting or building features.

## Library IDs

| Library | Context7 ID | Use When |
|---------|-------------|----------|
| Claude Code | /anthropics/claude-code | CLI usage, hooks, plugins, MCP integration |
| Claude CLI Proxy | /atalovesyou/claude-max-api-proxy | Subprocess patterns, stream-json, OpenAI compat |

## Usage
```
Query Context7 with:
  libraryId: "/anthropics/claude-code"
  query: "your question here"
```

## Tags
context7, documentation, reference, claude-code
