/**
 * Changelog Generator Plugin — Generates changelog from conventional commits
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../../../_shared/logger.js';
import { nowISO } from '../../../_shared/utils.js';

const execAsync = promisify(exec);
const log = createChildLogger('plugin:changelog');

export class ChangelogGeneratorPlugin {
  readonly name = 'changelog-generator';
  readonly type = 'generator' as const;

  async generate(repoDir: string, since?: string): Promise<string> {
    const sinceArg = since ? `--since="${since}"` : '--since="1 week ago"';

    try {
      const { stdout } = await execAsync(
        `git log ${sinceArg} --pretty=format:"%s (%h)" --no-merges`,
        { cwd: repoDir, timeout: 10_000 },
      );

      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return '';

      const categories: Record<string, string[]> = {
        feat: [], fix: [], docs: [], refactor: [], test: [], chore: [], other: [],
      };

      for (const line of lines) {
        const match = line.match(/^(\w+)(?:\(.*?\))?:\s*(.+)$/);
        if (match) {
          const type = match[1] in categories ? match[1] : 'other';
          categories[type].push(match[2]);
        } else {
          categories['other'].push(line);
        }
      }

      const sections: string[] = [`## ${nowISO().slice(0, 10)}`, ''];
      const labels: Record<string, string> = {
        feat: 'Features', fix: 'Bug Fixes', docs: 'Documentation',
        refactor: 'Refactoring', test: 'Tests', chore: 'Chores', other: 'Other',
      };

      for (const [type, items] of Object.entries(categories)) {
        if (items.length === 0) continue;
        sections.push(`### ${labels[type] ?? type}`);
        for (const item of items) sections.push(`- ${item}`);
        sections.push('');
      }

      const changelog = sections.join('\n');

      // Prepend to CHANGELOG.md
      const changelogPath = path.join(repoDir, 'CHANGELOG.md');
      const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf-8') : '# Changelog\n';
      fs.writeFileSync(changelogPath, existing.replace('# Changelog\n', `# Changelog\n\n${changelog}`));

      log.info('Changelog generated', { entries: lines.length });
      return changelog;
    } catch (error) {
      log.warn('Changelog generation failed', { error: String(error) });
      return '';
    }
  }
}
