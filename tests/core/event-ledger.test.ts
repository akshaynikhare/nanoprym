import { describe, it, expect, afterEach } from 'vitest';
import { EventLedger } from '../../src/core/event-ledger.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('EventLedger', () => {
  const testDir = path.join(os.tmpdir(), 'nanoprym-test-ledgers');
  const ledgerPaths: string[] = [];

  function createTestLedger(): Promise<EventLedger> {
    const dbPath = path.join(testDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    ledgerPaths.push(dbPath);
    return EventLedger.create(dbPath);
  }

  afterEach(() => {
    for (const p of ledgerPaths) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
    ledgerPaths.length = 0;
  });

  it('should create a new ledger and append a message', async () => {
    const ledger = await createTestLedger();

    const msg = ledger.append({
      taskId: 'task-1',
      topic: 'ISSUE_OPENED',
      sender: 'orchestrator',
      content: { text: 'Fix the bug', data: { issueNumber: 42 } },
    });

    expect(msg).not.toBeNull();
    expect(msg!.id).toBeDefined();
    expect(msg!.topic).toBe('ISSUE_OPENED');
    expect(msg!.content.text).toBe('Fix the bug');
    expect(msg!.content.data).toEqual({ issueNumber: 42 });

    ledger.close();
  });

  it('should query messages by topic', async () => {
    const ledger = await createTestLedger();

    ledger.append({ taskId: 't1', topic: 'ISSUE_OPENED', sender: 'a', content: { text: 'one' } });
    ledger.append({ taskId: 't1', topic: 'PLAN_READY', sender: 'b', content: { text: 'two' } });
    ledger.append({ taskId: 't1', topic: 'ISSUE_OPENED', sender: 'c', content: { text: 'three' } });

    const results = ledger.query({ topic: 'ISSUE_OPENED' });
    expect(results).toHaveLength(2);
    expect(results[0].content.text).toBe('one');
    expect(results[1].content.text).toBe('three');

    ledger.close();
  });

  it('should count messages', async () => {
    const ledger = await createTestLedger();

    ledger.append({ taskId: 't1', topic: 'ISSUE_OPENED', sender: 'a', content: { text: '1' } });
    ledger.append({ taskId: 't1', topic: 'ISSUE_OPENED', sender: 'b', content: { text: '2' } });
    ledger.append({ taskId: 't1', topic: 'PLAN_READY', sender: 'c', content: { text: '3' } });

    expect(ledger.count({ topic: 'ISSUE_OPENED' })).toBe(2);
    expect(ledger.count({ topic: 'PLAN_READY' })).toBe(1);
    expect(ledger.count({})).toBe(3);

    ledger.close();
  });

  it('should findLast message', async () => {
    const ledger = await createTestLedger();

    ledger.append({ taskId: 't1', topic: 'VALIDATION_RESULT', sender: 'v1', content: { text: 'fail' } });
    ledger.append({ taskId: 't1', topic: 'VALIDATION_RESULT', sender: 'v2', content: { text: 'pass' } });

    const last = ledger.findLast({ topic: 'VALIDATION_RESULT' });
    expect(last).toBeDefined();
    expect(last!.content.text).toBe('pass');

    ledger.close();
  });

  it('should persist and reload from disk', async () => {
    const dbPath = path.join(testDir, `persist-test-${Date.now()}.db`);
    ledgerPaths.push(dbPath);

    const ledger1 = await EventLedger.create(dbPath);
    ledger1.append({ taskId: 't1', topic: 'ISSUE_OPENED', sender: 'test', content: { text: 'hello' } });
    ledger1.close();

    // Reopen from disk
    const ledger2 = await EventLedger.create(dbPath);
    const messages = ledger2.query({});
    expect(messages).toHaveLength(1);
    expect(messages[0].content.text).toBe('hello');
    ledger2.close();
  });

  it('should return null when appending after close', async () => {
    const ledger = await createTestLedger();
    ledger.close();

    const msg = ledger.append({
      taskId: 't1',
      topic: 'ISSUE_OPENED',
      sender: 'test',
      content: { text: 'should fail' },
    });

    expect(msg).toBeNull();
  });
});
