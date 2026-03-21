/**
 * Claude Provider — Executes tasks via Claude Code CLI
 * Uses Claude Max subscription (zero marginal cost per task)
 *
 * Pipes prompt via stdin to avoid shell escaping issues with long prompts.
 * Usage: echo "prompt" | claude -p - --output-format text
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProviderError } from '../_shared/errors.js';
import { createChildLogger } from '../_shared/logger.js';

const execFileAsync = promisify(execFile);
const log = createChildLogger('claude-provider');

export interface ClaudeExecutionOptions {
  prompt: string;
  systemPrompt?: string;
  allowedTools?: string[];
  maxTurns?: number;
  outputFormat?: 'text' | 'json' | 'stream-json';
  timeoutMs?: number;
  workingDirectory?: string;
}

export interface ClaudeExecutionResult {
  success: boolean;
  output: string;
  exitCode: number;
  durationMs: number;
  tokensUsed?: { input: number; output: number };
}

/** Error patterns from Claude Code CLI */
const RETRYABLE_PATTERNS = [
  'rate limit',
  '429',
  'timeout',
  'ECONNRESET',
  'ETIMEDOUT',
  'socket hang up',
];

const PERMANENT_PATTERNS = [
  'invalid api key',
  'unauthorized',
  'model not found',
  'context length exceeded',
  'permission denied',
];

export class ClaudeProvider {
  private cliBinary: string;

  constructor(cliBinary: string = 'claude') {
    this.cliBinary = cliBinary;
  }

  /**
   * Execute a task via Claude Code CLI in headless mode.
   * Writes prompt to a temp file and uses -p flag to read it,
   * avoiding shell escaping issues with long/multiline prompts.
   */
  async execute(options: ClaudeExecutionOptions): Promise<ClaudeExecutionResult> {
    const startTime = Date.now();

    log.info('Executing Claude task', {
      promptLength: options.prompt.length,
      tools: options.allowedTools,
      maxTurns: options.maxTurns,
    });

    // Write prompt to temp file (avoids shell escaping issues)
    const tmpFile = path.join(os.tmpdir(), `nanoprym-prompt-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, options.prompt);

    try {
      const result = await this.spawnClaude(tmpFile, options);
      const durationMs = Date.now() - startTime;

      log.info('Claude task completed', { durationMs, outputLength: result.stdout.length });

      return {
        success: true,
        output: result.stdout,
        exitCode: 0,
        durationMs,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const err = error as { message: string; stderr?: string; stdout?: string; exitCode?: number };
      const errorMessage = err.message ?? String(error);
      const retryable = this.classifyError(errorMessage + (err.stderr ?? ''));

      log.error('Claude task failed', {
        error: errorMessage.slice(0, 300),
        stderr: err.stderr?.slice(0, 500),
        stdout: err.stdout?.slice(0, 300),
        retryable,
        durationMs,
      });

      throw new ProviderError(
        `Claude execution failed: ${errorMessage.slice(0, 200)}`,
        retryable,
        { durationMs, stdout: err.stdout?.slice(0, 1000), stderr: err.stderr?.slice(0, 1000) },
      );
    } finally {
      // Cleanup temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  /**
   * Spawn claude CLI process.
   * Uses -p with prompt as direct argument via spawn() (no shell escaping issues).
   * Output streamed in real-time via stream-json format.
   */
  private spawnClaude(
    promptFile: string,
    options: ClaudeExecutionOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const prompt = fs.readFileSync(promptFile, 'utf-8');

      // Build args: -p <prompt> comes first, then other flags
      const args: string[] = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
      ];

      if (options.systemPrompt) {
        args.push('--system-prompt', options.systemPrompt);
      }
      if (options.allowedTools && options.allowedTools.length > 0) {
        args.push('--allowedTools', options.allowedTools.join(','));
      }
      if (options.maxTurns) {
        args.push('--max-turns', String(options.maxTurns));
      }
      args.push('--no-session-persistence');

      log.debug('Spawning Claude CLI', { promptLength: prompt.length, argCount: args.length });

      // spawn() passes args as array — no shell interpretation, safe for any prompt content
      const child = spawn(this.cliBinary, args, {
        cwd: options.workingDirectory ?? process.cwd(),
        env: { ...process.env, CLAUDECODE: undefined },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let resultText = '';

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        // Parse stream-json lines for real-time display
        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'assistant' && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === 'text' && block.text) {
                  process.stdout.write(block.text);
                  resultText += block.text;
                }
              }
            } else if (msg.type === 'content_block_delta' && msg.delta?.text) {
              process.stdout.write(msg.delta.text);
              resultText += msg.delta.text;
            } else if (msg.type === 'result') {
              log.debug('Claude result', {
                cost: msg.total_cost_usd,
                duration: msg.duration_ms,
                turns: msg.num_turns,
              });
              if (msg.result) resultText = msg.result;
            }
          } catch {
            // Plain text output (non-JSON)
            if (line.trim()) {
              process.stdout.write(line + '\n');
              resultText += line + '\n';
            }
          }
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        // Show stderr in real-time for visibility
        if (chunk.trim()) {
          process.stderr.write(`[claude] ${chunk}`);
        }
      });

      const timeout = options.timeoutMs ?? 300_000;
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(Object.assign(new Error(`Claude CLI timed out after ${timeout}ms`), { stderr, stdout }));
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          // Use resultText (extracted from stream-json) as the primary output
          resolve({ stdout: resultText || stdout, stderr });
        } else {
          const err = new Error(`Claude CLI exited with code ${code}`);
          Object.assign(err, { stderr, stdout, exitCode: code });
          reject(err);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        Object.assign(err, { stderr, stdout });
        reject(err);
      });

      // Close stdin immediately — we're passing prompt via -p argument
      child.stdin.end();
    });
  }

  /** Classify error as retryable or permanent */
  private classifyError(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase();

    for (const pattern of PERMANENT_PATTERNS) {
      if (lower.includes(pattern)) return false;
    }

    for (const pattern of RETRYABLE_PATTERNS) {
      if (lower.includes(pattern)) return true;
    }

    return true; // Unknown = retryable (fail-safe)
  }

  /** Check if Claude Code CLI is available */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.cliBinary, ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
