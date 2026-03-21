/**
 * ScanScheduler Tests
 * Tests autonomous scanning loop: dedup, severity mapping, task creation, interval lifecycle
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock scanner so vi.mock can reference it
const mockScanner = vi.hoisted(() => ({
  name: 'eslint',
  type: 'scanner' as const,
  isAvailable: vi.fn().mockResolvedValue(true),
  scan: vi.fn().mockResolvedValue({
    success: false,
    errors: [
      { file: 'src/index.ts', line: 10, message: 'no-unused-vars', severity: 'error' },
    ],
    warnings: [],
    raw: '',
  }),
}));

const mockRepoManagerInstance = vi.hoisted(() => ({
  list: vi.fn().mockReturnValue([
    { name: 'my-app', repoPath: '/tmp/repos/my-app', cloned: true, createdAt: '2026-01-01' },
  ]),
  exists: vi.fn().mockReturnValue(true),
}));

// Mock RepoManager
vi.mock('../../src/repos/repo.manager.js', () => ({
  RepoManager: vi.fn().mockImplementation(() => mockRepoManagerInstance),
}));

// Mock plugin loader
vi.mock('../../src/plugins/plugin.loader.js', () => ({
  getAvailableScanners: vi.fn().mockResolvedValue([mockScanner]),
}));

import { ScanScheduler } from '../../src/core/scan-scheduler.js';

describe('ScanScheduler', () => {
  let onFinding: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onFinding = vi.fn().mockResolvedValue('task-123');

    // Reset mock scanner to defaults
    mockScanner.scan.mockResolvedValue({
      success: false,
      errors: [
        { file: 'src/index.ts', line: 10, message: 'no-unused-vars', severity: 'error' },
      ],
      warnings: [],
      raw: '',
    });

    mockRepoManagerInstance.list.mockReturnValue([
      { name: 'my-app', repoPath: '/tmp/repos/my-app', cloned: true, createdAt: '2026-01-01' },
    ]);
    mockRepoManagerInstance.exists.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start and stop the scanning loop', () => {
    const scheduler = new ScanScheduler({ onFinding });
    const stats = scheduler.getStats();
    expect(stats.running).toBe(false);

    scheduler.start();
    expect(scheduler.getStats().running).toBe(true);

    scheduler.stop();
    expect(scheduler.getStats().running).toBe(false);
  });

  it('should not start twice', () => {
    const scheduler = new ScanScheduler({ onFinding });
    scheduler.start();
    scheduler.start(); // no-op
    expect(scheduler.getStats().running).toBe(true);
    scheduler.stop();
  });

  it('should run a scan cycle and create a task from findings', async () => {
    const scheduler = new ScanScheduler({ onFinding });
    const findings = await scheduler.runScanCycle();

    expect(findings).toHaveLength(1);
    expect(findings[0].repoName).toBe('my-app');
    expect(findings[0].scanner).toBe('eslint');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].complexity).toBe('SIMPLE');
    expect(onFinding).toHaveBeenCalledOnce();
  });

  it('should deduplicate identical findings within the window', async () => {
    const scheduler = new ScanScheduler({ onFinding });

    // First scan — creates task
    await scheduler.runScanCycle();
    expect(onFinding).toHaveBeenCalledTimes(1);

    // Second scan — dedup should skip
    await scheduler.runScanCycle();
    expect(onFinding).toHaveBeenCalledTimes(1);
  });

  it('should create tasks again after dedup window expires', async () => {
    const scheduler = new ScanScheduler({ onFinding });

    await scheduler.runScanCycle();
    expect(onFinding).toHaveBeenCalledTimes(1);

    // Advance past 24h dedup window
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);

    await scheduler.runScanCycle();
    expect(onFinding).toHaveBeenCalledTimes(2);
  });

  it('should respect maxTasksPerScan limit', async () => {
    mockScanner.scan.mockResolvedValueOnce({
      success: false,
      errors: [{ file: 'a.ts', line: 1, message: 'error-a', severity: 'error' }],
      warnings: [],
      raw: '',
    });

    const scheduler = new ScanScheduler({ onFinding, maxTasksPerScan: 1 });
    const findings = await scheduler.runScanCycle();

    expect(findings.length).toBeLessThanOrEqual(1);
    expect(onFinding).toHaveBeenCalledTimes(1);
  });

  it('should map severity correctly for security scanners', async () => {
    const secScanner = {
      name: 'semgrep',
      type: 'scanner' as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      scan: vi.fn().mockResolvedValue({
        success: false,
        errors: [{ file: 'auth.ts', line: 5, message: 'sql-injection', severity: 'warning' }],
        warnings: [],
        raw: '',
      }),
    };

    const { getAvailableScanners } = await import('../../src/plugins/plugin.loader.js');
    (getAvailableScanners as ReturnType<typeof vi.fn>).mockResolvedValueOnce([secScanner]);

    const scheduler = new ScanScheduler({ onFinding });
    const findings = await scheduler.runScanCycle();

    expect(findings[0].complexity).toBe('CRITICAL');
  });

  it('should skip repos that do not exist', async () => {
    mockRepoManagerInstance.exists.mockReturnValue(false);

    const scheduler = new ScanScheduler({ onFinding });
    const findings = await scheduler.runScanCycle();
    expect(findings).toHaveLength(0);
    expect(onFinding).not.toHaveBeenCalled();
  });

  it('should skip when no repos are registered', async () => {
    mockRepoManagerInstance.list.mockReturnValue([]);

    const scheduler = new ScanScheduler({ onFinding });
    const findings = await scheduler.runScanCycle();
    expect(findings).toHaveLength(0);
  });

  it('should handle scanner errors gracefully', async () => {
    mockScanner.scan.mockRejectedValueOnce(new Error('scanner crashed'));

    const scheduler = new ScanScheduler({ onFinding });
    const findings = await scheduler.runScanCycle();

    expect(findings).toHaveLength(0);
  });

  it('should handle onFinding errors gracefully', async () => {
    onFinding.mockRejectedValueOnce(new Error('task creation failed'));

    const scheduler = new ScanScheduler({ onFinding });
    const findings = await scheduler.runScanCycle();

    // Finding detected but task creation failed — finding still recorded
    expect(findings).toHaveLength(1);
  });

  it('should not run concurrent scans', async () => {
    // Simulate slow scan using a deferred promise
    let resolveSlowScan: (v: unknown) => void;
    const slowPromise = new Promise(resolve => { resolveSlowScan = resolve; });
    mockScanner.scan.mockReturnValueOnce(slowPromise);

    const scheduler = new ScanScheduler({ onFinding });

    // Start first scan (will block on scanner)
    const p1 = scheduler.runScanCycle();

    // Second scan should see scanning=true and return immediately
    const r2 = await scheduler.runScanCycle();
    expect(r2).toHaveLength(0);

    // Now resolve the first scan
    resolveSlowScan!({
      success: false,
      errors: [{ file: 'a.ts', line: 1, message: 'slow', severity: 'error' }],
      warnings: [],
      raw: '',
    });
    const r1 = await p1;
    expect(r1).toHaveLength(1);
  });

  it('should report stats correctly', async () => {
    const scheduler = new ScanScheduler({ onFinding, intervalMs: 5000 });

    expect(scheduler.getStats()).toEqual({
      running: false,
      cachedFindings: 0,
      intervalMs: 5000,
    });

    await scheduler.runScanCycle();

    expect(scheduler.getStats().cachedFindings).toBe(1);
  });
});
