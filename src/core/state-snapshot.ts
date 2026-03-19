/**
 * State Snapshotter — Compact working memory across agent iterations
 *
 * Publishes STATE_SNAPSHOT messages that summarize current task state.
 * Updated on every major event (ISSUE_OPENED, PLAN_READY, IMPLEMENTATION_READY, etc.)
 * Size-guarded to prevent context bloat.
 */
import { EventBus } from './event-bus.js';
import type { Message, StateSnapshot, MessageTopic } from '../_shared/types.js';
import { SNAPSHOT_LIMITS } from '../_shared/constants.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('state-snapshot');

/** Topics that trigger a snapshot update */
const TRIGGER_TOPICS: MessageTopic[] = [
  'ISSUE_OPENED',
  'PLAN_READY',
  'IMPLEMENTATION_READY',
  'WORKER_PROGRESS',
  'VALIDATION_RESULT',
];

export class StateSnapshotter {
  private bus: EventBus;
  private snapshots: Map<string, StateSnapshot> = new Map();

  constructor(bus: EventBus) {
    this.bus = bus;
    this.registerListeners();
  }

  /** Subscribe to all trigger topics */
  private registerListeners(): void {
    for (const topic of TRIGGER_TOPICS) {
      this.bus.subscribeTopic(topic, (message: Message) => {
        this.onMessage(message);
      });
    }
    log.info('StateSnapshotter registered', { topics: TRIGGER_TOPICS });
  }

  /** Handle an incoming message — update and publish snapshot */
  private onMessage(message: Message): void {
    const taskId = message.taskId;
    const snapshot = this.snapshots.get(taskId) ?? this.createEmptySnapshot(taskId);

    this.applyUpdate(snapshot, message);
    this.normalize(snapshot);

    this.snapshots.set(taskId, snapshot);
    this.publish(snapshot);
  }

  /** Get current snapshot for a task */
  getSnapshot(taskId: string): StateSnapshot | undefined {
    return this.snapshots.get(taskId);
  }

  /** Apply a message update to the snapshot */
  private applyUpdate(snapshot: StateSnapshot, message: Message): void {
    snapshot.updatedAt = new Date();
    const data = message.content.data ?? {};

    switch (message.topic) {
      case 'ISSUE_OPENED':
        snapshot.task = {
          raw: message.content.text,
          title: String(data.title ?? ''),
          issueNumber: data.issueNumber as number | undefined,
          source: String(data.source ?? ''),
        };
        break;

      case 'PLAN_READY':
        snapshot.plan = {
          text: message.content.text,
          summary: String(data.summary ?? ''),
          acceptanceCriteria: (data.acceptanceCriteria ?? []) as StateSnapshot['plan'] extends undefined ? never : NonNullable<StateSnapshot['plan']>['acceptanceCriteria'],
          filesAffected: (data.filesAffected ?? []) as string[],
        };
        break;

      case 'IMPLEMENTATION_READY':
      case 'WORKER_PROGRESS': {
        const status = data.completionStatus as Record<string, unknown> | undefined;
        snapshot.progress = {
          canValidate: Boolean(status?.canValidate ?? false),
          percentComplete: Number(status?.percentComplete ?? 0),
          blockers: (status?.blockers ?? []) as string[],
          nextSteps: (status?.nextSteps ?? []) as string[],
        };
        break;
      }

      case 'VALIDATION_RESULT':
        snapshot.validation = {
          approved: Boolean(data.approved),
          errors: (data.errors ?? []) as string[],
          criteriaResults: (data.criteriaResults ?? []) as StateSnapshot['validation'] extends undefined ? never : NonNullable<StateSnapshot['validation']>['criteriaResults'],
        };
        break;
    }
  }

  /** Normalize snapshot — enforce size limits */
  private normalize(snapshot: StateSnapshot): void {
    const limits = SNAPSHOT_LIMITS;

    if (snapshot.task) {
      snapshot.task.raw = truncate(snapshot.task.raw, limits.taskTextMax);
    }
    if (snapshot.plan) {
      snapshot.plan.text = truncate(snapshot.plan.text, limits.planTextMax);
      snapshot.plan.summary = truncate(snapshot.plan.summary, limits.summaryMax);
      snapshot.plan.acceptanceCriteria = snapshot.plan.acceptanceCriteria.slice(0, limits.criteriaMax);
    }
    if (snapshot.progress) {
      snapshot.progress.blockers = snapshot.progress.blockers.slice(0, limits.blockersMax);
      snapshot.progress.nextSteps = snapshot.progress.nextSteps.slice(0, limits.blockersMax);
    }
    if (snapshot.validation) {
      snapshot.validation.errors = snapshot.validation.errors.slice(0, limits.errorsMax);
      snapshot.validation.criteriaResults = snapshot.validation.criteriaResults.slice(0, limits.criteriaMax);
    }
  }

  /** Publish snapshot to event bus */
  private publish(snapshot: StateSnapshot): void {
    this.bus.publish({
      taskId: snapshot.taskId,
      topic: 'STATE_SNAPSHOT',
      sender: 'state-snapshotter',
      content: {
        text: this.renderSummary(snapshot),
        data: snapshot as unknown as Record<string, unknown>,
      },
    });
    log.debug('Snapshot published', { taskId: snapshot.taskId });
  }

  /** Create an empty snapshot */
  private createEmptySnapshot(taskId: string): StateSnapshot {
    return {
      version: 1,
      updatedAt: new Date(),
      taskId,
      task: { raw: '', title: '', source: '' },
    };
  }

  /** Render a compact text summary for context inclusion */
  private renderSummary(snapshot: StateSnapshot): string {
    const parts: string[] = [];

    parts.push(`TASK: ${snapshot.task.title || '(untitled)'}`);

    if (snapshot.plan) {
      parts.push(`PLAN: ${snapshot.plan.summary}`);
      parts.push(`FILES: ${snapshot.plan.filesAffected.join(', ')}`);
      parts.push(`CRITERIA: ${snapshot.plan.acceptanceCriteria.length} defined`);
    }

    if (snapshot.progress) {
      parts.push(`PROGRESS: ${snapshot.progress.percentComplete}% | canValidate: ${snapshot.progress.canValidate}`);
      if (snapshot.progress.blockers.length > 0) {
        parts.push(`BLOCKERS: ${snapshot.progress.blockers.join('; ')}`);
      }
    }

    if (snapshot.validation) {
      parts.push(`VALIDATION: ${snapshot.validation.approved ? 'APPROVED' : 'REJECTED'}`);
      if (snapshot.validation.errors.length > 0) {
        parts.push(`ERRORS: ${snapshot.validation.errors.join('; ')}`);
      }
    }

    return parts.join('\n');
  }
}

/** Truncate a string to maxLength */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
