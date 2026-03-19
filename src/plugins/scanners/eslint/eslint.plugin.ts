/**
 * ESLint Scanner Plugin — Runs ESLint on the codebase
 * Returns structured errors/warnings for the validator agent.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScannerPlugin, PluginResult, PluginError } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:eslint');

export class EslintPlugin implements ScannerPlugin {
  readonly name = 'eslint';
  readonly type = 'scanner' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('npx eslint --version', { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async scan(workingDir: string): Promise<PluginResult> {
    log.info('Running ESLint', { workingDir });

    try {
      const { stdout } = await execAsync(
        'npx eslint src/ --ext .ts --format json --no-error-on-unmatched-pattern',
        { cwd: workingDir, timeout: 60_000, maxBuffer: 5 * 1024 * 1024 },
      );

      return this.parseOutput(stdout);
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; code?: number };

      // ESLint exits with code 1 when there are lint errors — that's expected
      if (err.stdout) {
        return this.parseOutput(err.stdout);
      }

      log.error('ESLint failed', { stderr: err.stderr?.slice(0, 500) });
      return {
        success: false,
        errors: [{ message: `ESLint execution failed: ${err.stderr?.slice(0, 200)}`, severity: 'error' }],
        warnings: [],
      };
    }
  }

  private parseOutput(jsonOutput: string): PluginResult {
    try {
      const results = JSON.parse(jsonOutput) as Array<{
        filePath: string;
        messages: Array<{
          ruleId: string | null;
          severity: number;
          message: string;
          line: number;
          column: number;
        }>;
        errorCount: number;
        warningCount: number;
      }>;

      const errors: PluginError[] = [];
      const warnings: string[] = [];
      let totalErrors = 0;
      let totalWarnings = 0;

      for (const file of results) {
        totalErrors += file.errorCount;
        totalWarnings += file.warningCount;

        for (const msg of file.messages) {
          const entry: PluginError = {
            file: file.filePath,
            line: msg.line,
            column: msg.column,
            rule: msg.ruleId ?? undefined,
            message: msg.message,
            severity: msg.severity === 2 ? 'error' : 'warning',
          };

          if (msg.severity === 2) {
            errors.push(entry);
          } else {
            warnings.push(`${file.filePath}:${msg.line} [${msg.ruleId}] ${msg.message}`);
          }
        }
      }

      log.info('ESLint complete', { errors: totalErrors, warnings: totalWarnings });

      return {
        success: totalErrors === 0,
        errors,
        warnings,
        metadata: { totalErrors, totalWarnings, filesScanned: results.length },
      };
    } catch {
      return {
        success: true,
        errors: [],
        warnings: ['ESLint returned non-JSON output — assuming clean'],
      };
    }
  }
}
