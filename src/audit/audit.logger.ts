/**
 * Audit Logger — Structured audit trail
 * Wraps the event ledger with audit-specific convenience methods.
 * Every decision, action, and outcome is recorded.
 */
import { EventBus } from '../core/event-bus.js';
import type { Message, MessageTopic } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';
import { nowISO } from '../_shared/utils.js';

const log = createChildLogger('audit');

export type AuditEventType =
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'agent_executed'
  | 'review_approved'
  | 'review_rejected'
  | 'scanner_passed'
  | 'scanner_failed'
  | 'error_retry'
  | 'error_escalated'
  | 'human_decision'
  | 'config_changed';

export interface AuditEntry {
  type: AuditEventType;
  taskId: string;
  agent?: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export class AuditLogger {
  private bus: EventBus;
  private entries: AuditEntry[] = [];

  constructor(bus: EventBus) {
    this.bus = bus;
    this.subscribeToEvents();
  }

  /** Log a custom audit entry */
  logEntry(entry: Omit<AuditEntry, 'timestamp'>): void {
    const full: AuditEntry = { ...entry, timestamp: nowISO() };
    this.entries.push(full);
    log.info('Audit', { type: entry.type, taskId: entry.taskId, agent: entry.agent });
  }

  /** Get recent audit entries */
  getRecent(count: number = 20): AuditEntry[] {
    return this.entries.slice(-count);
  }

  /** Get entries for a specific task */
  getByTask(taskId: string): AuditEntry[] {
    return this.entries.filter(e => e.taskId === taskId);
  }

  /** Auto-subscribe to bus events and create audit entries */
  private subscribeToEvents(): void {
    const topicToAuditType: Partial<Record<MessageTopic, AuditEventType>> = {
      'ISSUE_OPENED': 'task_started',
      'CLUSTER_COMPLETE': 'task_completed',
      'VALIDATION_RESULT': 'review_approved', // refined below
      'SCAN_RESULT': 'scanner_passed', // refined below
      'WORKER_PROGRESS': 'error_retry',
      'HUMAN_DECISION': 'human_decision',
    };

    this.bus.subscribe((message: Message) => {
      let auditType = topicToAuditType[message.topic];
      if (!auditType) return;

      // Refine based on content
      if (message.topic === 'VALIDATION_RESULT') {
        auditType = message.content.data?.approved ? 'review_approved' : 'review_rejected';
      }
      if (message.topic === 'SCAN_RESULT') {
        auditType = message.content.data?.approved ? 'scanner_passed' : 'scanner_failed';
      }
      if (message.topic === 'CLUSTER_COMPLETE') {
        const status = message.content.data?.status;
        auditType = status === 'failed' || status === 'escalated' ? 'task_failed' : 'task_completed';
      }

      this.logEntry({
        type: auditType,
        taskId: message.taskId,
        agent: message.sender,
        details: {
          topic: message.topic,
          summary: message.content.text.slice(0, 200),
          data: message.content.data,
        },
      });
    });

    log.info('AuditLogger subscribed to event bus');
  }
}
