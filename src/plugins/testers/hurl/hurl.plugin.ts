/**
 * Hurl Tester Plugin — HTTP API integration tests
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TesterPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:hurl');

interface HurlEntryResult {
  filename: string;
  entries: { request: { method: string; url: string }; response?: { status: number } }[];
  success: boolean;
  time: number;
}

export class HurlPlugin implements TesterPlugin {
  readonly name = 'hurl';
  readonly type = 'tester' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('hurl --version', { timeout: 10_000 });
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
    log.info('Running Hurl', { workingDir });

    let reportDir: string | undefined;
    try {
      reportDir = await mkdtemp(join(tmpdir(), 'hurl-report-'));

      const { stdout, stderr } = await execAsync(
        `hurl --test --report-json ${reportDir} --glob "**/*.hurl" 2>&1 || true`,
        { cwd: workingDir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      );

      return await this.parseReport(reportDir, stdout, stderr);
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string };

      if (reportDir) {
        try {
          return await this.parseReport(reportDir, err.stdout ?? '', err.stderr ?? '');
        } catch { /* fall through */ }
      }

      log.error('Hurl execution failed', { error: String(error) });
      return {
        success: false,
        errors: [{ message: `Hurl failed: ${String(error).slice(0, 200)}`, severity: 'error' }],
        warnings: [],
        passed: 0,
        failed: 0,
        skipped: 0,
      };
    } finally {
      if (reportDir) {
        await rm(reportDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private async parseReport(
    reportDir: string,
    stdout: string,
    _stderr: string,
  ): Promise<PluginResult & { passed: number; failed: number; skipped: number }> {
    try {
      const raw = await readFile(join(reportDir, 'report.json'), 'utf-8');
      const entries: HurlEntryResult[] = JSON.parse(raw);

      let passed = 0;
      let failed = 0;
      const errors: PluginError[] = [];

      for (const entry of entries) {
        if (entry.success) {
          passed++;
        } else {
          failed++;
          errors.push({
            file: entry.filename,
            message: `${entry.filename}: ${entry.entries.length} request(s) — failed`,
            severity: 'error',
          });
        }
      }

      log.info('Hurl complete', { passed, failed, totalFiles: entries.length });

      return {
        success: failed === 0,
        errors,
        warnings: entries.length === 0 ? ['No .hurl files found'] : [],
        passed,
        failed,
        skipped: 0,
        metadata: { totalFiles: entries.length, reportDir },
      };
    } catch {
      return this.parseFallback(stdout);
    }
  }

  private parseFallback(stdout: string): PluginResult & {
    passed: number;
    failed: number;
    skipped: number;
  } {
    // Hurl --test text output: "filename.hurl: Success" or "filename.hurl: Failure"
    const successCount = (stdout.match(/:\s*Success/gi) ?? []).length;
    const failureCount = (stdout.match(/:\s*Failure/gi) ?? []).length;

    return {
      success: failureCount === 0 && successCount > 0,
      errors: failureCount > 0 ? [{ message: `${failureCount} Hurl file(s) failed`, severity: 'error' }] : [],
      warnings: successCount === 0 && failureCount === 0 ? ['No Hurl test results found'] : [],
      passed: successCount,
      failed: failureCount,
      skipped: 0,
    };
  }
}
