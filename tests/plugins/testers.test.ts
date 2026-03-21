/**
 * Tester Plugin Tests — Hurl + k6
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { HurlPlugin } from '../../src/plugins/testers/hurl/hurl.plugin.js';
import { K6Plugin } from '../../src/plugins/testers/k6/k6.plugin.js';

describe('Hurl Plugin', () => {
  const plugin = new HurlPlugin();

  it('should have correct name and type', () => {
    expect(plugin.name).toBe('hurl');
    expect(plugin.type).toBe('tester');
  });

  it('should implement TesterPlugin interface', () => {
    expect(typeof plugin.isAvailable).toBe('function');
    expect(typeof plugin.run).toBe('function');
  });

  it('should return boolean from isAvailable', async () => {
    const result = await plugin.isAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('should handle directory with no .hurl files gracefully', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hurl-test-'));
    try {
      const result = await plugin.run(tmpDir);
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(typeof result.success).toBe('boolean');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return structured result with test counts', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hurl-test-'));
    try {
      const result = await plugin.run(tmpDir);
      expect(typeof result.passed).toBe('number');
      expect(typeof result.failed).toBe('number');
      expect(typeof result.skipped).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('k6 Plugin', () => {
  const plugin = new K6Plugin();

  it('should have correct name and type', () => {
    expect(plugin.name).toBe('k6');
    expect(plugin.type).toBe('tester');
  });

  it('should implement TesterPlugin interface', () => {
    expect(typeof plugin.isAvailable).toBe('function');
    expect(typeof plugin.run).toBe('function');
  });

  it('should return boolean from isAvailable', async () => {
    const result = await plugin.isAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('should handle directory with no k6 script gracefully', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'k6-test-'));
    try {
      const result = await plugin.run(tmpDir);
      expect(result.success).toBe(true);
      expect(result.passed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return structured result with test counts', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'k6-test-'));
    try {
      const result = await plugin.run(tmpDir);
      expect(typeof result.passed).toBe('number');
      expect(typeof result.failed).toBe('number');
      expect(typeof result.skipped).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Plugin Loader — Testers', () => {
  it('should export tester registry functions', async () => {
    const { getRegisteredTesters, getAvailableTesters, runAllTesters } = await import(
      '../../src/plugins/plugin.loader.js'
    );
    expect(typeof getRegisteredTesters).toBe('function');
    expect(typeof getAvailableTesters).toBe('function');
    expect(typeof runAllTesters).toBe('function');
  });

  it('should include hurl and k6 in registered testers', async () => {
    const { getRegisteredTesters } = await import('../../src/plugins/plugin.loader.js');
    const testers = getRegisteredTesters();
    const names = testers.map((t: { name: string }) => t.name);
    expect(names).toContain('hurl');
    expect(names).toContain('k6');
    expect(names).toContain('vitest');
    expect(names).toContain('playwright');
  });

  it('should have 4 registered testers total', async () => {
    const { getRegisteredTesters } = await import('../../src/plugins/plugin.loader.js');
    const testers = getRegisteredTesters();
    expect(testers.length).toBe(4);
  });
});
