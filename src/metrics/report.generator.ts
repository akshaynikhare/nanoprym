/**
 * Report Generator — Weekly and daily summary reports
 */
import { CostTracker } from './cost.tracker.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('report-generator');

export interface WeeklyReport {
  period: string;
  tasksCompleted: number;
  tasksFailed: number;
  avgDurationMs: number;
  avgIterations: number;
  totalCostUsd: number;
  costBreakdown: Record<string, number>;
  topErrors: string[];
  improvements: string[];
}

export class ReportGenerator {
  private costTracker: CostTracker;

  constructor(costTracker: CostTracker) {
    this.costTracker = costTracker;
  }

  /** Generate a weekly summary report */
  generateWeekly(): string {
    const breakdown = this.costTracker.getMonthlyBreakdown();
    const totalCost = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
    const budget = this.costTracker.getRemainingBudget();

    const lines = [
      '=== NANOPRYM WEEKLY REPORT ===',
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      '',
      `Cloud cost this month: $${totalCost.toFixed(2)} (budget remaining: $${budget.toFixed(2)})`,
      '',
      'Cost breakdown:',
      ...Object.entries(breakdown).map(([provider, cost]) => `  ${provider}: $${cost.toFixed(4)}`),
      '',
      `Budget status: ${this.costTracker.isWithinBudget() ? '✅ Within budget' : '⚠️ OVER BUDGET'}`,
      '',
      '---',
      'Note: Claude Max and Copilot are subscription-based (not tracked per-token).',
    ];

    log.info('Weekly report generated');
    return lines.join('\n');
  }

  /** Generate a one-line status */
  generateStatus(): string {
    const budget = this.costTracker.getRemainingBudget();
    return `Cloud budget: $${budget.toFixed(2)} remaining | ${this.costTracker.isWithinBudget() ? 'OK' : 'OVER'}`;
  }
}
