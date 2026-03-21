/**
 * Plugin Loader — Registry of available scanner/tester/generator plugins
 */
import type { ScannerPlugin, TesterPlugin } from './plugin.types.js';
import { EslintPlugin } from './scanners/eslint/eslint.plugin.js';
import { SemgrepPlugin } from './scanners/semgrep/semgrep.plugin.js';
import { TrivyPlugin } from './scanners/trivy/trivy.plugin.js';
import { JscpdPlugin } from './scanners/jscpd/jscpd.plugin.js';
import { RuffPlugin } from './scanners/ruff/ruff.plugin.js';
import { LighthousePlugin } from './scanners/lighthouse/lighthouse.plugin.js';
import { MadgePlugin } from './scanners/madge/madge.plugin.js';
import { RCAGeneratorPlugin } from './generators/rca-generator/rca-generator.plugin.js';
import { ChangelogGeneratorPlugin } from './generators/changelog-generator/changelog-generator.plugin.js';
import { ADRGeneratorPlugin } from './generators/adr-generator/adr-generator.plugin.js';
import { OpenAPIGeneratorPlugin } from './generators/openapi-generator/openapi-generator.plugin.js';
import { DockerGeneratorPlugin } from './generators/docker-generator/docker-generator.plugin.js';
import { DeployGuideGeneratorPlugin } from './generators/deploy-guide-generator/deploy-guide-generator.plugin.js';
import { VitestPlugin } from './testers/vitest/vitest.plugin.js';
import { PlaywrightPlugin } from './testers/playwright/playwright.plugin.js';
import { HurlPlugin } from './testers/hurl/hurl.plugin.js';
import { K6Plugin } from './testers/k6/k6.plugin.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('plugin-loader');

/** All registered scanner plugins */
const SCANNER_REGISTRY: ScannerPlugin[] = [
  new EslintPlugin(),
  new SemgrepPlugin(),
  new TrivyPlugin(),
  new JscpdPlugin(),
  new RuffPlugin(),
  new LighthousePlugin(),
  new MadgePlugin(),
];

/** All registered generator plugins */
const GENERATOR_REGISTRY = [
  new RCAGeneratorPlugin(),
  new ChangelogGeneratorPlugin(),
  new ADRGeneratorPlugin(),
  new OpenAPIGeneratorPlugin(),
  new DockerGeneratorPlugin(),
  new DeployGuideGeneratorPlugin(),
] as const;

/** All registered tester plugins */
const TESTER_REGISTRY: TesterPlugin[] = [
  new VitestPlugin(),
  new PlaywrightPlugin(),
  new HurlPlugin(),
  new K6Plugin(),
];

/** Get all registered scanner plugins (regardless of availability) */
export function getRegisteredScanners(): readonly ScannerPlugin[] {
  return SCANNER_REGISTRY;
}

/** Get all registered generator plugins */
export function getRegisteredGenerators(): readonly { name: string; type: string }[] {
  return GENERATOR_REGISTRY;
}

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

/** Get all registered tester plugins (regardless of availability) */
export function getRegisteredTesters(): readonly TesterPlugin[] {
  return TESTER_REGISTRY;
}

/** Get all available tester plugins */
export async function getAvailableTesters(): Promise<TesterPlugin[]> {
  const available: TesterPlugin[] = [];
  for (const tester of TESTER_REGISTRY) {
    if (await tester.isAvailable()) {
      available.push(tester);
    } else {
      log.warn('Tester not available', { name: tester.name });
    }
  }
  return available;
}

/** Run all available testers on a directory */
export async function runAllTesters(workingDir: string): Promise<{
  passed: boolean;
  results: Map<string, Awaited<ReturnType<TesterPlugin['run']>>>;
}> {
  const testers = await getAvailableTesters();
  const results = new Map<string, Awaited<ReturnType<TesterPlugin['run']>>>();
  let allPassed = true;

  for (const tester of testers) {
    const result = await tester.run(workingDir);
    results.set(tester.name, result);
    if (!result.success) allPassed = false;
  }

  log.info('All testers complete', {
    total: testers.length,
    passed: allPassed,
    testers: testers.map(t => t.name),
  });

  return { passed: allPassed, results };
}
