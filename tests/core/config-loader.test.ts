import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/config.loader.js';
import path from 'node:path';

describe('Config Loader', () => {
  it('should load config from project root', () => {
    const config = loadConfig(path.resolve(process.cwd()));
    expect(config).toBeDefined();
    expect(config.version).toBeDefined();
    expect(config.providers).toBeDefined();
    expect(config.tom).toBeDefined();
  });

  it('should have correct default context budgets', () => {
    const config = loadConfig(path.resolve(process.cwd()));
    expect(config.context.planner).toBe(100_000);
    expect(config.context.builder).toBe(200_000);
    expect(config.context.reviewer).toBe(50_000);
    expect(config.context.validator).toBe(50_000);
  });

  it('should have TOM enabled by default', () => {
    const config = loadConfig(path.resolve(process.cwd()));
    expect(config.tom.enabled).toBe(true);
    expect(config.tom.cloud_budget_monthly_usd).toBe(5);
  });

  it('should fall back to defaults for missing dir', () => {
    const config = loadConfig('/nonexistent/path');
    expect(config).toBeDefined();
    expect(config.tasks.max_concurrent).toBe(1);
    expect(config.tasks.retry_attempts).toBe(3);
  });

  it('should have git worktree isolation enabled', () => {
    const config = loadConfig(path.resolve(process.cwd()));
    expect(config.git.worktree_isolation).toBe(true);
    expect(config.git.conventional_commits).toBe(true);
    expect(config.git.branch_prefix).toBe('nanoprym/');
  });
});
