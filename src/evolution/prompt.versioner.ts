/**
 * Prompt Versioner — Manages prompt versions with scoring
 *
 * Each prompt version is scored based on outcomes.
 * Auto-revert if new version performs worse after 25 tasks.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRole } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';
import { nowISO } from '../_shared/utils.js';

const log = createChildLogger('prompt-versioner');

const PROMPTS_DIR = path.resolve(process.cwd(), 'prompts');
const AUTO_REVERT_THRESHOLD = 25;

export interface PromptVersion {
  role: AgentRole;
  version: string;
  filePath: string;
  active: boolean;
  tasksRun: number;
  successRate: number;
  avgIterations: number;
  humanCorrections: number;
  createdAt: string;
  activatedAt?: string;
}

export class PromptVersioner {
  private versions: Map<string, PromptVersion[]> = new Map();

  constructor() {
    this.loadVersions();
  }

  /** Record a task outcome for the active prompt version */
  recordOutcome(role: AgentRole, success: boolean, iterations: number, humanCorrections: number): void {
    const versions = this.versions.get(role) ?? [];
    const active = versions.find(v => v.active);
    if (!active) return;

    active.tasksRun++;
    const totalSuccesses = active.successRate * (active.tasksRun - 1) + (success ? 1 : 0);
    active.successRate = totalSuccesses / active.tasksRun;
    active.avgIterations = ((active.avgIterations * (active.tasksRun - 1)) + iterations) / active.tasksRun;
    active.humanCorrections += humanCorrections;

    // Check for auto-revert
    if (active.tasksRun >= AUTO_REVERT_THRESHOLD) {
      const previous = versions.filter(v => !v.active && v.tasksRun >= AUTO_REVERT_THRESHOLD);
      if (previous.length > 0) {
        const best = previous.reduce((a, b) => a.successRate > b.successRate ? a : b);
        if (best.successRate > active.successRate + 0.05) {
          log.warn('Auto-reverting prompt', {
            role,
            current: active.version,
            revertTo: best.version,
            currentRate: active.successRate,
            previousRate: best.successRate,
          });
          this.activate(role, best.version);
        }
      }
    }

    this.saveScores(role);
  }

  /** Get the active version for a role */
  getActive(role: AgentRole): PromptVersion | undefined {
    return (this.versions.get(role) ?? []).find(v => v.active);
  }

  /** List all versions for a role */
  listVersions(role: AgentRole): PromptVersion[] {
    return this.versions.get(role) ?? [];
  }

  /** Activate a specific version */
  activate(role: AgentRole, version: string): void {
    const versions = this.versions.get(role) ?? [];
    for (const v of versions) {
      v.active = v.version === version;
      if (v.active) v.activatedAt = nowISO();
    }
    this.saveScores(role);
    log.info('Prompt activated', { role, version });
  }

  /** Load versions from disk */
  private loadVersions(): void {
    const roles: AgentRole[] = ['planner', 'builder', 'reviewer', 'validator'];

    for (const role of roles) {
      const roleDir = path.join(PROMPTS_DIR, role);
      if (!fs.existsSync(roleDir)) continue;

      const files = fs.readdirSync(roleDir).filter(f => f.endsWith('.system.md')).sort();
      const scoresPath = path.join(roleDir, 'scores.json');
      let savedScores: Record<string, Partial<PromptVersion>> = {};
      if (fs.existsSync(scoresPath)) {
        try {
          savedScores = JSON.parse(fs.readFileSync(scoresPath, 'utf-8'));
        } catch (error) {
          log.warn('Corrupt scores.json, resetting', { role, path: scoresPath, error: String(error) });
        }
      }

      const versions: PromptVersion[] = files.map((file, index) => {
        const version = file.replace('.system.md', '');
        const saved = savedScores[version] ?? {};
        return {
          role,
          version,
          filePath: path.join(roleDir, file),
          active: saved.active ?? (index === files.length - 1), // Latest is active by default
          tasksRun: saved.tasksRun ?? 0,
          successRate: saved.successRate ?? 0,
          avgIterations: saved.avgIterations ?? 0,
          humanCorrections: saved.humanCorrections ?? 0,
          createdAt: saved.createdAt ?? nowISO(),
          activatedAt: saved.activatedAt,
        };
      });

      this.versions.set(role, versions);
    }

    log.info('Prompt versions loaded', {
      roles: Array.from(this.versions.keys()),
      counts: Object.fromEntries(Array.from(this.versions.entries()).map(([k, v]) => [k, v.length])),
    });
  }

  /** Save scores to disk */
  private saveScores(role: AgentRole): void {
    const versions = this.versions.get(role) ?? [];
    const roleDir = path.join(PROMPTS_DIR, role);
    const scoresPath = path.join(roleDir, 'scores.json');

    const scores: Record<string, Partial<PromptVersion>> = {};
    for (const v of versions) {
      scores[v.version] = {
        active: v.active,
        tasksRun: v.tasksRun,
        successRate: v.successRate,
        avgIterations: v.avgIterations,
        humanCorrections: v.humanCorrections,
        createdAt: v.createdAt,
        activatedAt: v.activatedAt,
      };
    }

    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2));
  }
}
