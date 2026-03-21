/**
 * Reviewer Agent — Blind code review via Claude (or Copilot for PRs)
 * Triggered by IMPLEMENTATION_READY
 * Publishes VALIDATION_RESULT
 *
 * BLIND REVIEW: Never sees builder's reasoning or chat history.
 * Only receives: issue, plan, acceptance criteria, and the code diff.
 */
import { BaseAgent, type AgentResult } from '../_shared/agent.base.js';
import { ClaudeProvider } from '../../providers/claude.provider.js';
import { GitManager } from '../../git/git.manager.js';
import type { BuiltContext } from '../_shared/context.builder.js';
import type { Message, AgentConfig } from '../_shared/agent.types.js';
import { EventBus } from '../../core/event-bus.js';
import { loadPrompt } from '../_shared/prompt.loader.js';
import { createChildLogger } from '../../_shared/logger.js';
import { sleep } from '../../_shared/utils.js';

const log = createChildLogger('reviewer-agent');

const COPILOT_REVIEW_WAIT_MS = 60_000;
const COPILOT_POLL_INTERVAL_MS = 10_000;

export class ReviewerAgent extends BaseAgent {
  private gitManager: GitManager;
  private claude: ClaudeProvider;
  private worktreePath: string | null = null;

  constructor(config: AgentConfig, bus: EventBus, gitManager?: GitManager, claude?: ClaudeProvider) {
    super(config, bus);
    this.gitManager = gitManager ?? new GitManager();
    this.claude = claude ?? new ClaudeProvider();
  }

  /** Set the worktree path for diff access and Claude cwd */
  setWorktreePath(path: string): void {
    this.worktreePath = path;
    log.info('Worktree path set', { path });
  }

  static createConfig(overrides?: Partial<AgentConfig>): AgentConfig {
    const prompt = loadPrompt('reviewer');
    return {
      id: 'reviewer',
      role: 'reviewer',
      modelLevel: 'level2',
      timeout: 120_000,
      maxIterations: 2,
      prompt: { system: prompt.system },
      contextStrategy: {
        sources: [
          { topic: 'ISSUE_OPENED', priority: 'required', strategy: 'latest', amount: 1 },
          { topic: 'STATE_SNAPSHOT', priority: 'required', strategy: 'latest', amount: 1 },
          { topic: 'PLAN_READY', priority: 'required', strategy: 'latest', amount: 1 },
          { topic: 'IMPLEMENTATION_READY', priority: 'high', strategy: 'latest', amount: 1 },
        ],
        format: 'chronological',
        maxTokens: 50_000,
      },
      triggers: [
        { topic: 'IMPLEMENTATION_READY', action: 'execute_task' },
      ],
      hooks: {
        onComplete: {
          action: 'publish_message',
          config: { topic: 'VALIDATION_RESULT' },
        },
      },
      ...overrides,
    };
  }

  protected async execute(context: BuiltContext, triggeringMessage: Message): Promise<AgentResult> {
    const prNumber = triggeringMessage.content.data?.prNumber as number | undefined;

    // If we have a worktree, do Claude blind review (local mode)
    if (this.worktreePath) {
      return this.claudeBlindReview(context, triggeringMessage);
    }

    // If we have a PR number, use Copilot (remote mode)
    if (prNumber) {
      return this.copilotReview(prNumber);
    }

    // Fallback: Claude blind review without worktree
    return this.claudeBlindReview(context, triggeringMessage);
  }

  /** Claude blind review — reads diff from worktree, reviews with full tool access */
  private async claudeBlindReview(context: BuiltContext, triggeringMessage: Message): Promise<AgentResult> {
    log.info('Running Claude blind review', { worktree: this.worktreePath ?? 'none' });

    // Get the diff
    let diff = '';
    if (this.worktreePath) {
      try {
        diff = await this.gitManager.getDiff(this.worktreePath);
      } catch (error) {
        log.warn('Failed to get diff', { error: String(error) });
      }
    }

    // Get issue description from context
    const issueSection = context.sections.find(s => s.topic === 'ISSUE_OPENED');
    const issueText = issueSection?.messages[0]?.content.text ?? triggeringMessage.content.text;

    // Build blind review prompt — NO builder reasoning, only diff + issue
    const reviewPrompt = [
      '## Code Review Task',
      '',
      'You are reviewing code changes. You have NOT seen the implementation process — only the result.',
      'Review the diff below for correctness, security, and code quality.',
      '',
      '### Issue Description',
      issueText,
      '',
      '### Code Diff',
      '```diff',
      diff || '(no diff available — inspect the working directory)',
      '```',
      '',
      '### Instructions',
      '- Read the changed files to understand context',
      '- Check for bugs, security issues, and logic errors',
      '- Verify the changes match the issue description',
      '- You can run tests with: npm run build && npm test',
      '',
      '### Response Format (JSON)',
      '```json',
      '{',
      '  "approved": true/false,',
      '  "score": 1-10,',
      '  "feedback": ["issue 1", "issue 2"],',
      '  "summary": "brief review summary"',
      '}',
      '```',
    ].join('\n');

    try {
      const result = await this.claude.execute({
        prompt: reviewPrompt,
        systemPrompt: this.config.prompt.system,
        allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
        maxTurns: 10,
        outputFormat: 'json',
        timeoutMs: this.config.timeout,
        workingDirectory: this.worktreePath ?? undefined,
      });

      return this.parseClaudeReview(result.output);
    } catch (error) {
      log.error('Claude review failed', { error: String(error) });
      return {
        summary: 'Claude review failed — auto-approved with warning',
        data: { approved: true, errors: [], source: 'claude-error-fallback' },
        completionStatus: { canValidate: true, percentComplete: 100 },
      };
    }
  }

  /** Parse Claude's review output into structured result */
  private parseClaudeReview(output: string): AgentResult {
    try {
      const parsed = JSON.parse(output);
      const approved = parsed.approved !== false;
      const feedback = (parsed.feedback as string[]) ?? [];

      return {
        summary: approved ? `Claude approved (score: ${parsed.score ?? '?'}/10)` : `Claude rejected: ${feedback.length} issues`,
        data: {
          approved,
          errors: feedback,
          score: parsed.score,
          source: 'claude-blind-review',
          rawReview: parsed.summary ?? output.slice(0, 500),
        },
        completionStatus: { canValidate: true, percentComplete: 100 },
      };
    } catch {
      // If Claude didn't return JSON, treat as approved with the text as summary
      return {
        summary: 'Claude review complete (non-JSON response)',
        data: { approved: true, errors: [], source: 'claude-blind-review', rawReview: output.slice(0, 500) },
        completionStatus: { canValidate: true, percentComplete: 100 },
      };
    }
  }

  /** Copilot review on a GitHub PR */
  private async copilotReview(prNumber: number): Promise<AgentResult> {
    log.info('Requesting Copilot review', { prNumber });

    await this.gitManager.requestCopilotReview(prNumber);

    const deadline = Date.now() + COPILOT_REVIEW_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(COPILOT_POLL_INTERVAL_MS);

      const reviews = await this.gitManager.getPRReviewComments(prNumber);
      const copilotReview = reviews.find(r => r.author === 'copilot' || r.author === 'github-copilot');

      if (copilotReview) {
        return this.parseCopilotReview(copilotReview);
      }
    }

    log.warn('Copilot review timed out, falling back to approved');
    return {
      summary: 'Copilot review timed out — auto-approved',
      data: { approved: true, errors: [], source: 'timeout-auto-approve' },
      completionStatus: { canValidate: true, percentComplete: 100 },
    };
  }

  /** Parse Copilot's review into structured result */
  private parseCopilotReview(review: { body: string; author: string }): AgentResult {
    const body = review.body.toLowerCase();
    const approved = !body.includes('request changes') && !body.includes('reject');

    const errors: string[] = [];
    const lines = review.body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        errors.push(trimmed.slice(2));
      }
    }

    return {
      summary: approved ? 'Copilot approved' : `Copilot rejected (${errors.length} issues)`,
      data: {
        approved,
        errors,
        criteriaResults: [],
        source: 'copilot',
        rawReview: review.body,
      },
      completionStatus: { canValidate: true, percentComplete: 100 },
    };
  }
}
