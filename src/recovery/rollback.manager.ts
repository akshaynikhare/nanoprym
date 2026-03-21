/**
 * Rollback Manager — Dependency-aware rollback with cascade detection
 *
 * Every evolution gets a git tag (nanoprym-evolution-v{N}).
 * On rollback:
 * 1. Detect downstream evolutions that depend on the target version
 * 2. Slack ping with cascade warning
 * 3. Human decides: rollback all, manual fix, or cancel
 * 4. Execute git revert, audit full cascade
 * 5. Add rule: "v{N} approach failed"
 */
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { EventBus } from '../core/event-bus.js';
import { createChildLogger } from '../_shared/logger.js';
import { nowISO } from '../_shared/utils.js';

const execAsync = promisify(exec);
const log = createChildLogger('rollback-manager');

const EVOLUTION_TAG_PREFIX = 'nanoprym-evolution-v';
const REGISTRY_FILENAME = 'evolution-registry.json';

// ── Types ──────────────────────────────────────────────────

export interface EvolutionRecord {
  version: number;
  description: string;
  commitHash: string;
  parentVersion: number | null;
  dependsOn: number[];
  gitTag: string;
  status: 'active' | 'rolled_back';
  createdAt: string;
  rolledBackAt?: string;
}

export interface CascadeResult {
  target: number;
  affected: number[];
  chain: number[][];
}

export type RollbackDecision = 'rollback_all' | 'manual_fix' | 'cancel';

export interface RollbackResult {
  success: boolean;
  version: number;
  decision: RollbackDecision;
  rolledBack: number[];
  ruleAdded?: string;
  error?: string;
}

// ── Manager ────────────────────────────────────────────────

export class RollbackManager {
  private repoRoot: string;
  private registryPath: string;
  private registry: EvolutionRecord[] = [];
  private bus: EventBus | null;

  constructor(repoRoot: string, bus?: EventBus) {
    this.repoRoot = repoRoot;
    this.registryPath = path.join(repoRoot, '.nanoprym', REGISTRY_FILENAME);
    this.bus = bus ?? null;
    this.loadRegistry();
  }

  // ── Evolution Tracking ─────────────────────────────────

  /** Register a new evolution version */
  registerEvolution(opts: {
    description: string;
    commitHash: string;
    parentVersion?: number | null;
    dependsOn?: number[];
  }): EvolutionRecord {
    const version = this.nextVersion();
    const gitTag = `${EVOLUTION_TAG_PREFIX}${version}`;

    const record: EvolutionRecord = {
      version,
      description: opts.description,
      commitHash: opts.commitHash,
      parentVersion: opts.parentVersion ?? null,
      dependsOn: opts.dependsOn ?? [],
      gitTag,
      status: 'active',
      createdAt: nowISO(),
    };

    this.registry.push(record);
    this.saveRegistry();

    log.info('Evolution registered', { version, tag: gitTag, description: opts.description.slice(0, 80) });
    return record;
  }

  /** Create a git tag for the evolution */
  async tagEvolution(version: number): Promise<void> {
    const record = this.getVersion(version);
    if (!record) throw new Error(`Evolution v${version} not found`);

    await this.git(`tag ${record.gitTag} ${record.commitHash}`);
    log.info('Git tag created', { tag: record.gitTag, commit: record.commitHash });
  }

  // ── Cascade Detection ──────────────────────────────────

  /** Detect all downstream evolutions that depend on a given version */
  detectCascade(version: number): CascadeResult {
    const affected = new Set<number>();
    const chains: number[][] = [];

    const walk = (v: number, chain: number[]): void => {
      const dependents = this.registry.filter(
        r => r.status === 'active' && (r.dependsOn.includes(v) || r.parentVersion === v)
      );

      for (const dep of dependents) {
        if (affected.has(dep.version)) continue;
        affected.add(dep.version);
        const currentChain = [...chain, dep.version];
        chains.push(currentChain);
        walk(dep.version, currentChain);
      }
    };

    walk(version, [version]);

    const result: CascadeResult = {
      target: version,
      affected: Array.from(affected).sort((a, b) => a - b),
      chain: chains,
    };

    if (result.affected.length > 0) {
      log.warn('Cascade detected', { target: version, affected: result.affected });
    }

    return result;
  }

  // ── Rollback Execution ─────────────────────────────────

  /** Execute a rollback with cascade awareness */
  async rollback(version: number, decision: RollbackDecision): Promise<RollbackResult> {
    const record = this.getVersion(version);
    if (!record) {
      return { success: false, version, decision, rolledBack: [], error: `Evolution v${version} not found` };
    }

    if (record.status === 'rolled_back') {
      return { success: false, version, decision, rolledBack: [], error: `Evolution v${version} already rolled back` };
    }

    const cascade = this.detectCascade(version);

    // Publish cascade warning event
    this.publishCascadeWarning(version, cascade);

    if (decision === 'cancel') {
      log.info('Rollback cancelled by human', { version });
      return { success: true, version, decision, rolledBack: [] };
    }

    const toRollback: number[] = [version];

    if (decision === 'rollback_all') {
      // Roll back in reverse order (newest first)
      toRollback.push(...cascade.affected.sort((a, b) => b - a));
    }

    // Execute git reverts
    const rolledBack: number[] = [];
    for (const v of toRollback) {
      const rec = this.getVersion(v);
      if (!rec || rec.status === 'rolled_back') continue;

      try {
        await this.git(`revert --no-commit ${rec.commitHash}`);
        rec.status = 'rolled_back';
        rec.rolledBackAt = nowISO();
        rolledBack.push(v);
        log.info('Evolution reverted', { version: v, commit: rec.commitHash });
      } catch (error) {
        log.error('Revert failed', { version: v, error: String(error) });
        // Abort the partial revert
        try { await this.git('revert --abort'); } catch { /* already clean */ }
        this.saveRegistry();
        return {
          success: false, version, decision, rolledBack,
          error: `Revert of v${v} failed: ${String(error)}`,
        };
      }
    }

    // Commit the combined revert
    if (rolledBack.length > 0) {
      const msg = rolledBack.length === 1
        ? `revert: rollback evolution v${version}`
        : `revert: rollback evolution v${version} + ${rolledBack.length - 1} cascade`;
      try {
        await this.git(`commit -m "${msg}"`);
      } catch {
        // Nothing staged — reverts were no-ops
        log.warn('Nothing to commit after revert', { version });
      }
    }

    this.saveRegistry();

    // Add a "failed approach" rule
    const ruleId = this.addFailedApproachRule(version, record.description);

    // Audit the full cascade
    this.publishRollbackAudit(version, decision, rolledBack, cascade);

    log.info('Rollback complete', { version, decision, rolledBack, ruleId });

    return { success: true, version, decision, rolledBack, ruleAdded: ruleId };
  }

  // ── Queries ────────────────────────────────────────────

  getVersion(version: number): EvolutionRecord | undefined {
    return this.registry.find(r => r.version === version);
  }

  listEvolutions(filter?: { status?: 'active' | 'rolled_back' }): EvolutionRecord[] {
    if (!filter?.status) return [...this.registry];
    return this.registry.filter(r => r.status === filter.status);
  }

  nextVersion(): number {
    if (this.registry.length === 0) return 1;
    return Math.max(...this.registry.map(r => r.version)) + 1;
  }

  // ── Internal ───────────────────────────────────────────

  private addFailedApproachRule(version: number, description: string): string {
    const rulesPath = path.join(this.repoRoot, 'rules', 'rollback-rules.json');
    const dir = path.dirname(rulesPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let rules: Array<{ id: string; rule: string; createdAt: string }> = [];
    if (fs.existsSync(rulesPath)) {
      try { rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')); } catch { /* reset */ }
    }

    const ruleId = `ROLLBACK-v${version}`;
    rules.push({
      id: ruleId,
      rule: `v${version} approach failed: ${description}. Do not retry this approach.`,
      createdAt: nowISO(),
    });

    fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));
    log.info('Failed approach rule added', { ruleId });
    return ruleId;
  }

  private publishCascadeWarning(version: number, cascade: CascadeResult): void {
    if (!this.bus) return;
    if (cascade.affected.length === 0) return;

    this.bus.publish({
      taskId: `rollback-v${version}`,
      topic: 'HUMAN_DECISION',
      sender: 'rollback-manager',
      content: {
        text: `Cascade warning: rolling back v${version} affects ${cascade.affected.length} downstream evolution(s): ${cascade.affected.map(v => `v${v}`).join(', ')}`,
        data: {
          type: 'rollback_cascade_warning',
          targetVersion: version,
          affectedVersions: cascade.affected,
          chains: cascade.chain,
        },
      },
    });
  }

  private publishRollbackAudit(
    version: number,
    decision: RollbackDecision,
    rolledBack: number[],
    cascade: CascadeResult,
  ): void {
    if (!this.bus) return;

    this.bus.publish({
      taskId: `rollback-v${version}`,
      topic: 'CLUSTER_COMPLETE',
      sender: 'rollback-manager',
      content: {
        text: `Rollback of v${version} complete. Decision: ${decision}. Rolled back: ${rolledBack.map(v => `v${v}`).join(', ') || 'none'}`,
        data: {
          type: 'rollback_complete',
          targetVersion: version,
          decision,
          rolledBack,
          cascadeAffected: cascade.affected,
          cascadeChains: cascade.chain,
        },
      },
    });
  }

  private loadRegistry(): void {
    if (!fs.existsSync(this.registryPath)) {
      this.registry = [];
      return;
    }

    try {
      this.registry = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8'));
      log.info('Evolution registry loaded', { count: this.registry.length });
    } catch (error) {
      log.warn('Corrupt evolution registry, resetting', { error: String(error) });
      this.registry = [];
    }
  }

  private saveRegistry(): void {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
  }

  private async git(args: string): Promise<{ stdout: string; stderr: string }> {
    return execAsync(`git ${args}`, { cwd: this.repoRoot, timeout: 30_000 });
  }
}
