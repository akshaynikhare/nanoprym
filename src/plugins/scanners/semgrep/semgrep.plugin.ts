/**
 * Semgrep Scanner Plugin — Static analysis for security patterns
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScannerPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:semgrep');

export class SemgrepPlugin implements ScannerPlugin {
  readonly name = 'semgrep';
  readonly type = 'scanner' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('semgrep --version', { timeout: 10_000 });
      return true;
    } catch { return false; }
  }

  async scan(workingDir: string): Promise<PluginResult> {
    log.info('Running Semgrep', { workingDir });
    try {
      const { stdout } = await execAsync(
        'semgrep scan --config auto --json --quiet',
        { cwd: workingDir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      );
      return this.parseOutput(stdout);
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string };
      if (err.stdout) return this.parseOutput(err.stdout);
      log.error('Semgrep failed', { stderr: err.stderr?.slice(0, 500) });
      return { success: false, errors: [{ message: `Semgrep failed: ${err.stderr?.slice(0, 200)}`, severity: 'error' }], warnings: [] };
    }
  }

  private parseOutput(jsonOutput: string): PluginResult {
    try {
      const data = JSON.parse(jsonOutput) as { results?: Array<{ path: string; start: { line: number; col: number }; check_id: string; extra: { message: string; severity: string } }> };
      const errors: PluginError[] = (data.results ?? []).map(r => ({
        file: r.path,
        line: r.start.line,
        column: r.start.col,
        rule: r.check_id,
        message: r.extra.message,
        severity: r.extra.severity === 'ERROR' ? 'error' as const : 'warning' as const,
      }));
      const errorCount = errors.filter(e => e.severity === 'error').length;
      log.info('Semgrep complete', { findings: errors.length, errors: errorCount });
      return { success: errorCount === 0, errors, warnings: [], metadata: { findings: errors.length } };
    } catch {
      return { success: true, errors: [], warnings: ['Semgrep returned non-JSON output'] };
    }
  }
}
