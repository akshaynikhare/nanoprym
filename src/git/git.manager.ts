/**
 * Git Manager — Worktree isolation, branch creation, PR management
 * Uses gh CLI for GitHub operations, git for local operations.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { createChildLogger } from '../_shared/logger.js';
import { GIT_BRANCH_PREFIX } from '../_shared/constants.js';
// kebabCase available from utils if needed

const execAsync = promisify(exec);
const log = createChildLogger('git-manager');

export interface WorktreeInfo {
  path: string;
  branch: string;
  taskId: string;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  branch: string;
  title: string;
}

export class GitManager {
  private repoRoot: string;

  constructor(repoRoot?: string) {
    this.repoRoot = repoRoot ?? process.cwd();
  }

  /** Create a git worktree for isolated task execution */
  async createWorktree(taskId: string, baseBranch: string = 'main'): Promise<WorktreeInfo> {
    const branchName = `${GIT_BRANCH_PREFIX}${taskId}`;
    const worktreePath = path.join(this.repoRoot, '..', `.nanoprym-worktrees`, taskId);

    // Ensure parent dir exists
    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      // Create worktree with new branch
      await this.git(`worktree add -b ${branchName} ${worktreePath} ${baseBranch}`);
      log.info('Worktree created', { taskId, branch: branchName, path: worktreePath });

      return { path: worktreePath, branch: branchName, taskId };
    } catch (error) {
      log.error('Failed to create worktree', { taskId, error: String(error) });
      throw error;
    }
  }

  /** Remove a worktree after task completion */
  async removeWorktree(taskId: string): Promise<void> {
    const worktreePath = path.join(this.repoRoot, '..', `.nanoprym-worktrees`, taskId);
    const branchName = `${GIT_BRANCH_PREFIX}${taskId}`;

    try {
      await this.git(`worktree remove ${worktreePath} --force`);
      // Clean up the branch if it was merged
      try {
        await this.git(`branch -d ${branchName}`);
      } catch {
        // Branch may not exist or may not be merged — that's fine
      }
      log.info('Worktree removed', { taskId });
    } catch (error) {
      log.warn('Failed to remove worktree', { taskId, error: String(error) });
    }
  }

  /** Stage specific files and create a conventional commit */
  async commit(
    worktreePath: string,
    files: string[],
    message: string,
  ): Promise<string> {
    // Stage specific files only (never git add .)
    for (const file of files) {
      await this.gitIn(worktreePath, `add ${file}`);
    }

    // Create commit
    const { stdout } = await this.gitIn(worktreePath, `commit -m "${message.replace(/"/g, '\\"')}"`);
    const commitHash = stdout.match(/\[[\w/-]+ ([a-f0-9]+)\]/)?.[1] ?? 'unknown';

    log.info('Committed', { files: files.length, hash: commitHash, message: message.slice(0, 80) });
    return commitHash;
  }

  /** Push branch to remote */
  async push(worktreePath: string, branch: string): Promise<void> {
    await this.gitIn(worktreePath, `push -u origin ${branch}`);
    log.info('Pushed', { branch });
  }

  /** Create a pull request via gh CLI */
  async createPR(options: {
    worktreePath: string;
    branch: string;
    title: string;
    body: string;
    baseBranch?: string;
  }): Promise<PullRequestInfo> {
    const base = options.baseBranch ?? 'main';

    const { stdout } = await this.execIn(
      options.worktreePath,
      `gh pr create --title "${options.title.replace(/"/g, '\\"')}" --body "${options.body.replace(/"/g, '\\"')}" --base ${base} --head ${options.branch}`
    );

    // Parse PR URL from gh output
    const prUrl = stdout.trim();
    const prNumber = parseInt(prUrl.split('/').pop() ?? '0', 10);

    log.info('PR created', { number: prNumber, url: prUrl, branch: options.branch });

    return {
      number: prNumber,
      url: prUrl,
      branch: options.branch,
      title: options.title,
    };
  }

  /** Request Copilot review on a PR */
  async requestCopilotReview(prNumber: number): Promise<void> {
    try {
      await this.exec(`gh pr edit ${prNumber} --add-reviewer @copilot`);
      log.info('Copilot review requested', { prNumber });
    } catch (error) {
      log.warn('Failed to request Copilot review', { prNumber, error: String(error) });
    }
  }

  /** Get PR review comments */
  async getPRReviewComments(prNumber: number): Promise<Array<{ body: string; author: string; path?: string }>> {
    try {
      const { stdout } = await this.exec(
        `gh api repos/{owner}/{repo}/pulls/${prNumber}/reviews --jq '.[] | {body: .body, author: .user.login, state: .state}'`
      );

      const reviews = stdout.trim().split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      return reviews;
    } catch (error) {
      log.warn('Failed to get PR reviews', { prNumber, error: String(error) });
      return [];
    }
  }

  /** Get current branch name */
  async getCurrentBranch(worktreePath?: string): Promise<string> {
    const cmd = 'rev-parse --abbrev-ref HEAD';
    const { stdout } = worktreePath ? await this.gitIn(worktreePath, cmd) : await this.git(cmd);
    return stdout.trim();
  }

  /** Get list of changed files (committed, compared to base branch) */
  async getChangedFiles(worktreePath: string, baseBranch: string = 'main'): Promise<string[]> {
    const { stdout } = await this.gitIn(worktreePath, `diff --name-only ${baseBranch}...HEAD`);
    return stdout.trim().split('\n').filter(Boolean);
  }

  /** Get uncommitted files (staged + unstaged + untracked) */
  async getUncommittedFiles(worktreePath: string): Promise<string[]> {
    const { stdout } = await this.gitIn(worktreePath, `status --porcelain`);
    return stdout.trim().split('\n').filter(Boolean).map(line => line.slice(3));
  }

  /** Get full diff text against base branch */
  async getDiff(worktreePath: string, baseBranch: string = 'main'): Promise<string> {
    const { stdout } = await this.gitIn(worktreePath, `diff ${baseBranch}...HEAD`);
    return stdout;
  }

  /** Merge a branch into main (from main repo root) */
  async mergeBranch(branchName: string): Promise<void> {
    await this.git(`checkout main`);
    await this.git(`merge ${branchName} --no-ff -m "feat: merge ${branchName}"`);
    log.info('Branch merged', { branch: branchName });
  }

  /** Force-delete a branch */
  async deleteBranch(branchName: string): Promise<void> {
    try {
      await this.git(`branch -D ${branchName}`);
      log.info('Branch deleted', { branch: branchName });
    } catch (error) {
      log.warn('Failed to delete branch', { branch: branchName, error: String(error) });
    }
  }

  /** Get the repo root path */
  getRepoRoot(): string {
    return this.repoRoot;
  }

  // ── Internal helpers ─────────────────────────────────────

  private async git(args: string): Promise<{ stdout: string; stderr: string }> {
    return this.execIn(this.repoRoot, `git ${args}`);
  }

  private async gitIn(cwd: string, args: string): Promise<{ stdout: string; stderr: string }> {
    return this.execIn(cwd, `git ${args}`);
  }

  private async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    return execAsync(command, { cwd: this.repoRoot, timeout: 30_000 });
  }

  private async execIn(cwd: string, command: string): Promise<{ stdout: string; stderr: string }> {
    return execAsync(command, { cwd, timeout: 30_000 });
  }
}
