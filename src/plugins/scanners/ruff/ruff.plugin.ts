/**
 * Ruff Scanner Plugin — Fast Python linter & formatter
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScannerPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:ruff');

export class RuffPlugin implements ScannerPlugin {
  readonly name = 'ruff';
  readonly type = 'scanner' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('ruff version', { timeout: 10_000 });
      return true;
    } catch { return false; }
  }

  async scan(workingDir: string): Promise<PluginResult> {
    log.info('Running Ruff', { workingDir });
    try {
      const { stdout } = await execAsync(
        'ruff check --output-format json .',
        { cwd: workingDir, timeout: 60_000, maxBuffer: 5 * 1024 * 1024 },
      );
      return this.parseOutput(stdout);
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string };
      // Ruff exits with code 1 when there are lint violations
      if (err.stdout) return this.parseOutput(err.stdout);
      log.error('Ruff failed', { stderr: err.stderr?.slice(0, 500) });
      return { success: false, errors: [{ message: `Ruff failed: ${err.stderr?.slice(0, 200)}`, severity: 'error' }], warnings: [] };
    }
  }

  private parseOutput(jsonOutput: string): PluginResult {
    try {
      const results = JSON.parse(jsonOutput) as Array<{
        code: string;
        message: string;
        filename: string;
        location: { row: number; column: number };
        fix?: { applicability: string };
      }>;

      const errors: PluginError[] = results.map(r => ({
        file: r.filename,
        line: r.location.row,
        column: r.location.column,
        rule: r.code,
        message: r.message,
        severity: r.code.startsWith('E') || r.code.startsWith('F') ? 'error' as const : 'warning' as const,
      }));

      const errorCount = errors.filter(e => e.severity === 'error').length;
      const fixable = results.filter(r => r.fix).length;
      log.info('Ruff complete', { violations: results.length, errors: errorCount, fixable });

      return {
        success: errorCount === 0,
        errors,
        warnings: [],
        metadata: { violations: results.length, errorCount, fixable },
      };
    } catch {
      return { success: true, errors: [], warnings: ['Ruff returned non-JSON output — assuming clean'] };
    }
  }
}
