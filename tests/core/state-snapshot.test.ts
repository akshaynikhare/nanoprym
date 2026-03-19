import { describe, it, expect, beforeEach } from 'vitest';
import { EventLedger } from '../../src/core/event-ledger.js';
import { EventBus } from '../../src/core/event-bus.js';
import { StateSnapshotter } from '../../src/core/state-snapshot.js';
import os from 'node:os';
import path from 'node:path';

describe('StateSnapshotter', () => {
  let ledger: EventLedger;
  let bus: EventBus;
  let snapshotter: StateSnapshotter;
  const testDir = path.join(os.tmpdir(), 'nanoprym-snapshot-tests');

  beforeEach(async () => {
    const dbPath = path.join(testDir, `snap-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    ledger = await EventLedger.create(dbPath);
    bus = new EventBus(ledger);
    snapshotter = new StateSnapshotter(bus);
  });

  it('should create snapshot on ISSUE_OPENED', () => {
    bus.publish({
      taskId: 't1',
      topic: 'ISSUE_OPENED',
      sender: 'orchestrator',
      content: {
        text: 'Fix the auth bug',
        data: { title: 'Auth bug', issueNumber: 42, source: 'github' },
      },
    });

    const snapshot = snapshotter.getSnapshot('t1');
    expect(snapshot).toBeDefined();
    expect(snapshot!.task.title).toBe('Auth bug');
    expect(snapshot!.task.issueNumber).toBe(42);
  });

  it('should update snapshot on PLAN_READY', () => {
    bus.publish({
      taskId: 't1',
      topic: 'ISSUE_OPENED',
      sender: 'orchestrator',
      content: { text: 'Fix bug', data: { title: 'Bug', source: 'github' } },
    });

    bus.publish({
      taskId: 't1',
      topic: 'PLAN_READY',
      sender: 'planner',
      content: {
        text: '1. Fix auth\n2. Add tests',
        data: {
          summary: 'Fix auth flow',
          filesAffected: ['src/auth.ts', 'tests/auth.test.ts'],
          acceptanceCriteria: [
            { id: 'AC1', criterion: 'Auth works', verification: 'npm test', priority: 'MUST' },
          ],
        },
      },
    });

    const snapshot = snapshotter.getSnapshot('t1');
    expect(snapshot!.plan).toBeDefined();
    expect(snapshot!.plan!.summary).toBe('Fix auth flow');
    expect(snapshot!.plan!.filesAffected).toEqual(['src/auth.ts', 'tests/auth.test.ts']);
  });

  it('should update snapshot on VALIDATION_RESULT', () => {
    bus.publish({
      taskId: 't1',
      topic: 'ISSUE_OPENED',
      sender: 'orchestrator',
      content: { text: 'Fix bug', data: { title: 'Bug', source: 'github' } },
    });

    bus.publish({
      taskId: 't1',
      topic: 'VALIDATION_RESULT',
      sender: 'reviewer',
      content: {
        text: 'Rejected',
        data: { approved: false, errors: ['Missing null check'], criteriaResults: [] },
      },
    });

    const snapshot = snapshotter.getSnapshot('t1');
    expect(snapshot!.validation).toBeDefined();
    expect(snapshot!.validation!.approved).toBe(false);
    expect(snapshot!.validation!.errors).toEqual(['Missing null check']);
  });

  it('should publish STATE_SNAPSHOT to the bus', () => {
    const snapshots: string[] = [];
    bus.subscribeTopic('STATE_SNAPSHOT', (msg) => {
      snapshots.push(msg.content.text);
    });

    bus.publish({
      taskId: 't1',
      topic: 'ISSUE_OPENED',
      sender: 'orchestrator',
      content: { text: 'Fix bug', data: { title: 'Auth Fix', source: 'github' } },
    });

    expect(snapshots.length).toBe(1);
    expect(snapshots[0]).toContain('TASK: Auth Fix');
  });

  it('should truncate long text fields', () => {
    const longText = 'x'.repeat(5000);

    bus.publish({
      taskId: 't1',
      topic: 'ISSUE_OPENED',
      sender: 'orchestrator',
      content: { text: longText, data: { title: 'Bug', source: 'github' } },
    });

    const snapshot = snapshotter.getSnapshot('t1');
    expect(snapshot!.task.raw.length).toBeLessThanOrEqual(2000);
  });
});
