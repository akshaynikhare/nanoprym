/**
 * Builder Agent — Executes implementation plans
 * Triggered by PLAN_READY or WORKER_PROGRESS (retry)
 * Publishes IMPLEMENTATION_READY or WORKER_PROGRESS
 */
import { BaseAgent, type AgentResult } from '../_shared/agent.base.js';
import { ClaudeProvider, type ClaudeExecutionResult } from '../../providers/claude.provider.js';
import type { GitManager } from '../../git/git.manager.js';
import type { BuiltContext } from '../_shared/context.builder.js';
import type { Message, AgentConfig } from '../_shared/agent.types.js';
import { EventBus } from '../../core/event-bus.js';
import { loadPrompt } from '../_shared/prompt.loader.js';
import { createChildLogger } from '../../_shared/logger.js';

const log = createChildLogger('builder-agent');

export class BuilderAgent extends BaseAgent {
  private claude: ClaudeProvider;
  private gitManager: GitManager | null;
  private worktreePath: string | null = null;

  constructor(config: AgentConfig, bus: EventBus, claude?: ClaudeProvider, gitManager?: GitManager) {
    super(config, bus);
    this.claude = claude ?? new ClaudeProvider();
    this.gitManager = gitManager ?? null;
  }

  /** Set the worktree path for isolated execution */
  setWorktreePath(path: string): void {
    this.worktreePath = path;
    log.info('Worktree path set', { path });
  }

  static createConfig(overrides?: Partial<AgentConfig>): AgentConfig {
    const prompt = loadPrompt('builder');
    return {
      id: 'builder',
      role: 'builder',
      modelLevel: 'level2',
      timeout: 300_000,
      maxIterations: 5,
      prompt: { system: prompt.system, subsequent: prompt.subsequent },
      contextStrategy: {
        sources: [
          { topic: 'ISSUE_OPENED', priority: 'required', strategy: 'latest', amount: 1 },
          { topic: 'STATE_SNAPSHOT', priority: 'required', strategy: 'latest', amount: 1 },
          { topic: 'PLAN_READY', priority: 'required', strategy: 'latest', amount: 1 },
          { topic: 'WORKER_PROGRESS', priority: 'medium', strategy: 'latest', amount: 3, since: 'last_task_end' },
          { topic: 'VALIDATION_RESULT', priority: 'high', strategy: 'latest', amount: 10, since: 'last_task_end' },
        ],
        format: 'chronological',
        maxTokens: 200_000,
      },
      triggers: [
        { topic: 'PLAN_READY', action: 'execute_task' },
        {
          topic: 'WORKER_PROGRESS',
          action: 'execute_task',
          logic: {
            engine: 'javascript',
            script: 'return message.sender === "builder";',
          },
        },
        {
          topic: 'VALIDATION_RESULT',
          action: 'execute_task',
          logic: {
            engine: 'javascript',
            script: `
              const results = ledger.query({ topic: 'VALIDATION_RESULT' });
              return results.some(r => r.content.data?.approved === false);
            `,
          },
        },
      ],
      hooks: {
        onComplete: {
          action: 'publish_message',
          config: { topic: 'IMPLEMENTATION_READY' },
          transform: {
            engine: 'javascript',
            script: 'if (!result.completionStatus?.canValidate) return { topic: "WORKER_PROGRESS" };',
          },
        },
      },
      ...overrides,
    };
  }

  protected async execute(context: BuiltContext, triggeringMessage: Message): Promise<AgentResult> {
    const isRetry = this.getIteration() > 1;
    const systemPrompt = isRetry && this.config.prompt.subsequent
      ? this.config.prompt.subsequent
      : this.config.prompt.system;

    const taskPrompt = this.buildTaskPrompt(context, triggeringMessage, isRetry);

    log.info('Building', {
      taskId: triggeringMessage.taskId,
      iteration: this.getIteration(),
      isRetry,
      contextTokens: context.tokenEstimate,
    });

    const result = await this.claude.execute({
      prompt: taskPrompt,
      systemPrompt,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      maxTurns: 20,
      outputFormat: 'json',
      timeoutMs: this.config.timeout,
      workingDirectory: this.worktreePath ?? undefined,
    });

    // Auto-commit changes in worktree
    if (this.gitManager && this.worktreePath) {
      try {
        const files = await this.gitManager.getUncommittedFiles(this.worktreePath);
        if (files.length > 0) {
          const commitHash = await this.gitManager.commit(
            this.worktreePath,
            files,
            `feat(nanoprym): ${triggeringMessage.taskId.slice(0, 8)} implementation`,
          );
          log.info('Auto-committed changes', { files: files.length, hash: commitHash });
        }
      } catch (error) {
        log.warn('Auto-commit failed', { error: String(error) });
      }
    }

    return this.parseResult(result);
  }

  private buildTaskPrompt(context: BuiltContext, _triggeringMessage: Message, isRetry: boolean): string {
    const parts: string[] = [];

    if (isRetry) {
      parts.push('## RETRY — Previous attempt was rejected');
      parts.push('Read the VALIDATION_RESULT messages below carefully. Fix ALL issues.');
      parts.push('');
    }

    parts.push(context.prompt);

    return parts.join('\n');
  }

  private parseResult(result: ClaudeExecutionResult): AgentResult {
    try {
      const parsed = JSON.parse(result.output);
      return {
        summary: parsed.summary ?? 'Implementation complete',
        data: parsed,
        completionStatus: parsed.completionStatus ?? {
          canValidate: true,
          percentComplete: 100,
        },
      };
    } catch {
      return {
        summary: result.output.slice(0, 200),
        completionStatus: {
          canValidate: true,
          percentComplete: 100,
        },
      };
    }
  }
}
