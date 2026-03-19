/**
 * Claude Provider — Executes tasks via Claude Code CLI
 * Uses Claude Max subscription (zero marginal cost per task)
 *
 * Execution modes:
 * - headless: claude -p "prompt" --output-format json
 * - with tools: claude -p "prompt" --allowedTools Read,Write,Bash,Edit
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

  /** Execute a task via Claude Code CLI in headless mode */
  async execute(options: ClaudeExecutionOptions): Promise<ClaudeExecutionResult> {
    const args = this.buildArgs(options);
    const startTime = Date.now();

    log.info('Executing Claude task', {
      promptLength: options.prompt.length,
      tools: options.allowedTools,
      maxTurns: options.maxTurns,
    });

    try {
      const { stdout, stderr } = await execFileAsync(this.cliBinary, args, {
        timeout: options.timeoutMs ?? 300_000, // 5 min default
        maxBuffer: 10 * 1024 * 1024, // 10MB
        cwd: options.workingDirectory,
        env: { ...process.env },
      });

      const durationMs = Date.now() - startTime;

      if (stderr && stderr.trim()) {
        log.warn('Claude stderr output', { stderr: stderr.slice(0, 500) });
      }

      log.info('Claude task completed', { durationMs, outputLength: stdout.length });

      return {
        success: true,
        output: stdout,
        exitCode: 0,
        durationMs,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const err = error as { message: string; code?: number; stdout?: string; stderr?: string };
      const errorMessage = err.message ?? String(error);

      const retryable = this.classifyError(errorMessage);

      log.error('Claude task failed', {
        error: errorMessage.slice(0, 500),
        retryable,
        durationMs,
      });

      throw new ProviderError(
        `Claude execution failed: ${errorMessage.slice(0, 200)}`,
        retryable,
        {
          durationMs,
          stdout: err.stdout?.slice(0, 1000),
          stderr: err.stderr?.slice(0, 1000),
        }
      );
    }
  }

  /** Build CLI arguments from options */
  private buildArgs(options: ClaudeExecutionOptions): string[] {
    const args: string[] = ['-p', options.prompt];

    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }

    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(','));
    }

    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }

    if (options.outputFormat) {
      args.push('--output-format', options.outputFormat);
    }

    return args;
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

    // Unknown errors: treat as retryable (fail-safe)
    return true;
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
