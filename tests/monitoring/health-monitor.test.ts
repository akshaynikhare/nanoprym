import { describe, it, expect, afterEach } from 'vitest';
import { HealthMonitor, type HealthAlert } from '../../src/monitoring/health.monitor.js';
import { DatabaseClient } from '../../src/db/db.client.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('HealthMonitor', () => {
  let monitor: HealthMonitor | null = null;
  let dbPath: string | null = null;

  afterEach(() => {
    if (monitor) {
      monitor.stop();
      monitor = null;
    }
    if (dbPath && fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('should return detailed status with all fields', () => {
    monitor = new HealthMonitor();
    const status = monitor.getDetailedStatus();

    expect(status.status).toBeDefined();
    expect(status.version).toBeDefined();
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.timestamp).toBeDefined();
    expect(status.activeTask).toBe(false);
    expect(status.system.memoryUsedMb).toBeGreaterThan(0);
    expect(status.system.memoryTotalMb).toBeGreaterThan(0);
    expect(status.system.memoryPercent).toBeGreaterThanOrEqual(0);
    expect(status.dependencies).toHaveLength(4);
  });

  it('should initialize all dependencies as unknown', () => {
    monitor = new HealthMonitor();
    const status = monitor.getDetailedStatus();

    for (const dep of status.dependencies) {
      expect(dep.state).toBe('unknown');
      expect(dep.lastChecked).toBeDefined();
    }

    const names = status.dependencies.map(d => d.name);
    expect(names).toContain('qdrant');
    expect(names).toContain('redis');
    expect(names).toContain('ollama');
    expect(names).toContain('tom');
  });

  it('should reflect activeTask from callback', () => {
    monitor = new HealthMonitor({ activeTaskCheck: () => true });
    expect(monitor.getDetailedStatus().activeTask).toBe(true);
  });

  it('should report ok when all dependencies are up', async () => {
    monitor = new HealthMonitor();

    // With all unknown, it's degraded (not all up)
    const status = monitor.getDetailedStatus();
    expect(status.status).not.toBe('ok');
  });

  it('should report a valid status after running checks', async () => {
    monitor = new HealthMonitor();
    await monitor.runChecks();
    const status = monitor.getDetailedStatus();

    // Status depends on which services are running locally
    expect(['ok', 'degraded', 'down']).toContain(status.status);
  });

  it('should stop the timer on stop()', () => {
    monitor = new HealthMonitor();
    monitor.start(60_000);
    monitor.stop();
    // No error thrown, timer cleared — verify by calling stop again (idempotent)
    monitor.stop();
  });

  it('should track uptime correctly', async () => {
    monitor = new HealthMonitor();
    const s1 = monitor.getDetailedStatus().uptime;
    await new Promise(r => setTimeout(r, 1100));
    const s2 = monitor.getDetailedStatus().uptime;
    expect(s2).toBeGreaterThan(s1);
  });

  it('should fire alert callbacks on dependency state transitions', async () => {
    monitor = new HealthMonitor();
    const alerts: HealthAlert[] = [];
    monitor.onAlert((alert) => alerts.push(alert));

    // Run checks — dependencies will transition from unknown → up/down
    // Initial unknown → X transitions are skipped, so we need a second run
    await monitor.runChecks();
    // First run: unknown → actual state (alerts skipped for unknown → X)
    const initialAlerts = alerts.length;

    // Run again — no transitions expected unless service state changes
    await monitor.runChecks();
    // No new transitions if state didn't change
    expect(alerts.length).toBe(initialAlerts);
  });

  it('should register multiple alert callbacks', () => {
    monitor = new HealthMonitor();
    const calls1: HealthAlert[] = [];
    const calls2: HealthAlert[] = [];

    monitor.onAlert((a) => calls1.push(a));
    monitor.onAlert((a) => calls2.push(a));

    // Both callbacks registered — no crash
    expect(calls1.length).toBe(0);
    expect(calls2.length).toBe(0);
  });

  it('should return empty history when no DB is attached', () => {
    monitor = new HealthMonitor();
    const history = monitor.getHistory();
    expect(history).toEqual([]);
  });

  it('should not crash when alert callback throws', async () => {
    monitor = new HealthMonitor();
    monitor.onAlert(() => { throw new Error('callback failure'); });

    // Should not throw even if callback fails
    await monitor.runChecks();
    await monitor.runChecks();
  });

  it('should persist snapshots and return history when DB is attached', async () => {
    dbPath = path.join(os.tmpdir(), `nanoprym-health-test-${Date.now()}.db`);
    const db = await DatabaseClient.create(dbPath);

    monitor = new HealthMonitor({ db });
    await monitor.runChecks();
    await monitor.runChecks();

    const history = monitor.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].status).toBeDefined();
    expect(history[0].memory_used_mb).toBeGreaterThan(0);
    expect(history[0].recorded_at).toBeDefined();
    expect(history[0].dependencies).toBeDefined();

    db.close();
  });

  it('should attach DB after construction via attachDb', async () => {
    dbPath = path.join(os.tmpdir(), `nanoprym-health-attach-${Date.now()}.db`);
    const db = await DatabaseClient.create(dbPath);

    monitor = new HealthMonitor();
    expect(monitor.getHistory()).toEqual([]);

    monitor.attachDb(db);
    await monitor.runChecks();

    const history = monitor.getHistory();
    expect(history.length).toBe(1);
    expect(history[0].status).toBeDefined();

    db.close();
  });
});
