/**
 * Scan Scheduler — Autonomous repo scanning loop
 *
 * Periodically scans registered repos with available scanner plugins,
 * auto-creates tasks for findings based on severity:
 *   - Bugs/security → auto-build (SIMPLE, source: scanner)
 *   - Quality issues → awaits approval via dashboard
 *
 * Deduplicates: won't create a task for the same scanner+repo+finding hash
 * if one was already created within the dedup window.
 */
import { createChildLogger } from '../_shared/logger.js';
import { RepoManager } from '../repos/repo.manager.js';
import { getAvailableScanners } from '../plugins/plugin.loader.js';
import type { ScannerPlugin } from '../plugins/plugin.types.js';
import type { TaskComplexity, TaskType } from '../_shared/types.js';
import crypto from 'node:crypto';

const log = createChildLogger('scan-scheduler');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ScanFinding {
  repoName: string;
  scanner: string;
  severity: 'error' | 'warning';
  summary: string;
  details: string;
  complexity: TaskComplexity;
  taskType: TaskType;
}

export interface ScanSchedulerOptions {
  intervalMs?: number;
  repos?: string[];           // specific repo names, or all if omitted
  scanners?: string[];        // specific scanner names, or all available if omitted
  maxTasksPerScan?: number;   // cap tasks created per scan cycle (default: 3)
  onFinding: (finding: ScanFinding) => Promise<string>; // returns taskId
}

export class ScanScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private repoManager: RepoManager;
  private options: Required<Omit<ScanSchedulerOptions, 'onFinding'>> & { onFinding: ScanSchedulerOptions['onFinding'] };
  private recentFindings: Map<string, number> = new Map(); // hash → timestamp
  private scanning = false;

  constructor(options: ScanSchedulerOptions) {
    this.repoManager = new RepoManager();
    this.options = {
      intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
      repos: options.repos ?? [],
      scanners: options.scanners ?? [],
      maxTasksPerScan: options.maxTasksPerScan ?? 3,
      onFinding: options.onFinding,
    };
  }

  /** Start the scanning loop */
  start(): void {
    if (this.timer) return;

    log.info('Scan scheduler started', {
      intervalMs: this.options.intervalMs,
      repos: this.options.repos.length || 'all',
      scanners: this.options.scanners.length || 'all available',
    });

    // Run first scan after a short delay (let infra settle)
    setTimeout(() => this.runScanCycle(), 10_000);

    this.timer = setInterval(() => this.runScanCycle(), this.options.intervalMs);
  }

  /** Stop the scanning loop */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('Scan scheduler stopped');
    }
  }

  /** Run a single scan cycle across all repos */
  async runScanCycle(): Promise<ScanFinding[]> {
    if (this.scanning) {
      log.info('Scan already in progress, skipping');
      return [];
    }

    this.scanning = true;
    this.cleanupDedupCache();

    const allFindings: ScanFinding[] = [];
    let tasksCreated = 0;

    try {
      const repos = this.getTargetRepos();
      const scanners = await this.getTargetScanners();

      if (repos.length === 0) {
        log.info('No repos registered, skipping scan');
        return [];
      }

      if (scanners.length === 0) {
        log.info('No scanners available, skipping scan');
        return [];
      }

      log.info('Scan cycle starting', { repos: repos.length, scanners: scanners.length });

      for (const repo of repos) {
        if (!this.repoManager.exists(repo.name)) {
          log.warn('Repo path missing, skipping', { name: repo.name });
          continue;
        }

        for (const scanner of scanners) {
          if (tasksCreated >= this.options.maxTasksPerScan) {
            log.info('Max tasks per scan reached', { max: this.options.maxTasksPerScan });
            break;
          }

          try {
            const result = await scanner.scan(repo.repoPath);

            if (!result.success && result.errors.length > 0) {
              const finding = this.createFinding(repo.name, scanner.name, result.errors);
              const hash = this.findingHash(finding);

              if (this.recentFindings.has(hash)) {
                log.info('Duplicate finding, skipping', { repo: repo.name, scanner: scanner.name });
                continue;
              }

              allFindings.push(finding);
              this.recentFindings.set(hash, Date.now());

              try {
                const taskId = await this.options.onFinding(finding);
                tasksCreated++;
                log.info('Task created from scan finding', {
                  taskId, repo: repo.name, scanner: scanner.name, severity: finding.severity,
                });
              } catch (err) {
                log.error('Failed to create task from finding', { error: String(err) });
              }
            }
          } catch (err) {
            log.warn('Scanner failed', { scanner: scanner.name, repo: repo.name, error: String(err) });
          }
        }
      }

      log.info('Scan cycle complete', { findings: allFindings.length, tasksCreated });
    } finally {
      this.scanning = false;
    }

    return allFindings;
  }

  /** Get stats about the scheduler */
  getStats(): { running: boolean; cachedFindings: number; intervalMs: number } {
    return {
      running: this.timer !== null,
      cachedFindings: this.recentFindings.size,
      intervalMs: this.options.intervalMs,
    };
  }

  private getTargetRepos() {
    const all = this.repoManager.list();
    if (this.options.repos.length === 0) return all;
    return all.filter(r => this.options.repos.includes(r.name));
  }

  private async getTargetScanners(): Promise<ScannerPlugin[]> {
    const available = await getAvailableScanners();
    if (this.options.scanners.length === 0) return available;
    return available.filter(s => this.options.scanners.includes(s.name));
  }

  private createFinding(
    repoName: string,
    scannerName: string,
    errors: Array<{ file?: string; line?: number; message: string; severity: string }>,
  ): ScanFinding {
    const hasErrors = errors.some(e => e.severity === 'error');
    const isSecurity = scannerName === 'semgrep' || scannerName === 'trivy';
    const summary = errors.slice(0, 5).map(e =>
      `${e.file ?? ''}${e.line ? ':' + e.line : ''} ${e.message}`
    ).join('\n');

    return {
      repoName,
      scanner: scannerName,
      severity: hasErrors ? 'error' : 'warning',
      summary: `${scannerName}: ${errors.length} issue(s) in ${repoName}`,
      details: summary,
      complexity: isSecurity ? 'CRITICAL' : hasErrors ? 'SIMPLE' : 'TRIVIAL',
      taskType: 'TASK' as TaskType,
    };
  }

  private findingHash(finding: ScanFinding): string {
    const key = `${finding.repoName}:${finding.scanner}:${finding.details.slice(0, 200)}`;
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  private cleanupDedupCache(): void {
    const now = Date.now();
    for (const [hash, timestamp] of this.recentFindings) {
      if (now - timestamp > DEDUP_WINDOW_MS) {
        this.recentFindings.delete(hash);
      }
    }
  }
}
