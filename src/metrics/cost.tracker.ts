/**
 * Cost Tracker — Tracks LLM API costs per task, provider, and month
 * Enforces TOM's $5/month cloud budget cap
 */
import { DatabaseClient } from '../db/db.client.js';
import { createChildLogger } from '../_shared/logger.js';
import { nowISO } from '../_shared/utils.js';
import { TOM_CLOUD_BUDGET_USD } from '../_shared/constants.js';

const log = createChildLogger('cost-tracker');

export interface CostEntry {
  taskId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class CostTracker {
  private db: DatabaseClient | null = null;
  private sessionCosts: CostEntry[] = [];

  constructor(db?: DatabaseClient) {
    this.db = db ?? null;
  }

  /** Record a cost entry */
  record(entry: CostEntry): void {
    this.sessionCosts.push(entry);

    if (this.db) {
      this.db.insert(
        'INSERT INTO cost_tracking (task_id, provider, model, input_tokens, output_tokens, cost_usd, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [entry.taskId ?? null, entry.provider, entry.model, entry.inputTokens, entry.outputTokens, entry.costUsd, nowISO()]
      );
    }

    log.debug('Cost recorded', { provider: entry.provider, model: entry.model, cost: entry.costUsd });
  }

  /** Get current month's total cloud cost */
  getMonthlyCloudCost(): number {
    if (!this.db) {
      return this.sessionCosts
        .filter(c => c.provider !== 'claude-max' && c.provider !== 'copilot')
        .reduce((sum, c) => sum + c.costUsd, 0);
    }

    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const rows = this.db.query<{ total: number }>(
      "SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_tracking WHERE recorded_at LIKE ? AND provider NOT IN ('claude-max', 'copilot')",
      [`${month}%`]
    );

    return rows[0]?.total ?? 0;
  }

  /** Check if we're within budget */
  isWithinBudget(): boolean {
    return this.getMonthlyCloudCost() < TOM_CLOUD_BUDGET_USD;
  }

  /** Get remaining budget */
  getRemainingBudget(): number {
    return Math.max(0, TOM_CLOUD_BUDGET_USD - this.getMonthlyCloudCost());
  }

  /** Get cost breakdown by provider for current month */
  getMonthlyBreakdown(): Record<string, number> {
    if (!this.db) {
      const breakdown: Record<string, number> = {};
      for (const c of this.sessionCosts) {
        breakdown[c.provider] = (breakdown[c.provider] ?? 0) + c.costUsd;
      }
      return breakdown;
    }

    const month = new Date().toISOString().slice(0, 7);
    const rows = this.db.query<{ provider: string; total: number }>(
      "SELECT provider, SUM(cost_usd) as total FROM cost_tracking WHERE recorded_at LIKE ? GROUP BY provider",
      [`${month}%`]
    );

    const breakdown: Record<string, number> = {};
    for (const row of rows) {
      breakdown[row.provider] = row.total;
    }
    return breakdown;
  }
}
