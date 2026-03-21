/**
 * Project Config — Multi-project isolation
 * Each managed project gets its own brain, KB, and config.
 *
 * Structure:
 *   ~/.nanoprym/projects/{project-name}/
 *     project.brain.md    (L1 brain)
 *     modules/            (L2 module brains)
 *     kb/                 (project-specific KB)
 *     ledgers/            (task event ledgers)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('project-config');

function defaultProjectsDir(): string {
  return path.resolve(process.env.HOME ?? '~', '.nanoprym', 'projects');
}

export interface ProjectConfig {
  name: string;
  repoPath: string;
  repoUrl?: string;
  brainPath: string;
  kbPath: string;
  ledgerPath: string;
  createdAt: string;
}

export class ProjectManager {
  private projects: Map<string, ProjectConfig> = new Map();
  private projectsDir: string;

  constructor(baseDir?: string) {
    this.projectsDir = baseDir ?? defaultProjectsDir();
    this.loadProjects();
  }

  /** Register a new project */
  register(name: string, repoPath: string, repoUrl?: string): ProjectConfig {
    const projectDir = path.join(this.projectsDir, name);
    const brainPath = path.join(projectDir, 'project.brain.md');
    const kbPath = path.join(projectDir, 'kb');
    const ledgerPath = path.join(projectDir, 'ledgers');

    // Create directory structure
    for (const dir of [projectDir, kbPath, ledgerPath, path.join(projectDir, 'modules')]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    // Create default project brain if not exists
    if (!fs.existsSync(brainPath)) {
      fs.writeFileSync(brainPath, [
        `# ${name} Project Brain (L1)`,
        '',
        '## Architecture',
        '- (describe project architecture here)',
        '',
        '## Patterns',
        '- (describe coding patterns here)',
        '',
        '## Decisions',
        '- (log project-specific decisions here)',
        '',
      ].join('\n'));
    }

    const config: ProjectConfig = {
      name,
      repoPath: path.resolve(repoPath),
      repoUrl,
      brainPath,
      kbPath,
      ledgerPath,
      createdAt: new Date().toISOString(),
    };

    // Save project config
    fs.writeFileSync(
      path.join(projectDir, 'project.json'),
      JSON.stringify(config, null, 2),
    );

    this.projects.set(name, config);
    log.info('Project registered', { name, repoPath });
    return config;
  }

  /** Get a project by name */
  get(name: string): ProjectConfig | undefined {
    return this.projects.get(name);
  }

  /** List all registered projects */
  list(): ProjectConfig[] {
    return Array.from(this.projects.values());
  }

  /** Load all projects from disk */
  private loadProjects(): void {
    if (!fs.existsSync(this.projectsDir)) return;

    const dirs = fs.readdirSync(this.projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of dirs) {
      const configPath = path.join(this.projectsDir, dir.name, 'project.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProjectConfig;
          this.projects.set(config.name, config);
        } catch {
          log.warn('Failed to load project config', { name: dir.name });
        }
      }
    }

    log.info('Projects loaded', { count: this.projects.size });
  }
}
