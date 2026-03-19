/**
 * Vitest Test Runner Plugin — Runs tests and reports results
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { TesterPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:vitest');

export class VitestPlugin implements TesterPlugin {
  readonly name = 'vitest';
  readonly type = 'tester' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('npx vitest --version', { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async run(workingDir: string): Promise<PluginResult & {
    passed: number;
    failed: number;
    skipped: number;
    coverage?: number;
  }> {
    log.info('Running Vitest', { workingDir });

    try {
      const { stdout, stderr } = await execAsync(
        'npx vitest run --reporter=json 2>/dev/null || true',
        { cwd: workingDir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      );

      return this.parseOutput(stdout, stderr);
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string };

      if (err.stdout) {
        return this.parseOutput(err.stdout, err.stderr ?? '');
      }

      log.error('Vitest execution failed', { error: String(error) });
      return {
        success: false,
        errors: [{ message: `Vitest failed: ${String(error).slice(0, 200)}`, severity: 'error' }],
        warnings: [],
        passed: 0,
        failed: 0,
        skipped: 0,
      };
    }
  }

  private parseOutput(stdout: string, _stderr: string): PluginResult & {
    passed: number;
    failed: number;
    skipped: number;
    coverage?: number;
  } {
    try {
      // Try to find JSON output
      const jsonStart = stdout.indexOf('{');
      const jsonEnd = stdout.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found');

      const json = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
      const results = json.testResults ?? [];

      let passed = 0;
      let failed = 0;
      let skipped = 0;
      const errors: PluginError[] = [];

      for (const suite of results) {
        for (const test of suite.assertionResults ?? []) {
          if (test.status === 'passed') passed++;
          else if (test.status === 'failed') {
            failed++;
            errors.push({
              file: suite.name,
              message: `${test.fullName}: ${(test.failureMessages ?? []).join('; ').slice(0, 200)}`,
              severity: 'error',
            });
          } else {
            skipped++;
          }
        }
      }

      log.info('Vitest complete', { passed, failed, skipped });

      return {
        success: failed === 0,
        errors,
        warnings: [],
        passed,
        failed,
        skipped,
        metadata: { totalSuites: results.length },
      };
    } catch {
      // Fallback: parse text output for pass/fail counts
      const passMatch = stdout.match(/(\d+)\s+passed/);
      const failMatch = stdout.match(/(\d+)\s+failed/);
      const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
      const failed = failMatch ? parseInt(failMatch[1], 10) : 0;

      return {
        success: failed === 0 && passed > 0,
        errors: failed > 0 ? [{ message: `${failed} tests failed`, severity: 'error' }] : [],
        warnings: passed === 0 ? ['No tests found or executed'] : [],
        passed,
        failed,
        skipped: 0,
      };
    }
  }
}
