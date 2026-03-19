/**
 * Plugin Loader — Registry of available scanner/tester plugins
 */
import type { ScannerPlugin } from './plugin.types.js';
import { EslintPlugin } from './scanners/eslint/eslint.plugin.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('plugin-loader');

/** All registered scanner plugins */
const SCANNER_REGISTRY: ScannerPlugin[] = [
  new EslintPlugin(),
  // TODO: Add Semgrep, Trivy, jscpd, etc.
];

/** Get all available scanner plugins */
export async function getAvailableScanners(): Promise<ScannerPlugin[]> {
  const available: ScannerPlugin[] = [];
  for (const scanner of SCANNER_REGISTRY) {
    if (await scanner.isAvailable()) {
      available.push(scanner);
    } else {
      log.warn('Scanner not available', { name: scanner.name });
    }
  }
  return available;
}

/** Run all available scanners on a directory */
export async function runAllScanners(workingDir: string): Promise<{
  passed: boolean;
  results: Map<string, Awaited<ReturnType<ScannerPlugin['scan']>>>;
}> {
  const scanners = await getAvailableScanners();
  const results = new Map<string, Awaited<ReturnType<ScannerPlugin['scan']>>>();
  let allPassed = true;

  for (const scanner of scanners) {
    const result = await scanner.scan(workingDir);
    results.set(scanner.name, result);
    if (!result.success) allPassed = false;
  }

  log.info('All scanners complete', {
    total: scanners.length,
    passed: allPassed,
    scanners: scanners.map(s => s.name),
  });

  return { passed: allPassed, results };
}
