# KB-0001: Claude Code CLI Subprocess Pattern

## Source
Context7 — /atalovesyou/claude-max-api-proxy (ClaudeSubprocess)

## Pattern
To spawn Claude Code CLI as a subprocess:

```typescript
const args = [
  '--print',                     // headless mode (no interactive UI)
  '--output-format', 'stream-json',  // structured JSON stream output
  '--input-format', 'stream-json',   // accept JSON messages on stdin
  '--verbose',                   // detailed logging
  '--model', 'sonnet',           // model selection: opus | sonnet | haiku
  '--no-session-persistence',    // stateless (no session files)
];

// Optional:
// '--system-prompt', 'your prompt'  // system prompt
// '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep'  // tool whitelist
// '--max-turns', '20'               // limit agent turns
// '--session-id', 'unique-id'       // session tracking

const child = spawn('claude', args, {
  cwd: workingDirectory,
  stdio: ['pipe', 'pipe', 'pipe'],
});

// Send prompt via stdin as JSON message
child.stdin.write(JSON.stringify({
  type: 'user_message',
  content: promptText,
}) + '\n');
child.stdin.end();

// Parse stream-json output
child.stdout.on('data', (chunk) => {
  for (const line of chunk.toString().split('\n')) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'assistant') { /* text content */ }
    if (msg.type === 'content_block_delta') { /* streaming delta */ }
    if (msg.type === 'result') { /* final result with cost/duration */ }
  }
});
```

## Key Rules
- Use `spawn()` not `exec()` — prevents command injection
- Send prompt via stdin as JSON, not as `-p` argument — avoids shell escaping issues
- Use `--print` for headless mode (not `-p`)
- `--input-format stream-json` enables stdin JSON messages
- `--output-format stream-json` gives structured parseable output
- `--no-session-persistence` for stateless API-like usage
- Never pass prompts starting with `---` as CLI arguments (interpreted as flags)

## Tags
claude, cli, subprocess, spawn, headless, stdin, stream-json
