/**
 * Metrics Collector — Tracks task performance, costs, and quality
 */
import { EventBus } from '../core/event-bus.js';
import { DatabaseClient } from '../db/db.client.js';
import type { Message } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';
import { nowISO } from '../_shared/utils.js';

const log = createChildLogger('metrics');

export interface TaskMetrics {
  taskId: string;
  duration_ms: number;
  iterations: number;
  scannerPassed: boolean;
  reviewApproved: boolean;
  humanCorrections: number;
}

export class MetricsCollector {
  private bus: EventBus;
  private db: DatabaseClient | null = null;
  private taskStartTimes: Map<string, number> = new Map();
  private taskIterations: Map<string, number> = new Map();

  constructor(bus: EventBus, db?: DatabaseClient) {
    this.bus = bus;
    this.db = db ?? null;
    this.subscribe();
  }

  private subscribe(): void {
    this.bus.subscribeTopic('ISSUE_OPENED', (msg) => {
      this.taskStartTimes.set(msg.taskId, Date.now());
      this.taskIterations.set(msg.taskId, 0);
    });

    this.bus.subscribeTopic('WORKER_PROGRESS', (msg) => {
      const count = (this.taskIterations.get(msg.taskId) ?? 0) + 1;
      this.taskIterations.set(msg.taskId, count);
    });

    this.bus.subscribeTopic('CLUSTER_COMPLETE', (msg) => {
      this.recordTaskCompletion(msg);
    });

    log.info('MetricsCollector subscribed');
  }

  private recordTaskCompletion(msg: Message): void {
    const startTime = this.taskStartTimes.get(msg.taskId);
    const duration = startTime ? Date.now() - startTime : 0;
    const iterations = this.taskIterations.get(msg.taskId) ?? 0;

    if (this.db) {
      this.db.insert(
        'INSERT INTO metrics (task_id, metric_type, value, metadata, recorded_at) VALUES (?, ?, ?, ?, ?)',
        [msg.taskId, 'task_duration_ms', duration, JSON.stringify({ iterations }), nowISO()]
      );
    }

    log.info('Task metrics recorded', { taskId: msg.taskId, duration, iterations });

    // Cleanup
    this.taskStartTimes.delete(msg.taskId);
    this.taskIterations.delete(msg.taskId);
  }

  /** Get summary stats */
  async getSummary(): Promise<{
    totalTasks: number;
    avgDuration: number;
    avgIterations: number;
  }> {
    if (!this.db) return { totalTasks: 0, avgDuration: 0, avgIterations: 0 };

    const rows = this.db.query<{ count: number; avg_val: number }>(
      'SELECT COUNT(*) as count, AVG(value) as avg_val FROM metrics WHERE metric_type = ?',
      ['task_duration_ms']
    );

    return {
      totalTasks: rows[0]?.count ?? 0,
      avgDuration: rows[0]?.avg_val ?? 0,
      avgIterations: 0, // TODO: compute from metadata
    };
  }
}
