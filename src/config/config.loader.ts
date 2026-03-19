/**
 * Config Loader — Reads nanoprym.config.yaml and returns typed config
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { NanoprymConfig } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('config');

const CONFIG_FILENAMES = [
  'nanoprym.config.yaml',
  'nanoprym.config.yml',
  '.nanoprymrc.yaml',
];

const DEFAULT_CONFIG: NanoprymConfig = {
  version: '2.0',
  hardware: { ram_gb: 16, gpu: 'apple-metal' },
  providers: {
    builder: { name: 'claude', model: 'sonnet', subscription: 'claude-max' },
    reviewer: { name: 'copilot', model: 'copilot-pro' },
    planner: { name: 'claude', model: 'sonnet', subscription: 'claude-max' },
  },
  tom: {
    enabled: true,
    sidecar_socket: '/tmp/nanoprym-tom.sock',
    compression: { layer1_rules: true, layer2_spacy: true, layer3_cache: true },
    routing: { bypass_first_gen: true, bypass_complex: true, compress_iterations: true, route_auxiliary: true },
    cloud_budget_monthly_usd: 5.0,
  },
  tasks: { max_concurrent: 1, max_iterations: 5, retry_attempts: 3 },
  git: { worktree_isolation: true, conventional_commits: true, auto_pr: true, branch_prefix: 'nanoprym/' },
  context: { planner: 100_000, builder: 200_000, reviewer: 50_000, validator: 50_000 },
  testing: { coverage_overall: 60, coverage_branch: 80, runner: 'vitest' },
};

/** Load config from YAML file, falling back to defaults */
export function loadConfig(configDir?: string): NanoprymConfig {
  const searchDir = configDir ?? process.cwd();

  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.join(searchDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = yaml.load(raw) as Record<string, unknown>;
        const config = mergeDeep(DEFAULT_CONFIG as unknown as Record<string, unknown>, parsed) as unknown as NanoprymConfig;
        log.info('Config loaded', { file: filename });
        return config;
      } catch (error) {
        log.warn('Failed to parse config file, using defaults', { file: filename, error: String(error) });
      }
    }
  }

  log.info('No config file found, using defaults');
  return { ...DEFAULT_CONFIG };
}

/** Deep merge two objects (source into target) */
function mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = mergeDeep(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
