/**
 * Retry Manager — Reflect-Retry-Escalate error recovery
 *
 * On failure:
 * 1. Reflect: Agent reasons about root cause (mandatory think step)
 * 2. Retry: Different approach based on reflection (max 3 attempts)
 * 3. Escalate: Slack ping with all attempt details
 *
 * For cross-task failures: prime-step backtracking (1, 3, 5, 7)
 */
import { EventBus } from '../core/event-bus.js';
// import type { Message } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';
import { MAX_RETRY_ATTEMPTS } from '../_shared/constants.js';

const log = createChildLogger('retry-manager');

interface RetryAttempt {
  attempt: number;
  error: string;
  reflection: string;
  approach: string;
  timestamp: Date;
}

export class RetryManager {
  private bus: EventBus;
  private attempts: Map<string, RetryAttempt[]> = new Map();
  private maxAttempts: number;

  constructor(bus: EventBus, maxAttempts: number = MAX_RETRY_ATTEMPTS) {
    this.bus = bus;
    this.maxAttempts = maxAttempts;
  }

  /** Record a failed attempt and decide what to do next */
  shouldRetry(taskId: string, agentId: string, error: string): {
    retry: boolean;
    attempt: number;
    reflection: string;
  } {
    const key = `${taskId}:${agentId}`;
    const history = this.attempts.get(key) ?? [];

    const attempt = history.length + 1;

    if (attempt > this.maxAttempts) {
      log.info('Max retries reached, escalating', { taskId, agentId, attempts: attempt });
      return { retry: false, attempt, reflection: 'Max retries exceeded' };
    }

    // Generate reflection (what went wrong and what to try differently)
    const reflection = this.reflect(error, history);
    const approach = this.suggestApproach(attempt, history);

    history.push({
      attempt,
      error,
      reflection,
      approach,
      timestamp: new Date(),
    });
    this.attempts.set(key, history);

    log.info('Retrying', { taskId, agentId, attempt, reflection: reflection.slice(0, 100) });

    return { retry: true, attempt, reflection: `${reflection}\n\nApproach: ${approach}` };
  }

  /** Escalate a failed task — publish details for human review */
  escalate(taskId: string, agentId: string, error: string): void {
    const key = `${taskId}:${agentId}`;
    const history = this.attempts.get(key) ?? [];

    this.bus.publish({
      taskId,
      topic: 'CLUSTER_COMPLETE',
      sender: 'retry-manager',
      content: {
        text: `Task escalated after ${history.length} failed attempts`,
        data: {
          status: 'escalated',
          agentId,
          lastError: error,
          attempts: history.map(a => ({
            attempt: a.attempt,
            error: a.error.slice(0, 200),
            reflection: a.reflection.slice(0, 200),
            approach: a.approach,
          })),
        },
      },
    });

    log.warn('Task escalated', { taskId, agentId, attempts: history.length });
  }

  /** Get attempt history for a task/agent */
  getAttempts(taskId: string, agentId: string): RetryAttempt[] {
    return this.attempts.get(`${taskId}:${agentId}`) ?? [];
  }

  /** Clear attempt history (e.g., after successful completion) */
  clearAttempts(taskId: string, agentId: string): void {
    this.attempts.delete(`${taskId}:${agentId}`);
  }

  /** Reflect on what went wrong */
  private reflect(error: string, history: RetryAttempt[]): string {
    if (history.length === 0) {
      return `First attempt failed with: ${error.slice(0, 300)}. Analyze root cause before retrying.`;
    }

    const previousErrors = history.map(h => h.error.slice(0, 100)).join('; ');
    return `Attempt ${history.length + 1}. Previous errors: ${previousErrors}. Latest: ${error.slice(0, 200)}. Try a fundamentally different approach.`;
  }

  /** Suggest a different approach for each retry */
  private suggestApproach(attempt: number, _history: RetryAttempt[]): string {
    switch (attempt) {
      case 1:
        return 'Fix the specific error. Read the error message carefully.';
      case 2:
        return 'Try a different implementation strategy. The current approach may be fundamentally flawed.';
      case 3:
        return 'Simplify maximally. Remove complexity. Take the safest possible path.';
      default:
        return 'Escalate to human.';
    }
  }
}
