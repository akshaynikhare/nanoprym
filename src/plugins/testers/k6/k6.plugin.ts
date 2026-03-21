/**
 * k6 Tester Plugin — Load and performance testing
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TesterPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:k6');

interface K6Summary {
  metrics: Record<string, {
    type: string;
    contains: string;
    values: Record<string, number>;
    thresholds?: Record<string, { ok: boolean }>;
  }>;
  root_group: {
    name: string;
    checks: { name: string; passes: number; fails: number }[];
    groups: unknown[];
  };
}

export class K6Plugin implements TesterPlugin {
  readonly name = 'k6';
  readonly type = 'tester' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('k6 version', { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async run(workingDir: string): Promise<PluginResult & {
    passed: number;
    failed: number;
    skipped: number;
  }> {
    log.info('Running k6', { workingDir });

    const summaryFile = join(workingDir, '.k6-summary.json');

    try {
      // Find k6 script — convention: k6.js, k6.ts, load-test.js, or script.js in workingDir
      const scriptPath = await this.findScript(workingDir);
      if (!scriptPath) {
        log.warn('No k6 script found', { workingDir });
        return {
          success: true,
          errors: [],
          warnings: ['No k6 test script found (expected k6.js, load-test.js, or script.js)'],
          passed: 0,
          failed: 0,
          skipped: 0,
        };
      }

      const { stdout, stderr } = await execAsync(
        `k6 run --summary-export=${summaryFile} ${scriptPath} 2>&1 || true`,
        { cwd: workingDir, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
      );

      return await this.parseSummary(summaryFile, stdout, stderr);
    } catch (error: unknown) {
      log.error('k6 execution failed', { error: String(error) });
      return {
        success: false,
        errors: [{ message: `k6 failed: ${String(error).slice(0, 200)}`, severity: 'error' }],
        warnings: [],
        passed: 0,
        failed: 0,
        skipped: 0,
      };
    } finally {
      await rm(summaryFile, { force: true }).catch(() => {});
    }
  }

  private async findScript(workingDir: string): Promise<string | null> {
    const candidates = ['k6.js', 'k6.ts', 'load-test.js', 'load-test.ts', 'script.js', 'script.ts'];
    for (const name of candidates) {
      try {
        await readFile(join(workingDir, name));
        return name;
      } catch { /* not found, try next */ }
    }
    return null;
  }

  private async parseSummary(
    summaryFile: string,
    stdout: string,
    _stderr: string,
  ): Promise<PluginResult & { passed: number; failed: number; skipped: number }> {
    try {
      const raw = await readFile(summaryFile, 'utf-8');
      const summary: K6Summary = JSON.parse(raw);

      let passed = 0;
      let failed = 0;
      const errors: PluginError[] = [];

      // Count check results
      const checks = summary.root_group?.checks ?? [];
      for (const check of checks) {
        if (check.fails === 0 && check.passes > 0) {
          passed++;
        } else if (check.fails > 0) {
          failed++;
          errors.push({
            rule: 'k6-check',
            message: `Check "${check.name}": ${check.fails} failures out of ${check.passes + check.fails}`,
            severity: 'error',
          });
        }
      }

      // Count threshold results
      const thresholdErrors = this.evaluateThresholds(summary);
      failed += thresholdErrors.length;
      errors.push(...thresholdErrors);

      // Extract key metrics for metadata
      const httpReqDuration = summary.metrics?.http_req_duration?.values;
      const iterations = summary.metrics?.iterations?.values;

      log.info('k6 complete', { passed, failed, checks: checks.length });

      return {
        success: failed === 0,
        errors,
        warnings: checks.length === 0 ? ['No k6 checks defined in script'] : [],
        passed,
        failed,
        skipped: 0,
        metadata: {
          totalChecks: checks.length,
          p95Duration: httpReqDuration?.['p(95)'],
          medianDuration: httpReqDuration?.['p(50)'],
          avgDuration: httpReqDuration?.avg,
          iterations: iterations?.count,
          rps: iterations?.rate,
        },
      };
    } catch {
      return this.parseFallback(stdout);
    }
  }

  private evaluateThresholds(summary: K6Summary): PluginError[] {
    const errors: PluginError[] = [];
    for (const [metricName, metric] of Object.entries(summary.metrics ?? {})) {
      if (!metric.thresholds) continue;
      for (const [threshold, result] of Object.entries(metric.thresholds)) {
        if (!result.ok) {
          errors.push({
            rule: 'k6-threshold',
            message: `Threshold failed: ${metricName} — ${threshold}`,
            severity: 'error',
          });
        }
      }
    }
    return errors;
  }

  private parseFallback(stdout: string): PluginResult & {
    passed: number;
    failed: number;
    skipped: number;
  } {
    // k6 text output: "✓ check name" / "✗ check name"
    const passCount = (stdout.match(/✓/g) ?? []).length;
    const failCount = (stdout.match(/✗/g) ?? []).length;

    return {
      success: failCount === 0,
      errors: failCount > 0 ? [{ message: `${failCount} k6 check(s) failed`, severity: 'error' }] : [],
      warnings: passCount === 0 && failCount === 0 ? ['Could not parse k6 output'] : [],
      passed: passCount,
      failed: failCount,
      skipped: 0,
    };
  }
}
