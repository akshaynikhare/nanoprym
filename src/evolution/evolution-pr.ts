/**
 * Evolution PR Workflow — Creates PRs for self-evolution changes
 *
 * When the LearningEngine detects patterns (5+ signals), this workflow:
 * 1. Extracts rules via RuleExtractor
 * 2. Versions the prompt via PromptVersioner
 * 3. Creates a git branch with the changes
 * 4. Opens a PR for human review
 * 5. Records the evolution in RollbackManager
 *
 * Human approves/rejects via GitHub PR → merge or discard.
 * Rejection feeds back as a signal to LearningEngine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GitManager } from '../git/git.manager.js';
import { RuleExtractor, type ExtractedRule } from './rule.extractor.js';
import { RollbackManager } from '../recovery/rollback.manager.js';
import type { LearnedPattern } from './learning.engine.js';
import { createChildLogger } from '../_shared/logger.js';
import { nowISO } from '../_shared/utils.js';

const log = createChildLogger('evolution-pr');

export interface EvolutionPRResult {
  version: number;
  branch: string;
  prUrl?: string;
  prNumber?: number;
  rules: ExtractedRule[];
  patterns: LearnedPattern[];
}

export interface EvolutionPROptions {
  repoRoot: string;
  rulesDir?: string;        // default: rules/
  promptsDir?: string;      // default: prompts/
  autoPush?: boolean;       // default: true
  autoCreatePR?: boolean;   // default: true
}

export class EvolutionPRWorkflow {
  private gitManager: GitManager;
  private ruleExtractor: RuleExtractor;
  private rollbackManager: RollbackManager;
  private autoPush: boolean;
  private autoCreatePR: boolean;
  private processedPatterns: Set<string> = new Set();

  constructor(options: EvolutionPROptions) {
    this.autoPush = options.autoPush ?? true;
    this.autoCreatePR = options.autoCreatePR ?? true;

    this.gitManager = new GitManager(options.repoRoot);
    this.ruleExtractor = new RuleExtractor();
    this.rollbackManager = new RollbackManager(options.repoRoot);
  }

  /**
   * Process new patterns from the LearningEngine.
   * Only processes patterns not yet handled in this session.
   * Returns null if no actionable patterns found.
   */
  async processPatterns(patterns: LearnedPattern[]): Promise<EvolutionPRResult | null> {
    // Filter to unprocessed patterns with sufficient confidence
    const newPatterns = patterns.filter(p =>
      p.confidence >= 0.5 && !this.processedPatterns.has(p.id)
    );

    if (newPatterns.length === 0) {
      log.info('No new actionable patterns');
      return null;
    }

    // Extract rules from patterns
    const rules = this.ruleExtractor.extract(newPatterns);
    if (rules.length === 0) {
      log.info('No rules extracted from patterns');
      return null;
    }

    log.info('Processing evolution', { patterns: newPatterns.length, rules: rules.length });

    // Determine next version number
    const existingEvolutions = this.rollbackManager.listEvolutions();
    const nextVersion = existingEvolutions.length > 0
      ? Math.max(...existingEvolutions.map(e => e.version)) + 1
      : 1;

    const branchName = `nanoprym/evolution-v${nextVersion}`;
    let worktreePath: string | null = null;

    try {
      // Create worktree for evolution changes
      const worktree = await this.gitManager.createWorktree(`evolution-v${nextVersion}`);
      worktreePath = worktree.path;

      // Write rules to rules file
      const rulesFile = path.join(worktreePath, 'rules', 'learned-rules.json');
      const rulesDir = path.dirname(rulesFile);
      if (!fs.existsSync(rulesDir)) fs.mkdirSync(rulesDir, { recursive: true });
      this.ruleExtractor.writeRules(rules, rulesFile);

      // Update brain files based on rule levels
      const brainChanges = this.applyRulesToBrains(rules, worktreePath);

      // Collect all changed files
      const changedFiles = [
        'rules/learned-rules.json',
        ...brainChanges,
      ];

      // Commit changes
      const description = rules.map(r => r.description).join('; ');
      const commitMsg = `feat(evolution): v${nextVersion} — ${description.slice(0, 100)}`;
      const commitHash = await this.gitManager.commit(worktreePath, changedFiles, commitMsg);

      // Register in rollback manager
      const parentVersion = existingEvolutions.length > 0
        ? existingEvolutions[existingEvolutions.length - 1].version
        : null;

      this.rollbackManager.registerEvolution({
        description: description.slice(0, 200),
        commitHash,
        parentVersion,
        dependsOn: parentVersion ? [parentVersion] : [],
      });

      // Push and create PR
      let prUrl: string | undefined;
      let prNumber: number | undefined;

      if (this.autoPush) {
        try {
          await this.gitManager.push(worktreePath, branchName);

          if (this.autoCreatePR) {
            const prBody = this.buildPRBody(nextVersion, rules, newPatterns);
            const pr = await this.gitManager.createPR({
              worktreePath,
              branch: branchName,
              title: `feat(evolution): v${nextVersion} — self-improvement`,
              body: prBody,
              baseBranch: 'main',
            });
            prUrl = pr.url;
            prNumber = pr.number;

            // Request Copilot review
            await this.gitManager.requestCopilotReview(pr.number);

            log.info('Evolution PR created', { version: nextVersion, prNumber: pr.number, prUrl: pr.url });
          }
        } catch (err) {
          log.warn('Failed to push/create PR (changes committed locally)', { error: String(err) });
        }
      }

      // Mark patterns as processed
      for (const p of newPatterns) {
        this.processedPatterns.add(p.id);
      }

      return {
        version: nextVersion,
        branch: branchName,
        prUrl,
        prNumber,
        rules,
        patterns: newPatterns,
      };
    } catch (err) {
      log.error('Evolution workflow failed', { error: String(err) });

      // Cleanup worktree on failure
      if (worktreePath) {
        try { await this.gitManager.removeWorktree(`evolution-v${nextVersion}`); } catch { /* */ }
      }

      return null;
    }
  }

  /** Check a PR's review status and handle merge/rejection */
  async checkPRStatus(prNumber: number, version: number): Promise<'pending' | 'approved' | 'rejected'> {
    try {
      const reviews = await this.gitManager.getPRReviewComments(prNumber);
      if (reviews.length === 0) return 'pending';

      const lastReview = reviews[reviews.length - 1];
      const state = (lastReview as Record<string, unknown>).state as string | undefined;

      if (state === 'APPROVED') {
        log.info('Evolution PR approved', { prNumber, version });
        return 'approved';
      }

      if (state === 'CHANGES_REQUESTED' || state === 'DISMISSED') {
        log.info('Evolution PR rejected', { prNumber, version, state });
        return 'rejected';
      }

      return 'pending';
    } catch (err) {
      log.warn('Failed to check PR status', { prNumber, error: String(err) });
      return 'pending';
    }
  }

  /** Get all processed pattern IDs */
  getProcessedPatterns(): string[] {
    return [...this.processedPatterns];
  }

  /** Apply extracted rules to brain files in the worktree */
  private applyRulesToBrains(rules: ExtractedRule[], worktreePath: string): string[] {
    const changedFiles: string[] = [];

    // Group rules by target brain level
    const byLevel = new Map<string, ExtractedRule[]>();
    for (const rule of rules) {
      const existing = byLevel.get(rule.appliedTo) ?? [];
      existing.push(rule);
      byLevel.set(rule.appliedTo, existing);
    }

    // Apply to prime brain
    const primeRules = byLevel.get('prime-brain') ?? [];
    if (primeRules.length > 0) {
      const brainPath = path.join(worktreePath, 'prompts', 'prime.brain.md');
      this.appendToBrain(brainPath, primeRules);
      changedFiles.push('prompts/prime.brain.md');
    }

    // Apply to project brain (use the nanoprym project brain if it exists)
    const projectRules = byLevel.get('project-brain') ?? [];
    if (projectRules.length > 0) {
      const nanoprymBrain = path.resolve(process.env.HOME ?? '~', '.nanoprym', 'prime.brain.md');
      if (fs.existsSync(nanoprymBrain)) {
        this.appendToBrain(nanoprymBrain, projectRules);
      }
    }

    // Module-level rules go to the rules file (already handled)
    return changedFiles;
  }

  /** Append rules as a new section to a brain file */
  private appendToBrain(brainPath: string, rules: ExtractedRule[]): void {
    const dir = path.dirname(brainPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let content = '';
    if (fs.existsSync(brainPath)) {
      content = fs.readFileSync(brainPath, 'utf-8');
    }

    const section = [
      '',
      `## Learned Rules (${nowISO().split('T')[0]})`,
      '',
      ...rules.map(r =>
        `- **${r.id}** (confidence: ${(r.confidence * 100).toFixed(0)}%): ${r.description}`
      ),
      '',
    ].join('\n');

    fs.writeFileSync(brainPath, content + section);
    log.info('Brain updated', { path: brainPath, rulesAdded: rules.length });
  }

  /** Build PR body with pattern and rule details */
  private buildPRBody(version: number, rules: ExtractedRule[], patterns: LearnedPattern[]): string {
    const lines = [
      `## Evolution v${version} — Self-Improvement`,
      '',
      '### Patterns Detected',
      '',
      ...patterns.map(p =>
        `- **${p.id}** — ${p.signalCount} signals, ${(p.confidence * 100).toFixed(0)}% confidence (source: ${p.source})`
      ),
      '',
      '### Rules Extracted',
      '',
      ...rules.map(r =>
        `- **${r.id}** → ${r.appliedTo}: ${r.description}`
      ),
      '',
      '### Examples',
      '',
      ...patterns.flatMap(p =>
        p.examples.slice(0, 2).map(ex => `- \`${ex}\``)
      ),
      '',
      '---',
      `Generated by Nanoprym Evolution Engine at ${nowISO()}`,
    ];

    return lines.join('\n');
  }
}
