import { describe, it, expect, beforeEach } from 'vitest';
import { EventLedger } from '../../src/core/event-ledger.js';
import { EventBus } from '../../src/core/event-bus.js';
import { TriggerEngine } from '../../src/agents/_shared/trigger.engine.js';
import type { Message } from '../../src/_shared/types.js';
import os from 'node:os';
import path from 'node:path';

describe('TriggerEngine', () => {
  let ledger: EventLedger;
  let bus: EventBus;
  let engine: TriggerEngine;

  beforeEach(async () => {
    const dbPath = path.join(os.tmpdir(), `trigger-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    ledger = await EventLedger.create(dbPath);
    bus = new EventBus(ledger);
    engine = new TriggerEngine(bus);
  });

  const makeMessage = (overrides?: Partial<Message>): Message => ({
    id: 'msg-1',
    taskId: 't1',
    topic: 'ISSUE_OPENED',
    sender: 'test',
    content: { text: 'test message' },
    timestamp: new Date(),
    ...overrides,
  });

  it('should evaluate simple true script', () => {
    const result = engine.evaluate(
      { engine: 'javascript', script: 'return true;' },
      makeMessage(),
    );
    expect(result).toBe(true);
  });

  it('should evaluate simple false script', () => {
    const result = engine.evaluate(
      { engine: 'javascript', script: 'return false;' },
      makeMessage(),
    );
    expect(result).toBe(false);
  });

  it('should access message properties in script', () => {
    const result = engine.evaluate(
      { engine: 'javascript', script: 'return message.sender === "planner";' },
      makeMessage({ sender: 'planner' }),
    );
    expect(result).toBe(true);
  });

  it('should access message content data in script', () => {
    const result = engine.evaluate(
      { engine: 'javascript', script: 'return message.content.data?.approved === false;' },
      makeMessage({ content: { text: 'rejected', data: { approved: false } } }),
    );
    expect(result).toBe(true);
  });

  it('should query ledger from script', () => {
    // Add some messages to the ledger
    bus.publish({ taskId: 't1', topic: 'VALIDATION_RESULT', sender: 'v1', content: { text: 'pass', data: { approved: true } } });
    bus.publish({ taskId: 't1', topic: 'VALIDATION_RESULT', sender: 'v2', content: { text: 'fail', data: { approved: false } } });

    const result = engine.evaluate(
      { engine: 'javascript', script: 'const msgs = ledger.query({ topic: "VALIDATION_RESULT" }); return msgs.some(m => m.content.data?.approved === false);' },
      makeMessage(),
    );
    expect(result).toBe(true);
  });

  it('should return false for unsupported engine', () => {
    const result = engine.evaluate(
      { engine: 'python', script: 'return True' },
      makeMessage(),
    );
    expect(result).toBe(false);
  });

  it('should return false on script error', () => {
    const result = engine.evaluate(
      { engine: 'javascript', script: 'throw new Error("boom");' },
      makeMessage(),
    );
    expect(result).toBe(false);
  });

  it('should evaluate hook logic with result', () => {
    const result = engine.evaluateHookLogic(
      { engine: 'javascript', script: 'return result.completionStatus?.canValidate === true;' },
      { summary: 'done', completionStatus: { canValidate: true, percentComplete: 100 } },
      makeMessage(),
    );
    expect(result).toBe(true);
  });

  it('should evaluate transform script', () => {
    const result = engine.evaluateTransform(
      { engine: 'javascript', script: 'return { topic: "WORKER_PROGRESS" };' },
      { summary: 'not done', completionStatus: { canValidate: false, percentComplete: 50 } },
      makeMessage(),
    );
    expect(result).toEqual({ topic: 'WORKER_PROGRESS' });
  });
});
