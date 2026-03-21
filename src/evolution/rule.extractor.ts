/**
 * Rule Extractor — Extracts learned rules from patterns
 * Converts patterns into actionable rules for the brain hierarchy.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LearnedPattern } from './learning.engine.js';
import { createChildLogger } from '../_shared/logger.js';
import { nowISO } from '../_shared/utils.js';

const log = createChildLogger('rule-extractor');

export interface ExtractedRule {
  id: string;
  description: string;
  source: string;
  confidence: number;
  examples: string[];
  createdAt: string;
  appliedTo: 'prime-brain' | 'project-brain' | 'module-brain';
}

export class RuleExtractor {
  /** Extract rules from patterns that have reached high confidence */
  extract(patterns: LearnedPattern[]): ExtractedRule[] {
    const rules: ExtractedRule[] = [];

    for (const pattern of patterns) {
      if (pattern.confidence < 0.5) continue;

      const rule: ExtractedRule = {
        id: `RULE-${pattern.id}`,
        description: this.patternToDescription(pattern),
        source: pattern.id,
        confidence: pattern.confidence,
        examples: pattern.examples.slice(0, 3),
        createdAt: nowISO(),
        appliedTo: this.determineLevel(pattern),
      };

      rules.push(rule);
    }

    log.info('Rules extracted', { count: rules.length });
    return rules;
  }

  /** Write rules to a rules file */
  writeRules(rules: ExtractedRule[], outputPath: string): void {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let existing: ExtractedRule[] = [];
    if (fs.existsSync(outputPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      } catch (error) {
        log.warn('Corrupt rules file, resetting', { path: outputPath, error: String(error) });
      }
    }

    // Merge: update existing, add new
    for (const rule of rules) {
      const idx = existing.findIndex(r => r.id === rule.id);
      if (idx >= 0) {
        existing[idx] = rule;
      } else {
        existing.push(rule);
      }
    }

    fs.writeFileSync(outputPath, JSON.stringify(existing, null, 2));
    log.info('Rules written', { path: outputPath, total: existing.length });
  }

  /** Convert a pattern ID to a human-readable description */
  private patternToDescription(pattern: LearnedPattern): string {
    const id = pattern.id;

    if (id.startsWith('error:')) {
      return `Recurring error pattern: ${id.replace('error:', '')}. Seen ${pattern.signalCount} times.`;
    }
    if (id.startsWith('human_correction:')) {
      return `Human frequently corrects ${id.replace('human_correction:', '')} tasks. Review approach.`;
    }
    if (id.startsWith('high_iterations:')) {
      return `${id.replace('high_iterations:', '')} tasks often need >3 iterations. Consider better planning.`;
    }

    return `Learned pattern: ${id} (${pattern.signalCount} signals)`;
  }

  /** Determine which brain level a rule belongs to */
  private determineLevel(pattern: LearnedPattern): ExtractedRule['appliedTo'] {
    if (pattern.source === 'human_correction') return 'prime-brain';
    if (pattern.id.includes(':CRITICAL') || pattern.id.includes(':STANDARD')) return 'project-brain';
    return 'module-brain';
  }
}
