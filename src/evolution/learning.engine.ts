/**
 * Learning Engine — Tracks outcomes and extracts patterns
 *
 * Learning signals:
 * 1. Human corrections (PR rejected, human overrides)
 * 2. Outcomes (pass/fail, iterations needed)
 * 3. Metrics trends (improvements or regressions)
 *
 * Conservative: 5+ similar signals before pattern becomes rule.
 */
import { EventBus } from '../core/event-bus.js';
import type { Message } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';
import { nowISO } from '../_shared/utils.js';

const log = createChildLogger('learning-engine');

const MIN_SIGNALS_FOR_RULE = 5;

export interface TaskOutcome {
  taskId: string;
  complexity: string;
  taskType: string;
  success: boolean;
  iterations: number;
  humanCorrections: number;
  reviewRejections: number;
  durationMs: number;
  errors: string[];
  timestamp: string;
}

export interface LearnedPattern {
  id: string;
  pattern: string;
  signalCount: number;
  confidence: number;
  source: 'human_correction' | 'outcome' | 'metric_trend';
  examples: string[];
  createdAt: string;
  lastSeenAt: string;
}

export class LearningEngine {
  private outcomes: TaskOutcome[] = [];
  private signals: Map<string, { count: number; examples: string[]; source: string }> = new Map();
  private patterns: LearnedPattern[] = [];

  constructor(private bus: EventBus) {
    this.subscribeToEvents();
  }

  /** Record a task outcome */
  recordOutcome(outcome: TaskOutcome): void {
    this.outcomes.push(outcome);

    // Extract signals from outcome
    if (!outcome.success) {
      for (const error of outcome.errors) {
        this.addSignal(`error:${this.normalizeError(error)}`, outcome.taskId, 'outcome');
      }
    }

    if (outcome.humanCorrections > 0) {
      this.addSignal(`human_correction:${outcome.taskType}`, outcome.taskId, 'human_correction');
    }

    if (outcome.iterations > 3) {
      this.addSignal(`high_iterations:${outcome.complexity}`, outcome.taskId, 'outcome');
    }

    this.checkForNewPatterns();
    log.info('Outcome recorded', { taskId: outcome.taskId, success: outcome.success, iterations: outcome.iterations });
  }

  /** Get all learned patterns */
  getPatterns(): LearnedPattern[] {
    return [...this.patterns];
  }

  /** Get outcome statistics */
  getStats(): {
    totalTasks: number;
    successRate: number;
    avgIterations: number;
    avgDurationMs: number;
    patternCount: number;
  } {
    const total = this.outcomes.length;
    if (total === 0) return { totalTasks: 0, successRate: 0, avgIterations: 0, avgDurationMs: 0, patternCount: this.patterns.length };

    const successes = this.outcomes.filter(o => o.success).length;
    const avgIterations = this.outcomes.reduce((s, o) => s + o.iterations, 0) / total;
    const avgDuration = this.outcomes.reduce((s, o) => s + o.durationMs, 0) / total;

    return {
      totalTasks: total,
      successRate: successes / total,
      avgIterations,
      avgDurationMs: avgDuration,
      patternCount: this.patterns.length,
    };
  }

  /** Subscribe to event bus for auto-tracking */
  private subscribeToEvents(): void {
    this.bus.subscribeTopic('CLUSTER_COMPLETE', (msg: Message) => {
      const data = msg.content.data ?? {};
      this.recordOutcome({
        taskId: msg.taskId,
        complexity: String(data.complexity ?? 'UNKNOWN'),
        taskType: String(data.taskType ?? 'UNKNOWN'),
        success: data.status !== 'failed' && data.status !== 'escalated',
        iterations: Number(data.iterations ?? 1),
        humanCorrections: Number(data.humanCorrections ?? 0),
        reviewRejections: Number(data.reviewRejections ?? 0),
        durationMs: Number(data.durationMs ?? 0),
        errors: (data.errors as string[]) ?? [],
        timestamp: nowISO(),
      });
    });

    log.info('LearningEngine subscribed to event bus');
  }

  /** Add a signal (potential pattern indicator) */
  private addSignal(key: string, example: string, source: string): void {
    const existing = this.signals.get(key) ?? { count: 0, examples: [], source };
    existing.count++;
    existing.examples.push(example);
    if (existing.examples.length > 10) existing.examples = existing.examples.slice(-10);
    this.signals.set(key, existing);
  }

  /** Check if any signals have crossed the threshold to become patterns */
  private checkForNewPatterns(): void {
    for (const [key, signal] of this.signals) {
      if (signal.count >= MIN_SIGNALS_FOR_RULE) {
        const existingPattern = this.patterns.find(p => p.id === key);
        if (existingPattern) {
          existingPattern.signalCount = signal.count;
          existingPattern.lastSeenAt = nowISO();
          existingPattern.confidence = Math.min(signal.count / 10, 1.0);
        } else {
          this.patterns.push({
            id: key,
            pattern: key,
            signalCount: signal.count,
            confidence: Math.min(signal.count / 10, 1.0),
            source: signal.source as LearnedPattern['source'],
            examples: signal.examples,
            createdAt: nowISO(),
            lastSeenAt: nowISO(),
          });
          log.info('New pattern learned', { pattern: key, signals: signal.count });
        }
      }
    }
  }

  /** Normalize error strings for pattern matching */
  private normalizeError(error: string): string {
    return error
      .toLowerCase()
      .replace(/\b(line|col|column)\s*\d+/g, '')
      .replace(/\b\d+\b/g, 'N')
      .replace(/['"`].+?['"`]/g, 'STR')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }
}
