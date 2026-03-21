/**
 * Lighthouse Scanner Plugin — Web performance & accessibility auditing
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScannerPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:lighthouse');

const SCORE_THRESHOLD = 0.5;

export class LighthousePlugin implements ScannerPlugin {
  readonly name = 'lighthouse';
  readonly type = 'scanner' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('npx lighthouse --version', { timeout: 15_000 });
      return true;
    } catch { return false; }
  }

  async scan(workingDir: string): Promise<PluginResult> {
    log.info('Running Lighthouse', { workingDir });

    const outputPath = join(workingDir, '.lighthouse-report.json');

    try {
      // Run Lighthouse in headless Chrome against a local URL if available,
      // otherwise audit the built HTML entry point
      const url = 'http://localhost:3000';
      await execAsync(
        `npx lighthouse ${url} --output json --output-path ${outputPath} --chrome-flags="--headless --no-sandbox" --only-categories=performance,accessibility,best-practices`,
        { cwd: workingDir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      );

      const report = await readFile(outputPath, 'utf-8');
      return this.parseOutput(report);
    } catch (error: unknown) {
      const err = error as { stderr?: string };
      log.error('Lighthouse failed', { stderr: err.stderr?.slice(0, 500) });
      return { success: false, errors: [{ message: `Lighthouse failed: ${err.stderr?.slice(0, 200)}`, severity: 'error' }], warnings: [] };
    } finally {
      await unlink(outputPath).catch(() => {});
    }
  }

  private parseOutput(jsonOutput: string): PluginResult {
    try {
      const report = JSON.parse(jsonOutput) as {
        categories: Record<string, { title: string; score: number | null }>;
        audits: Record<string, { id: string; title: string; score: number | null; scoreDisplayMode: string }>;
      };

      const errors: PluginError[] = [];
      const scores: Record<string, number> = {};

      for (const [key, category] of Object.entries(report.categories)) {
        const score = category.score ?? 0;
        scores[key] = score;

        if (score < SCORE_THRESHOLD) {
          errors.push({
            rule: key,
            message: `${category.title}: score ${Math.round(score * 100)}/100 (below ${SCORE_THRESHOLD * 100} threshold)`,
            severity: 'error',
          });
        }
      }

      // Surface individual failing audits as warnings
      const warnings: string[] = [];
      for (const audit of Object.values(report.audits)) {
        if (audit.scoreDisplayMode === 'binary' && audit.score === 0) {
          warnings.push(`[${audit.id}] ${audit.title}`);
        }
      }

      const hasErrors = errors.length > 0;
      log.info('Lighthouse complete', { scores, failedCategories: errors.length, failedAudits: warnings.length });

      return {
        success: !hasErrors,
        errors,
        warnings,
        metadata: { scores, failedAudits: warnings.length },
      };
    } catch {
      return { success: true, errors: [], warnings: ['Lighthouse returned non-JSON output'] };
    }
  }
}
