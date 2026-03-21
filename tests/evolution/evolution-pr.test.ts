/**
 * EvolutionPRWorkflow Tests
 * Tests pattern processing, rule extraction, brain updates, PR creation, dedup
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvolutionPRWorkflow } from '../../src/evolution/evolution-pr.js';
import type { LearnedPattern } from '../../src/evolution/learning.engine.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Mock GitManager
const mockGitManager = {
  createWorktree: vi.fn().mockResolvedValue({ path: '/tmp/worktree-test', branch: 'evolution-v1' }),
  commit: vi.fn().mockResolvedValue('abc123'),
  push: vi.fn().mockResolvedValue(undefined),
  createPR: vi.fn().mockResolvedValue({ url: 'https://github.com/test/pr/1', number: 1 }),
  requestCopilotReview: vi.fn().mockResolvedValue(undefined),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
  getPRReviewComments: vi.fn().mockResolvedValue([]),
};

vi.mock('../../src/git/git.manager.js', () => ({
  GitManager: vi.fn().mockImplementation(() => mockGitManager),
}));

// Mock RollbackManager
const mockRollbackManager = {
  listEvolutions: vi.fn().mockReturnValue([]),
  registerEvolution: vi.fn().mockReturnValue({ version: 1 }),
};

vi.mock('../../src/recovery/rollback.manager.js', () => ({
  RollbackManager: vi.fn().mockImplementation(() => mockRollbackManager),
}));

function makePattern(overrides: Partial<LearnedPattern> = {}): LearnedPattern {
  return {
    id: 'error:null-check',
    pattern: 'Recurring null check failures',
    signalCount: 6,
    confidence: 0.7,
    source: 'outcome',
    examples: ['src/auth.ts: null ref', 'src/api.ts: null ref', 'src/db.ts: null ref'],
    createdAt: '2026-03-01T00:00:00Z',
    lastSeenAt: '2026-03-20T00:00:00Z',
    ...overrides,
  };
}

describe('EvolutionPRWorkflow', () => {
  let workflow: EvolutionPRWorkflow;
  let worktreeDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    worktreeDir = path.join(os.tmpdir(), `evo-test-${Date.now()}`);
    fs.mkdirSync(worktreeDir, { recursive: true });

    // Make createWorktree return our temp dir
    mockGitManager.createWorktree.mockResolvedValue({ path: worktreeDir, branch: 'evolution-v1' });
    mockRollbackManager.listEvolutions.mockReturnValue([]);

    workflow = new EvolutionPRWorkflow({ repoRoot: worktreeDir });
  });

  it('should return null when no actionable patterns', async () => {
    const result = await workflow.processPatterns([]);
    expect(result).toBeNull();
  });

  it('should skip patterns with low confidence', async () => {
    const result = await workflow.processPatterns([
      makePattern({ confidence: 0.3 }),
    ]);
    expect(result).toBeNull();
  });

  it('should process patterns and create an evolution PR', async () => {
    const patterns = [makePattern()];
    const result = await workflow.processPatterns(patterns);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.branch).toBe('nanoprym/evolution-v1');
    expect(result!.rules).toHaveLength(1);
    expect(result!.rules[0].id).toBe('RULE-error:null-check');
    expect(result!.prUrl).toBe('https://github.com/test/pr/1');
    expect(result!.prNumber).toBe(1);
  });

  it('should not process the same pattern twice', async () => {
    const patterns = [makePattern()];

    const r1 = await workflow.processPatterns(patterns);
    expect(r1).not.toBeNull();

    const r2 = await workflow.processPatterns(patterns);
    expect(r2).toBeNull(); // already processed
  });

  it('should track processed pattern IDs', async () => {
    await workflow.processPatterns([makePattern({ id: 'error:type-mismatch' })]);
    const processed = workflow.getProcessedPatterns();
    expect(processed).toContain('error:type-mismatch');
  });

  it('should write rules to learned-rules.json in worktree', async () => {
    await workflow.processPatterns([makePattern()]);

    // Verify the rules file was created
    const rulesFile = path.join(worktreeDir, 'rules', 'learned-rules.json');
    expect(fs.existsSync(rulesFile)).toBe(true);

    const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('RULE-error:null-check');
  });

  it('should commit with conventional commit message', async () => {
    await workflow.processPatterns([makePattern()]);

    expect(mockGitManager.commit).toHaveBeenCalledWith(
      worktreeDir,
      expect.arrayContaining(['rules/learned-rules.json']),
      expect.stringContaining('feat(evolution): v1'),
    );
  });

  it('should register evolution in RollbackManager', async () => {
    await workflow.processPatterns([makePattern()]);

    expect(mockRollbackManager.registerEvolution).toHaveBeenCalledWith(
      expect.objectContaining({
        commitHash: 'abc123',
        parentVersion: null,
        dependsOn: [],
      }),
    );
  });

  it('should push and create PR when autoPush is true', async () => {
    await workflow.processPatterns([makePattern()]);

    expect(mockGitManager.push).toHaveBeenCalledWith(worktreeDir, 'nanoprym/evolution-v1');
    expect(mockGitManager.createPR).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'nanoprym/evolution-v1',
        baseBranch: 'main',
      }),
    );
    expect(mockGitManager.requestCopilotReview).toHaveBeenCalledWith(1);
  });

  it('should skip push/PR when autoPush is false', async () => {
    workflow = new EvolutionPRWorkflow({ repoRoot: worktreeDir, autoPush: false });
    mockGitManager.createWorktree.mockResolvedValue({ path: worktreeDir, branch: 'evolution-v1' });

    await workflow.processPatterns([makePattern()]);

    expect(mockGitManager.push).not.toHaveBeenCalled();
    expect(mockGitManager.createPR).not.toHaveBeenCalled();
  });

  it('should handle push failure gracefully', async () => {
    mockGitManager.push.mockRejectedValueOnce(new Error('push failed'));

    const result = await workflow.processPatterns([makePattern()]);

    // Should still succeed — changes committed locally
    expect(result).not.toBeNull();
    expect(result!.prUrl).toBeUndefined();
  });

  it('should increment version from existing evolutions', async () => {
    mockRollbackManager.listEvolutions.mockReturnValue([
      { version: 1, status: 'active' },
      { version: 2, status: 'active' },
    ]);

    const result = await workflow.processPatterns([makePattern()]);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(3);
    expect(result!.branch).toBe('nanoprym/evolution-v3');
  });

  it('should handle multiple patterns in a single evolution', async () => {
    const patterns = [
      makePattern({ id: 'error:null-check', confidence: 0.7 }),
      makePattern({ id: 'high_iterations:deploy', confidence: 0.6 }),
    ];

    const result = await workflow.processPatterns(patterns);

    expect(result).not.toBeNull();
    expect(result!.rules).toHaveLength(2);
    expect(result!.patterns).toHaveLength(2);
  });

  describe('checkPRStatus', () => {
    it('should return pending when no reviews', async () => {
      mockGitManager.getPRReviewComments.mockResolvedValue([]);
      const status = await workflow.checkPRStatus(1, 1);
      expect(status).toBe('pending');
    });

    it('should return approved when last review is APPROVED', async () => {
      mockGitManager.getPRReviewComments.mockResolvedValue([
        { state: 'APPROVED', user: 'reviewer' },
      ]);
      const status = await workflow.checkPRStatus(1, 1);
      expect(status).toBe('approved');
    });

    it('should return rejected when last review is CHANGES_REQUESTED', async () => {
      mockGitManager.getPRReviewComments.mockResolvedValue([
        { state: 'CHANGES_REQUESTED', user: 'reviewer' },
      ]);
      const status = await workflow.checkPRStatus(1, 1);
      expect(status).toBe('rejected');
    });

    it('should return pending on API error', async () => {
      mockGitManager.getPRReviewComments.mockRejectedValue(new Error('API down'));
      const status = await workflow.checkPRStatus(1, 1);
      expect(status).toBe('pending');
    });
  });

  describe('brain updates', () => {
    it('should update prime brain for human_correction patterns', async () => {
      const pattern = makePattern({
        id: 'human_correction:auth-flow',
        source: 'human_correction',
        confidence: 0.8,
      });

      await workflow.processPatterns([pattern]);

      // Check that commit includes prompts/prime.brain.md
      const commitCall = mockGitManager.commit.mock.calls[0];
      const changedFiles: string[] = commitCall[1];
      expect(changedFiles).toContain('prompts/prime.brain.md');

      // Verify brain file was created
      const brainPath = path.join(worktreeDir, 'prompts', 'prime.brain.md');
      expect(fs.existsSync(brainPath)).toBe(true);

      const content = fs.readFileSync(brainPath, 'utf-8');
      expect(content).toContain('Learned Rules');
      expect(content).toContain('RULE-human_correction:auth-flow');
    });
  });
});
