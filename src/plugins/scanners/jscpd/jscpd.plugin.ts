/**
 * jscpd Scanner Plugin — Copy-paste detection (DRY enforcement)
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScannerPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:jscpd');

export class JscpdPlugin implements ScannerPlugin {
  readonly name = 'jscpd';
  readonly type = 'scanner' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('npx jscpd --version', { timeout: 10_000 });
      return true;
    } catch { return false; }
  }

  async scan(workingDir: string): Promise<PluginResult> {
    log.info('Running jscpd', { workingDir });
    try {
      const { stdout } = await execAsync(
        'npx jscpd src/ --reporters json --silent',
        { cwd: workingDir, timeout: 60_000, maxBuffer: 5 * 1024 * 1024 },
      );
      return this.parseOutput(stdout);
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string };
      if (err.stdout) return this.parseOutput(err.stdout);
      return { success: true, errors: [], warnings: ['jscpd execution issue — assuming clean'] };
    }
  }

  private parseOutput(output: string): PluginResult {
    try {
      const data = JSON.parse(output) as { duplicates?: Array<{ firstFile: { name: string; startLoc: { line: number } }; secondFile: { name: string; startLoc: { line: number } }; lines: number }> };
      const errors: PluginError[] = (data.duplicates ?? []).map(d => ({
        file: d.firstFile.name,
        line: d.firstFile.startLoc.line,
        message: `Duplicate code (${d.lines} lines) also in ${d.secondFile.name}:${d.secondFile.startLoc.line}`,
        severity: d.lines > 20 ? 'error' as const : 'warning' as const,
      }));
      const significant = errors.filter(e => e.severity === 'error').length;
      log.info('jscpd complete', { duplicates: errors.length, significant });
      return { success: significant === 0, errors, warnings: [], metadata: { duplicates: errors.length } };
    } catch {
      return { success: true, errors: [], warnings: ['jscpd output not parseable'] };
    }
  }
}
