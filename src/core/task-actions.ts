/**
 * Task Actions — Shared merge/reject logic
 * Used by both the API server and Slack bot for task approval workflows.
 */
import path from 'node:path';
import fs from 'node:fs';
import { EventLedger } from './event-ledger.js';
import type { GitManager } from '../git/git.manager.js';
import type { MessageTopic } from '../_shared/types.js';
import { GIT_BRANCH_PREFIX } from '../_shared/constants.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('task-actions');

export interface TaskActionDeps {
  gitManager: GitManager;
  ledgerBaseDir: string;
}

/** Merge a task's branch to main, cleanup worktree, record status */
export async function mergeTask(taskId: string, deps: TaskActionDeps): Promise<void> {
  const branch = `${GIT_BRANCH_PREFIX}${taskId}`;
  await deps.gitManager.mergeBranch(branch);
  await deps.gitManager.removeWorktree(taskId);
  await recordTaskStatus(taskId, 'merged', deps.ledgerBaseDir);
  log.info('Task merged', { taskId, branch });
}

/** Reject a task — remove worktree, delete branch, record status */
export async function rejectTask(taskId: string, deps: TaskActionDeps): Promise<void> {
  const branch = `${GIT_BRANCH_PREFIX}${taskId}`;
  await deps.gitManager.removeWorktree(taskId);
  await deps.gitManager.deleteBranch(branch);
  await recordTaskStatus(taskId, 'rejected', deps.ledgerBaseDir);
  log.info('Task rejected', { taskId, branch });
}

/** Write a final status event to the task's ledger */
export async function recordTaskStatus(taskId: string, status: string, ledgerBaseDir: string): Promise<void> {
  const ledgerPath = path.join(ledgerBaseDir, `${taskId}.db`);
  if (!fs.existsSync(ledgerPath)) return;

  try {
    const ledger = await EventLedger.create(ledgerPath);
    ledger.append({
      taskId,
      topic: 'CLUSTER_COMPLETE' as MessageTopic,
      sender: 'task-actions',
      content: {
        text: `Task ${status}`,
        data: { status },
      },
    });
    ledger.close();
  } catch {
    // Non-critical
  }
}
