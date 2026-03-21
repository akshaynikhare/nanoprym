/**
 * Task Actions Tests
 * Tests the shared merge/reject logic extracted from ApiServer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mergeTask, rejectTask, recordTaskStatus } from '../../src/core/task-actions.js';
import { EventLedger } from '../../src/core/event-ledger.js';
import type { TaskActionDeps } from '../../src/core/task-actions.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

describe('Task Actions', () => {
  const testDir = path.join(os.tmpdir(), `nanoprym-task-actions-${Date.now()}`);
  let mockGitManager: TaskActionDeps['gitManager'];

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    mockGitManager = {
      mergeBranch: vi.fn().mockResolvedValue(undefined),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      getRepoRoot: vi.fn().mockReturnValue('/tmp/repo'),
    } as unknown as TaskActionDeps['gitManager'];
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('mergeTask', () => {
    it('should merge branch, remove worktree, and record status', async () => {
      // Create a ledger so recordTaskStatus can write to it
      const ledgerPath = path.join(testDir, 'task-123.db');
      const ledger = await EventLedger.create(ledgerPath);
      ledger.close();

      await mergeTask('task-123', { gitManager: mockGitManager, ledgerBaseDir: testDir });

      expect(mockGitManager.mergeBranch).toHaveBeenCalledWith('nanoprym/task-123');
      expect(mockGitManager.removeWorktree).toHaveBeenCalledWith('task-123');

      // Verify ledger was updated
      const verifyLedger = await EventLedger.create(ledgerPath);
      const events = verifyLedger.query({ topic: 'CLUSTER_COMPLETE' as any });
      expect(events.length).toBe(1);
      expect(events[0].content.data?.status).toBe('merged');
      verifyLedger.close();
    });

    it('should throw if mergeBranch fails', async () => {
      (mockGitManager.mergeBranch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('merge conflict'));

      await expect(mergeTask('task-fail', { gitManager: mockGitManager, ledgerBaseDir: testDir }))
        .rejects.toThrow('merge conflict');
    });
  });

  describe('rejectTask', () => {
    it('should remove worktree, delete branch, and record status', async () => {
      const ledgerPath = path.join(testDir, 'task-456.db');
      const ledger = await EventLedger.create(ledgerPath);
      ledger.close();

      await rejectTask('task-456', { gitManager: mockGitManager, ledgerBaseDir: testDir });

      expect(mockGitManager.removeWorktree).toHaveBeenCalledWith('task-456');
      expect(mockGitManager.deleteBranch).toHaveBeenCalledWith('nanoprym/task-456');

      const verifyLedger = await EventLedger.create(ledgerPath);
      const events = verifyLedger.query({ topic: 'CLUSTER_COMPLETE' as any });
      expect(events.length).toBe(1);
      expect(events[0].content.data?.status).toBe('rejected');
      verifyLedger.close();
    });
  });

  describe('recordTaskStatus', () => {
    it('should skip if no ledger file exists', async () => {
      // Should not throw
      await recordTaskStatus('nonexistent', 'merged', testDir);
    });

    it('should write CLUSTER_COMPLETE event to ledger', async () => {
      const ledgerPath = path.join(testDir, 'task-789.db');
      const ledger = await EventLedger.create(ledgerPath);
      ledger.close();

      await recordTaskStatus('task-789', 'rejected', testDir);

      const verifyLedger = await EventLedger.create(ledgerPath);
      const events = verifyLedger.query({ topic: 'CLUSTER_COMPLETE' as any });
      expect(events.length).toBe(1);
      expect(events[0].sender).toBe('task-actions');
      expect(events[0].content.text).toBe('Task rejected');
      verifyLedger.close();
    });
  });
});
