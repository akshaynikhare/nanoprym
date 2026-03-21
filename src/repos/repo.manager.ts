/**
 * Repo Manager — Clone, register, list, remove target repos
 *
 * Repos are cloned into ~/.nanoprym/repos/{name}/
 * Each repo is also registered in ProjectManager for per-project isolation
 * (ledgers, KB, brain all scoped to the project).
 *
 * Usage:
 *   nanoprym repo add <url>              # clone + register
 *   nanoprym repo add <local-path>       # register existing repo
 *   nanoprym repo list                   # show all repos
 *   nanoprym repo remove <name>          # unregister + optionally delete
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ProjectManager, type ProjectConfig } from '../config/project.config.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('repo-manager');

function getNanoprymHome(): string {
  return path.resolve(process.env.HOME ?? '~', '.nanoprym');
}

function getReposDir(): string {
  return path.join(getNanoprymHome(), 'repos');
}

export interface RepoInfo {
  name: string;
  repoPath: string;
  repoUrl?: string;
  cloned: boolean;
  createdAt: string;
}

export class RepoManager {
  private projectManager: ProjectManager;
  private reposDir: string;

  constructor() {
    this.reposDir = getReposDir();
    this.projectManager = new ProjectManager();
    if (!fs.existsSync(this.reposDir)) {
      fs.mkdirSync(this.reposDir, { recursive: true });
    }
  }

  /**
   * Add a repo — either clone from URL or register a local path.
   * Returns the project config with isolated paths.
   */
  async add(urlOrPath: string, options?: { name?: string }): Promise<RepoInfo> {
    const isUrl = urlOrPath.startsWith('http') || urlOrPath.startsWith('git@') || urlOrPath.includes('github.com');

    let repoPath: string;
    let repoUrl: string | undefined;
    let name: string;

    if (isUrl) {
      repoUrl = urlOrPath;
      name = options?.name ?? this.extractRepoName(urlOrPath);

      // Check if already registered
      const existing = this.projectManager.get(name);
      if (existing) {
        throw new Error(`Repo "${name}" is already registered at ${existing.repoPath}`);
      }

      repoPath = path.join(this.reposDir, name);

      if (fs.existsSync(repoPath)) {
        log.info('Repo directory already exists, pulling latest', { name, repoPath });
        this.gitPull(repoPath);
      } else {
        log.info('Cloning repo', { url: repoUrl, dest: repoPath });
        this.gitClone(repoUrl, repoPath);
      }
    } else {
      // Local path — resolve and validate
      repoPath = path.resolve(urlOrPath);
      if (!fs.existsSync(repoPath)) {
        throw new Error(`Path does not exist: ${repoPath}`);
      }
      if (!fs.existsSync(path.join(repoPath, '.git'))) {
        throw new Error(`Not a git repository: ${repoPath}`);
      }

      name = options?.name ?? path.basename(repoPath);

      const existing = this.projectManager.get(name);
      if (existing) {
        throw new Error(`Repo "${name}" is already registered at ${existing.repoPath}`);
      }

      // Try to extract remote URL
      try {
        repoUrl = execSync('git remote get-url origin', { cwd: repoPath, timeout: 5_000 })
          .toString().trim();
      } catch {
        // No remote — that's fine
      }
    }

    // Register in ProjectManager (creates project dirs, brain, etc.)
    this.projectManager.register(name, repoPath, repoUrl);

    const info: RepoInfo = {
      name,
      repoPath,
      repoUrl,
      cloned: isUrl,
      createdAt: new Date().toISOString(),
    };

    log.info('Repo added', { name, repoPath, repoUrl });
    return info;
  }

  /** List all registered repos with their status */
  list(): RepoInfo[] {
    return this.projectManager.list().map(p => ({
      name: p.name,
      repoPath: p.repoPath,
      repoUrl: p.repoUrl,
      cloned: p.repoPath.startsWith(this.reposDir),
      createdAt: p.createdAt,
    }));
  }

  /** Get a specific repo by name */
  get(name: string): RepoInfo | undefined {
    const project = this.projectManager.get(name);
    if (!project) return undefined;
    return {
      name: project.name,
      repoPath: project.repoPath,
      repoUrl: project.repoUrl,
      cloned: project.repoPath.startsWith(this.reposDir),
      createdAt: project.createdAt,
    };
  }

  /** Get the ProjectConfig (with ledger/KB paths) for a repo */
  getProjectConfig(name: string): ProjectConfig | undefined {
    return this.projectManager.get(name);
  }

  /** Remove a repo — unregister and optionally delete cloned files */
  remove(name: string, options?: { deleteFiles?: boolean }): void {
    const project = this.projectManager.get(name);
    if (!project) {
      throw new Error(`Repo "${name}" is not registered`);
    }

    // Delete cloned repo files if requested and it's inside our repos dir
    if (options?.deleteFiles && project.repoPath.startsWith(this.reposDir)) {
      log.info('Deleting cloned repo', { name, path: project.repoPath });
      fs.rmSync(project.repoPath, { recursive: true, force: true });
    }

    // Delete project config/data
    const projectDir = path.join(getNanoprymHome(), 'projects', name);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }

    log.info('Repo removed', { name });
  }

  /** Check if a repo's working directory still exists */
  exists(name: string): boolean {
    const project = this.projectManager.get(name);
    if (!project) return false;
    return fs.existsSync(project.repoPath) && fs.existsSync(path.join(project.repoPath, '.git'));
  }

  /** Resolve a repo name to its absolute path */
  resolve(name: string): string {
    const project = this.projectManager.get(name);
    if (!project) {
      throw new Error(`Repo "${name}" is not registered. Run: nanoprym repo add <url|path>`);
    }
    if (!fs.existsSync(project.repoPath)) {
      throw new Error(`Repo "${name}" path no longer exists: ${project.repoPath}`);
    }
    return project.repoPath;
  }

  /** Get the repos base directory */
  static getReposDir(): string {
    return getReposDir();
  }

  private gitClone(url: string, dest: string): void {
    execSync(`git clone ${url} ${dest}`, {
      timeout: 120_000,
      stdio: 'inherit',
    });
  }

  private gitPull(repoPath: string): void {
    execSync('git pull --ff-only', {
      cwd: repoPath,
      timeout: 30_000,
      stdio: 'inherit',
    });
  }

  private extractRepoName(url: string): string {
    // Handle: https://github.com/user/repo.git, git@github.com:user/repo.git
    const match = url.match(/\/([^/]+?)(?:\.git)?$/);
    if (!match) {
      throw new Error(`Cannot extract repo name from URL: ${url}`);
    }
    return match[1];
  }
}
