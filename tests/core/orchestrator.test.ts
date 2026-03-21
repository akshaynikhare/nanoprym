/**
 * Orchestrator Integration Test
 * Tests the full pipeline: startTask → agents created → events flow → completion
 * Uses mock providers (no real Claude/Copilot calls)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventLedger } from '../../src/core/event-ledger.js';
import { EventBus } from '../../src/core/event-bus.js';
import { StateSnapshotter } from '../../src/core/state-snapshot.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { routeTask } from '../../src/core/config-router.js';
import type { Message } from '../../src/_shared/types.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

describe('Orchestrator', () => {
  const testDir = path.join(os.tmpdir(), 'nanoprym-orchestrator-tests');
  let ledger: EventLedger;
  let bus: EventBus;

  beforeEach(async () => {
    const dbPath = path.join(testDir, `orch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    ledger = await EventLedger.create(dbPath);
    bus = new EventBus(ledger);
  });

  afterEach(() => {
    ledger.close();
  });

  describe('Config Router', () => {
    it('should route TRIVIAL/TASK to single-worker', () => {
      const route = routeTask('TRIVIAL', 'TASK');
      expect(route.template).toBe('single-worker');
      expect(route.validatorCount).toBe(0);
    });

    it('should route STANDARD/TASK to full-workflow', () => {
      const route = routeTask('STANDARD', 'TASK');
      expect(route.template).toBe('full-workflow');
      expect(route.validatorCount).toBe(2);
    });

    it('should route CRITICAL/TASK to full-workflow with 3 validators', () => {
      const route = routeTask('CRITICAL', 'TASK');
      expect(route.template).toBe('full-workflow');
      expect(route.validatorCount).toBe(3);
    });

    it('should route SIMPLE/DEBUG to debug-workflow', () => {
      const route = routeTask('SIMPLE', 'DEBUG');
      expect(route.template).toBe('debug-workflow');
    });
  });

  describe('Event Flow', () => {
    it('should flow ISSUE_OPENED → STATE_SNAPSHOT', () => {
      const snapshotter = new StateSnapshotter(bus);
      const collected: Message[] = [];
      bus.subscribeTopic('STATE_SNAPSHOT', (msg) => collected.push(msg));

      bus.publish({
        taskId: 't1',
        topic: 'ISSUE_OPENED',
        sender: 'orchestrator',
        content: {
          text: 'Add dark mode toggle',
          data: { title: 'Dark mode', complexity: 'STANDARD', taskType: 'TASK', source: 'github' },
        },
      });

      expect(collected.length).toBe(1);
      expect(collected[0].content.text).toContain('TASK: Dark mode');

      const snapshot = snapshotter.getSnapshot('t1');
      expect(snapshot).toBeDefined();
      expect(snapshot!.task.title).toBe('Dark mode');
    });

    it('should flow ISSUE_OPENED → PLAN_READY → STATE_SNAPSHOT updates', () => {
      const snapshotter = new StateSnapshotter(bus);

      bus.publish({
        taskId: 't1',
        topic: 'ISSUE_OPENED',
        sender: 'orchestrator',
        content: { text: 'Fix auth', data: { title: 'Auth fix', source: 'github' } },
      });

      bus.publish({
        taskId: 't1',
        topic: 'PLAN_READY',
        sender: 'planner',
        content: {
          text: '1. Fix token validation\n2. Add tests',
          data: {
            summary: 'Fix JWT validation',
            filesAffected: ['src/auth.ts'],
            acceptanceCriteria: [
              { id: 'AC1', criterion: 'JWT validates correctly', verification: 'npm test', priority: 'MUST' },
            ],
          },
        },
      });

      const snapshot = snapshotter.getSnapshot('t1');
      expect(snapshot!.plan).toBeDefined();
      expect(snapshot!.plan!.summary).toBe('Fix JWT validation');
      expect(snapshot!.plan!.acceptanceCriteria).toHaveLength(1);
    });

    it('should track full pipeline events in ledger', () => {
      new StateSnapshotter(bus);

      // Simulate full pipeline
      bus.publish({ taskId: 't1', topic: 'ISSUE_OPENED', sender: 'orchestrator', content: { text: 'Fix bug' } });
      bus.publish({ taskId: 't1', topic: 'PLAN_READY', sender: 'planner', content: { text: 'Plan: fix it', data: { summary: 'fix', filesAffected: [], acceptanceCriteria: [] } } });
      bus.publish({ taskId: 't1', topic: 'IMPLEMENTATION_READY', sender: 'builder', content: { text: 'Done', data: { completionStatus: { canValidate: true, percentComplete: 100 } } } });
      bus.publish({ taskId: 't1', topic: 'VALIDATION_RESULT', sender: 'reviewer', content: { text: 'Approved', data: { approved: true, errors: [] } } });
      bus.publish({ taskId: 't1', topic: 'CLUSTER_COMPLETE', sender: 'orchestrator', content: { text: 'Task complete' } });

      // Verify all events are in ledger
      const allMessages = bus.query({ taskId: 't1' });
      const topics = allMessages.map(m => m.topic);

      expect(topics).toContain('ISSUE_OPENED');
      expect(topics).toContain('PLAN_READY');
      expect(topics).toContain('IMPLEMENTATION_READY');
      expect(topics).toContain('VALIDATION_RESULT');
      expect(topics).toContain('CLUSTER_COMPLETE');
      expect(topics).toContain('STATE_SNAPSHOT'); // Auto-generated by snapshotter
    });

    it('should handle rejection → retry flow', () => {
      new StateSnapshotter(bus);

      bus.publish({ taskId: 't1', topic: 'ISSUE_OPENED', sender: 'orchestrator', content: { text: 'Fix bug' } });
      bus.publish({ taskId: 't1', topic: 'PLAN_READY', sender: 'planner', content: { text: 'Plan', data: { summary: 'fix', filesAffected: [], acceptanceCriteria: [] } } });
      bus.publish({ taskId: 't1', topic: 'IMPLEMENTATION_READY', sender: 'builder', content: { text: 'Done', data: { completionStatus: { canValidate: true, percentComplete: 100 } } } });

      // Rejection
      bus.publish({ taskId: 't1', topic: 'VALIDATION_RESULT', sender: 'reviewer', content: { text: 'Missing null check', data: { approved: false, errors: ['null check missing'] } } });

      // Builder retries
      bus.publish({ taskId: 't1', topic: 'WORKER_PROGRESS', sender: 'builder', content: { text: 'Fixing null check', data: { completionStatus: { canValidate: false, percentComplete: 60 } } } });
      bus.publish({ taskId: 't1', topic: 'IMPLEMENTATION_READY', sender: 'builder', content: { text: 'Fixed', data: { completionStatus: { canValidate: true, percentComplete: 100 } } } });

      // Approved
      bus.publish({ taskId: 't1', topic: 'VALIDATION_RESULT', sender: 'reviewer', content: { text: 'Approved', data: { approved: true, errors: [] } } });

      const validations = bus.query({ taskId: 't1', topic: 'VALIDATION_RESULT' });
      expect(validations).toHaveLength(2);
      expect(validations[0].content.data?.approved).toBe(false);
      expect(validations[1].content.data?.approved).toBe(true);
    });
  });

  describe('Health Check', () => {
    it('should expose health status via getHealthStatus()', () => {
      const configDir = path.join(testDir, `health-${Date.now()}`);
      const orchestrator = new Orchestrator({ configDir, healthPort: 0 });

      const health = orchestrator.getHealthStatus();
      expect(health).not.toBeNull();
      expect(['ok', 'degraded']).toContain(health!.status);
      expect(health!.version).toBeDefined();
      expect(typeof health!.uptime).toBe('number');
      expect(health!.uptime).toBeGreaterThanOrEqual(0);
      expect(health!.timestamp).toBeDefined();
      expect(health!.activeTask).toBe(false);

      orchestrator.shutdown();
    });

    it('should return null after shutdown', () => {
      const configDir = path.join(testDir, `health-shutdown-${Date.now()}`);
      const orchestrator = new Orchestrator({ configDir, healthPort: 0 });

      orchestrator.shutdown();

      const health = orchestrator.getHealthStatus();
      expect(health).toBeNull();
    });
  });

  describe('Crash Recovery', () => {
    it('should persist and reload full event history', async () => {
      const dbPath = path.join(testDir, `recovery-${Date.now()}.db`);

      // Session 1: create events
      const ledger1 = await EventLedger.create(dbPath);
      const bus1 = new EventBus(ledger1);

      bus1.publish({ taskId: 't1', topic: 'ISSUE_OPENED', sender: 'orch', content: { text: 'Task A' } });
      bus1.publish({ taskId: 't1', topic: 'PLAN_READY', sender: 'planner', content: { text: 'Plan A' } });
      bus1.publish({ taskId: 't1', topic: 'IMPLEMENTATION_READY', sender: 'builder', content: { text: 'Done' } });
      ledger1.close();

      // Session 2: reload and verify
      const ledger2 = await EventLedger.create(dbPath);
      const bus2 = new EventBus(ledger2);

      const messages = bus2.query({ taskId: 't1' });
      expect(messages).toHaveLength(3);
      expect(messages[0].topic).toBe('ISSUE_OPENED');
      expect(messages[1].topic).toBe('PLAN_READY');
      expect(messages[2].topic).toBe('IMPLEMENTATION_READY');

      const last = bus2.findLast({ topic: 'IMPLEMENTATION_READY' });
      expect(last).toBeDefined();
      expect(last!.sender).toBe('builder');

      ledger2.close();

      // Cleanup
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    });
  });
});
