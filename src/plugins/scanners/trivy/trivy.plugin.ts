/**
 * Trivy Scanner Plugin — Dependency vulnerability scanning
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScannerPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:trivy');

export class TrivyPlugin implements ScannerPlugin {
  readonly name = 'trivy';
  readonly type = 'scanner' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('trivy --version', { timeout: 10_000 });
      return true;
    } catch { return false; }
  }

  async scan(workingDir: string): Promise<PluginResult> {
    log.info('Running Trivy', { workingDir });
    try {
      const { stdout } = await execAsync(
        'trivy fs --format json --severity HIGH,CRITICAL .',
        { cwd: workingDir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      );
      return this.parseOutput(stdout);
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string };
      if (err.stdout) return this.parseOutput(err.stdout);
      log.error('Trivy failed', { stderr: err.stderr?.slice(0, 500) });
      return { success: false, errors: [{ message: `Trivy failed: ${err.stderr?.slice(0, 200)}`, severity: 'error' }], warnings: [] };
    }
  }

  private parseOutput(jsonOutput: string): PluginResult {
    try {
      const data = JSON.parse(jsonOutput) as { Results?: Array<{ Vulnerabilities?: Array<{ VulnerabilityID: string; PkgName: string; Severity: string; Title: string }> }> };
      const errors: PluginError[] = [];
      for (const result of data.Results ?? []) {
        for (const vuln of result.Vulnerabilities ?? []) {
          errors.push({
            rule: vuln.VulnerabilityID,
            message: `${vuln.PkgName}: ${vuln.Title} (${vuln.Severity})`,
            severity: vuln.Severity === 'CRITICAL' ? 'error' : 'warning',
          });
        }
      }
      const criticals = errors.filter(e => e.severity === 'error').length;
      log.info('Trivy complete', { vulnerabilities: errors.length, criticals });
      return { success: criticals === 0, errors, warnings: [], metadata: { vulnerabilities: errors.length } };
    } catch {
      return { success: true, errors: [], warnings: ['Trivy returned non-JSON output'] };
    }
  }
}
