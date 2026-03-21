/**
 * Health Monitor — Periodically checks dependency availability and system metrics.
 * Exposes a detailed health snapshot consumed by the health/API servers and CLI.
 * Optionally persists snapshots to DB and fires alerts on state transitions.
 */
import { createChildLogger } from '../_shared/logger.js';
import { NANOPRYM_VERSION, HEALTH_CHECK_INTERVAL_MS, DEPENDENCY_TIMEOUT_MS } from '../_shared/constants.js';
import type { DependencyName, DependencyStatus, DependencyState, DetailedHealthStatus } from '../_shared/types.js';
import type { DatabaseClient } from '../db/db.client.js';
import os from 'node:os';
import { execSync } from 'node:child_process';

const log = createChildLogger('health-monitor');

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';

const MAX_HISTORY = 500;

/**
 * Get actual memory used by apps. On macOS, os.freemem() only reports truly free pages
 * and excludes inactive/purgeable/cached memory, making usage appear ~100%.
 * We parse vm_stat to compute (active + wired) which matches Activity Monitor's "Memory Used".
 */
function getMemoryUsed(memTotal: number): number {
  if (os.platform() === 'darwin') {
    try {
      const output = execSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
      const pageSize = parseInt(output.match(/page size of (\d+)/)?.[1] ?? '16384', 10);
      const active = parseInt(output.match(/Pages active:\s+(\d+)/)?.[1] ?? '0', 10);
      const wired = parseInt(output.match(/Pages wired down:\s+(\d+)/)?.[1] ?? '0', 10);
      const compressed = parseInt(output.match(/Pages occupied by compressor:\s+(\d+)/)?.[1] ?? '0', 10);
      return (active + wired + compressed) * pageSize;
    } catch {
      // Fallback
    }
  }
  return memTotal - os.freemem();
}

export type AlertCallback = (event: HealthAlert) => void;

export interface HealthAlert {
  type: 'dependency_down' | 'dependency_up' | 'status_changed';
  name?: DependencyName;
  previousState: string;
  currentState: string;
  timestamp: string;
}

export interface HealthSnapshot {
  [key: string]: unknown;
  id: number;
  status: string;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_percent: number;
  dependencies: string;
  active_task: number;
  recorded_at: string;
}

type ActiveTaskCheck = () => boolean;

export class HealthMonitor {
  private startedAt: number;
  private activeTaskCheck: ActiveTaskCheck;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dependencies: Map<DependencyName, DependencyStatus> = new Map();
  private db: DatabaseClient | null = null;
  private alertCallbacks: AlertCallback[] = [];
  private lastOverallStatus: string = 'unknown';

  constructor(options?: { activeTaskCheck?: ActiveTaskCheck; db?: DatabaseClient }) {
    this.startedAt = Date.now();
    this.activeTaskCheck = options?.activeTaskCheck ?? (() => false);
    this.db = options?.db ?? null;

    // Initialize all dependencies as unknown
    for (const name of ['qdrant', 'redis', 'ollama', 'tom'] as DependencyName[]) {
      this.dependencies.set(name, {
        name,
        state: 'unknown',
        lastChecked: new Date().toISOString(),
      });
    }
  }

  /** Attach a database for snapshot persistence (can be called after construction) */
  attachDb(db: DatabaseClient): void {
    this.db = db;
  }

  /** Register an alert callback (fired on state transitions) */
  onAlert(callback: AlertCallback): void {
    this.alertCallbacks.push(callback);
  }

  /** Start periodic health checks */
  start(intervalMs: number = HEALTH_CHECK_INTERVAL_MS): void {
    // Run an initial check immediately
    this.runChecks();

    this.timer = setInterval(() => {
      this.runChecks();
    }, intervalMs);

    log.info('Health monitor started', { intervalMs });
  }

  /** Stop periodic checks */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('Health monitor stopped');
  }

  /** Get the full detailed health snapshot */
  getDetailedStatus(): DetailedHealthStatus {
    const deps = Array.from(this.dependencies.values());
    const memTotal = os.totalmem();
    const memUsed = getMemoryUsed(memTotal);

    return {
      status: this.computeOverallStatus(deps),
      version: NANOPRYM_VERSION,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      activeTask: this.activeTaskCheck(),
      system: {
        memoryUsedMb: Math.round(memUsed / 1_048_576),
        memoryTotalMb: Math.round(memTotal / 1_048_576),
        memoryPercent: Math.round((memUsed / memTotal) * 100),
      },
      dependencies: deps,
    };
  }

  /** Get historical snapshots from DB */
  getHistory(limit: number = 100): HealthSnapshot[] {
    if (!this.db) return [];
    return this.db.query<HealthSnapshot>(
      'SELECT * FROM health_snapshots ORDER BY recorded_at DESC LIMIT ?',
      [limit],
    );
  }

  /** Run all dependency checks concurrently */
  async runChecks(): Promise<void> {
    const checks = [
      this.checkQdrant(),
      this.checkRedis(),
      this.checkOllama(),
      this.checkTom(),
    ];
    await Promise.allSettled(checks);

    // Persist snapshot + check for overall status change
    const snapshot = this.getDetailedStatus();
    this.persistSnapshot(snapshot);

    if (this.lastOverallStatus !== 'unknown' && this.lastOverallStatus !== snapshot.status) {
      this.fireAlert({
        type: 'status_changed',
        previousState: this.lastOverallStatus,
        currentState: snapshot.status,
        timestamp: snapshot.timestamp,
      });
    }
    this.lastOverallStatus = snapshot.status;
  }

  private computeOverallStatus(deps: DependencyStatus[]): 'ok' | 'degraded' | 'down' {
    const states = deps.map(d => d.state);
    if (states.every(s => s === 'up')) return 'ok';
    // If all required infra (qdrant + redis) is down, we're down
    const qdrant = deps.find(d => d.name === 'qdrant');
    const redis = deps.find(d => d.name === 'redis');
    if (qdrant?.state === 'down' && redis?.state === 'down') return 'down';
    return 'degraded';
  }

  private async checkQdrant(): Promise<void> {
    await this.checkHttp('qdrant', `${QDRANT_URL}/healthz`);
  }

  private async checkRedis(): Promise<void> {
    const start = Date.now();
    try {
      const url = new URL(REDIS_URL);
      const host = url.hostname;
      const port = parseInt(url.port || '6379', 10);

      const alive = await this.tcpPing(host, port);
      this.setDependency('redis', alive ? 'up' : 'down', Date.now() - start);
    } catch (err) {
      this.setDependency('redis', 'down', Date.now() - start, String(err));
    }
  }

  private async checkOllama(): Promise<void> {
    await this.checkHttp('ollama', `${OLLAMA_URL}/api/tags`);
  }

  private async checkTom(): Promise<void> {
    const start = Date.now();
    try {
      const { TomClient } = await import('../tom/tom.client.js');
      const client = new TomClient();
      const alive = await client.ping();
      this.setDependency('tom', alive ? 'up' : 'down', Date.now() - start);
    } catch (err) {
      this.setDependency('tom', 'down', Date.now() - start, String(err));
    }
  }

  private async checkHttp(name: DependencyName, url: string): Promise<void> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEPENDENCY_TIMEOUT_MS);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      this.setDependency(name, resp.ok ? 'up' : 'down', Date.now() - start);
    } catch (err) {
      this.setDependency(name, 'down', Date.now() - start, String(err));
    }
  }

  private tcpPing(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      import('node:net').then(({ default: net }) => {
        const socket = net.createConnection({ host, port, timeout: DEPENDENCY_TIMEOUT_MS }, () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
      });
    });
  }

  private setDependency(name: DependencyName, state: DependencyState, latencyMs?: number, error?: string): void {
    const prev = this.dependencies.get(name);
    const status: DependencyStatus = {
      name,
      state,
      latencyMs,
      lastChecked: new Date().toISOString(),
      ...(error && state === 'down' ? { error } : {}),
    };
    this.dependencies.set(name, status);

    // Fire alerts and log on state transitions
    if (prev && prev.state !== state) {
      const logFn = state === 'up' ? log.info.bind(log) : log.warn.bind(log);
      logFn(`Dependency ${name}: ${prev.state} → ${state}`, { latencyMs });

      // Skip alerts for initial unknown → X transitions
      if (prev.state !== 'unknown') {
        this.fireAlert({
          type: state === 'up' ? 'dependency_up' : 'dependency_down',
          name,
          previousState: prev.state,
          currentState: state,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private fireAlert(alert: HealthAlert): void {
    for (const cb of this.alertCallbacks) {
      try {
        cb(alert);
      } catch (err) {
        log.warn('Alert callback error', { error: String(err) });
      }
    }
  }

  private persistSnapshot(snapshot: DetailedHealthStatus): void {
    if (!this.db) return;
    try {
      this.db.insert(
        `INSERT INTO health_snapshots (status, memory_used_mb, memory_total_mb, memory_percent, dependencies, active_task, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.status,
          snapshot.system.memoryUsedMb,
          snapshot.system.memoryTotalMb,
          snapshot.system.memoryPercent,
          JSON.stringify(snapshot.dependencies),
          snapshot.activeTask ? 1 : 0,
          snapshot.timestamp,
        ],
      );

      // Prune old snapshots beyond MAX_HISTORY
      this.db.exec(
        `DELETE FROM health_snapshots WHERE id NOT IN (SELECT id FROM health_snapshots ORDER BY recorded_at DESC LIMIT ${MAX_HISTORY})`,
      );
    } catch (err) {
      log.warn('Failed to persist health snapshot', { error: String(err) });
    }
  }
}
