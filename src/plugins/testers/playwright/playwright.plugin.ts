/**
 * Playwright Tester Plugin — E2E browser tests
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { TesterPlugin, PluginResult } from '../../plugin.types.js';
import { createChildLogger } from '../../../_shared/logger.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:playwright');

export class PlaywrightPlugin implements TesterPlugin {
  readonly name = 'playwright';
  readonly type = 'tester' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('npx playwright --version', { timeout: 10_000 });
      return true;
    } catch { return false; }
  }

  async run(workingDir: string): Promise<PluginResult & { passed: number; failed: number; skipped: number }> {
    log.info('Running Playwright', { workingDir });
    try {
      const { stdout } = await execAsync(
        'npx playwright test --reporter=json',
        { cwd: workingDir, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
      );
      const data = JSON.parse(stdout) as { stats: { expected: number; unexpected: number; skipped: number } };
      const passed = data.stats?.expected ?? 0;
      const failed = data.stats?.unexpected ?? 0;
      const skipped = data.stats?.skipped ?? 0;
      log.info('Playwright complete', { passed, failed, skipped });
      return {
        success: failed === 0,
        errors: failed > 0 ? [{ message: `${failed} E2E tests failed`, severity: 'error' }] : [],
        warnings: [],
        passed, failed, skipped,
      };
    } catch (error: unknown) {
      log.error('Playwright failed', { error: String(error) });
      return { success: false, errors: [{ message: String(error).slice(0, 200), severity: 'error' }], warnings: [], passed: 0, failed: 0, skipped: 0 };
    }
  }
}
