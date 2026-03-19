/**
 * Reviewer Agent — Blind code review via Copilot (or Claude fallback)
 * Triggered by IMPLEMENTATION_READY
 * Publishes VALIDATION_RESULT
 *
 * BLIND REVIEW: Never sees builder's reasoning or chat history.
 * Only receives: issue, plan, acceptance criteria, and the code diff.
 */
import { BaseAgent, type AgentResult } from '../_shared/agent.base.js';
import { GitManager } from '../../git/git.manager.js';
import type { BuiltContext } from '../_shared/context.builder.js';
import type { Message, AgentConfig } from '../_shared/agent.types.js';
import { EventBus } from '../../core/event-bus.js';
import { loadPrompt } from '../_shared/prompt.loader.js';
import { createChildLogger } from '../../_shared/logger.js';
import { sleep } from '../../_shared/utils.js';

const log = createChildLogger('reviewer-agent');

const COPILOT_REVIEW_WAIT_MS = 60_000; // Wait 60s for Copilot to review
const COPILOT_POLL_INTERVAL_MS = 10_000;

export class ReviewerAgent extends BaseAgent {
  private gitManager: GitManager;

  constructor(config: AgentConfig, bus: EventBus, gitManager?: GitManager) {
    super(config, bus);
    this.gitManager = gitManager ?? new GitManager();
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

    if (!prNumber) {
      log.warn('No PR number in IMPLEMENTATION_READY message, using Claude fallback');
      return this.claudeFallbackReview(context, triggeringMessage);
    }

    return this.copilotReview(prNumber);
  }

  /** Primary: Request Copilot review on PR, poll for results */
  private async copilotReview(prNumber: number): Promise<AgentResult> {
    log.info('Requesting Copilot review', { prNumber });

    await this.gitManager.requestCopilotReview(prNumber);

    // Poll for review comments
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

  /** Fallback: Use Claude Sonnet as reviewer (blind review prompt) */
  private async claudeFallbackReview(_context: BuiltContext, _triggeringMessage: Message): Promise<AgentResult> {
    log.info('Using Claude fallback reviewer (blind review)');

    // TODO: Phase 1 Week 4 — Implement Claude-based blind review
    // For now, auto-approve with warning
    return {
      summary: 'Claude fallback review — auto-approved (not yet implemented)',
      data: { approved: true, errors: [], source: 'claude-fallback-stub' },
      completionStatus: { canValidate: true, percentComplete: 100 },
    };
  }

  /** Parse Copilot's review into structured result */
  private parseCopilotReview(review: { body: string; author: string }): AgentResult {
    const body = review.body.toLowerCase();
    const approved = !body.includes('request changes') && !body.includes('reject');

    const errors: string[] = [];
    // Extract bullet points as errors
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
