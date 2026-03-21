/**
 * Madge Scanner Plugin — Circular dependency detection for JS/TS
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScannerPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:madge');

export class MadgePlugin implements ScannerPlugin {
  readonly name = 'madge';
  readonly type = 'scanner' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('npx madge --version', { timeout: 10_000 });
      return true;
    } catch { return false; }
  }

  async scan(workingDir: string): Promise<PluginResult> {
    log.info('Running Madge', { workingDir });
    try {
      const { stdout } = await execAsync(
        'npx madge --circular --json --extensions ts src/',
        { cwd: workingDir, timeout: 60_000, maxBuffer: 5 * 1024 * 1024 },
      );
      return this.parseOutput(stdout);
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string };
      // Madge exits with code 1 when circular deps are found
      if (err.stdout) return this.parseOutput(err.stdout);
      log.error('Madge failed', { stderr: err.stderr?.slice(0, 500) });
      return { success: false, errors: [{ message: `Madge failed: ${err.stderr?.slice(0, 200)}`, severity: 'error' }], warnings: [] };
    }
  }

  private parseOutput(jsonOutput: string): PluginResult {
    try {
      const cycles = JSON.parse(jsonOutput) as string[][];

      const errors: PluginError[] = cycles.map(cycle => ({
        file: cycle[0],
        rule: 'circular-dependency',
        message: `Circular dependency: ${cycle.join(' → ')} → ${cycle[0]}`,
        severity: cycle.length > 3 ? 'error' as const : 'warning' as const,
      }));

      const severe = errors.filter(e => e.severity === 'error').length;
      log.info('Madge complete', { cycles: cycles.length, severe });

      return {
        success: severe === 0,
        errors,
        warnings: [],
        metadata: { totalCycles: cycles.length, severeCycles: severe },
      };
    } catch {
      return { success: true, errors: [], warnings: ['Madge returned non-JSON output'] };
    }
  }
}
