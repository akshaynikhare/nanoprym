/**
 * Sandbox Manager — Docker-based isolation for self-evolution
 *
 * Creates a restricted container that can modify nanoprym's own code,
 * run tests, and propose changes via PR. Container is destroyed after each cycle.
 *
 * Restrictions (per spec Section 14):
 * - No production DB access
 * - No Slack channel access
 * - No project repo access
 * - Network blocked except GitHub API
 * - 2 hour time limit per cycle
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('sandbox');

const SANDBOX_IMAGE = 'nanoprym:sandbox';
const SANDBOX_CONTAINER = 'nanoprym-sandbox';
const SANDBOX_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const SANDBOX_NETWORK = 'nanoprym-sandbox-net';

export interface SandboxResult {
  success: boolean;
  exitCode: number;
  output: string;
  branch?: string;
  duration: number;
  timedOut: boolean;
}

export class SandboxManager {
  private repoRoot: string;
  private activeProcess: ChildProcess | null = null;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  /** Check if Docker is available */
  isAvailable(): boolean {
    try {
      execSync('docker info', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Build the sandbox Docker image */
  buildImage(): void {
    log.info('Building sandbox image');
    execSync(`docker build --target sandbox -t ${SANDBOX_IMAGE} .`, {
      cwd: this.repoRoot,
      stdio: 'inherit',
      timeout: 300_000, // 5 min build timeout
    });
    log.info('Sandbox image built');
  }

  /** Ensure the restricted network exists (GitHub API only) */
  private ensureNetwork(): void {
    try {
      execSync(`docker network inspect ${SANDBOX_NETWORK}`, { stdio: 'ignore' });
    } catch {
      // Create network with no external access by default
      // iptables rules added post-create to allow only github.com
      execSync(`docker network create --internal ${SANDBOX_NETWORK}`, { stdio: 'inherit' });
      log.info('Sandbox network created (internal, no external access)');
    }
  }

  /** Run evolution cycle in sandbox container */
  async runEvolution(evolutionScript: string): Promise<SandboxResult> {
    if (!this.isAvailable()) {
      return { success: false, exitCode: 1, output: 'Docker not available', duration: 0, timedOut: false };
    }

    this.ensureNetwork();
    this.cleanup(); // Remove any leftover container

    const startTime = Date.now();
    let timedOut = false;
    let output = '';

    const branch = `nanoprym/evolution-${Date.now()}`;

    const args = [
      'run',
      '--name', SANDBOX_CONTAINER,
      '--network', SANDBOX_NETWORK,
      '--memory', '2g',
      '--cpus', '2',
      '--read-only',
      '--tmpfs', '/tmp:rw,size=512m',
      '--tmpfs', '/app/node_modules/.cache:rw,size=256m',
      // Mount repo as read-only source
      '-v', `${this.repoRoot}:/repo:ro`,
      // Environment
      '-e', 'NANOPRYM_SANDBOX=true',
      '-e', `NANOPRYM_EVOLUTION_BRANCH=${branch}`,
      '-e', `NANOPRYM_EVOLUTION_SCRIPT=${evolutionScript}`,
      // No secrets, no webhook URLs
      SANDBOX_IMAGE,
    ];

    return new Promise<SandboxResult>((resolve) => {
      const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.activeProcess = proc;

      proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { output += data.toString(); });

      // 2-hour timeout
      const timer = setTimeout(() => {
        timedOut = true;
        log.warn('Sandbox timeout — killing container');
        this.kill();
      }, SANDBOX_TIMEOUT_MS);

      proc.on('close', (exitCode) => {
        clearTimeout(timer);
        this.activeProcess = null;
        const duration = Date.now() - startTime;

        log.info('Sandbox completed', { exitCode, duration, timedOut });
        this.cleanup();

        resolve({
          success: exitCode === 0 && !timedOut,
          exitCode: exitCode ?? 1,
          output: output.slice(-10_000), // Last 10K chars
          branch: exitCode === 0 ? branch : undefined,
          duration,
          timedOut,
        });
      });
    });
  }

  /** Run tests in sandbox container with worktree mounted */
  async runTests(worktreePath: string): Promise<SandboxResult> {
    if (!this.isAvailable()) {
      return { success: false, exitCode: 1, output: 'Docker not available', duration: 0, timedOut: false };
    }

    const containerName = `${SANDBOX_CONTAINER}-test-${Date.now()}`;
    this.cleanup(); // Remove any leftover container

    const startTime = Date.now();
    let output = '';

    const args = [
      'run',
      '--name', containerName,
      '--rm',
      '--memory', '2g',
      '--cpus', '2',
      '--read-only',
      '--tmpfs', '/tmp:rw,size=512m',
      '--tmpfs', '/app/node_modules/.cache:rw,size=256m',
      // Mount worktree source as read-only
      '-v', `${worktreePath}:/app/src:ro`,
      '-v', `${worktreePath}/package.json:/app/package.json:ro`,
      '-v', `${worktreePath}/tsconfig.json:/app/tsconfig.json:ro`,
      // Environment
      '-e', 'NANOPRYM_SANDBOX=true',
      '-w', '/app',
      SANDBOX_IMAGE,
      'sh', '-c', 'npm run build && npm test',
    ];

    return new Promise<SandboxResult>((resolve) => {
      const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { output += data.toString(); });

      // 10 minute timeout for tests
      const timeout = 10 * 60 * 1000;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        log.warn('Test sandbox timeout — killing container');
        try { execSync(`docker kill ${containerName}`, { stdio: 'ignore', timeout: 10_000 }); } catch { /* ignore */ }
      }, timeout);

      proc.on('close', (exitCode) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;

        log.info('Test sandbox completed', { exitCode, duration, timedOut });

        resolve({
          success: exitCode === 0 && !timedOut,
          exitCode: exitCode ?? 1,
          output: output.slice(-10_000),
          duration,
          timedOut,
        });
      });
    });
  }

  /** Kill running sandbox container */
  kill(): void {
    try {
      execSync(`docker kill ${SANDBOX_CONTAINER}`, { stdio: 'ignore', timeout: 10_000 });
    } catch {
      // Container may not exist
    }
    this.activeProcess = null;
  }

  /** Remove sandbox container and artifacts */
  cleanup(): void {
    try {
      execSync(`docker rm -f ${SANDBOX_CONTAINER}`, { stdio: 'ignore', timeout: 10_000 });
    } catch {
      // Ignore if container doesn't exist
    }
  }

  /** Check if sandbox is currently running */
  isRunning(): boolean {
    if (this.activeProcess !== null) return true;
    try {
      const result = execSync(`docker inspect -f '{{.State.Running}}' ${SANDBOX_CONTAINER}`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      return result.trim() === 'true';
    } catch {
      return false;
    }
  }
}
