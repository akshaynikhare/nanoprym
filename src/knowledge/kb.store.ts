/**
 * Knowledge Base Store — Triple-sync: Git (source of truth) → Qdrant + SQLite/PG
 *
 * KB entries are markdown files in .nanoprym/kb/{category}/KB-{N}-{slug}.md
 * On write: commit to Git first, then async index to Qdrant + DB
 * On read: search Qdrant for semantic matches, fall back to text search
 *
 * Categories: bugs, decisions, patterns, failed-approaches, inspirations, corrections
 */
import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../_shared/logger.js';
import { KB_DIR } from '../_shared/constants.js';
// generateId, hashString available from utils

const log = createChildLogger('kb-store');

export type KBCategory = 'bugs' | 'decisions' | 'patterns' | 'failed-approaches' | 'inspirations' | 'corrections';

export interface KBEntry {
  id: string;
  category: KBCategory;
  slug: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  filePath: string;
}

const KB_CATEGORIES: KBCategory[] = ['bugs', 'decisions', 'patterns', 'failed-approaches', 'inspirations', 'corrections'];

export class KBStore {
  private baseDir: string;
  private entries: Map<string, KBEntry> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(process.env.HOME ?? '~', baseDir ?? KB_DIR);
    this.ensureDirectories();
    this.loadIndex();
  }

  /** Add a new KB entry */
  add(params: {
    category: KBCategory;
    title: string;
    content: string;
    tags?: string[];
  }): KBEntry {
    const id = this.nextId();
    const slug = this.slugify(params.title);
    const filename = `KB-${id}-${slug}.md`;
    const filePath = path.join(this.baseDir, params.category, filename);

    const now = new Date().toISOString();
    const markdown = this.renderMarkdown({
      id,
      title: params.title,
      category: params.category,
      tags: params.tags ?? [],
      content: params.content,
      createdAt: now,
    });

    fs.writeFileSync(filePath, markdown, 'utf-8');

    const entry: KBEntry = {
      id,
      category: params.category,
      slug,
      title: params.title,
      content: params.content,
      tags: params.tags ?? [],
      createdAt: now,
      updatedAt: now,
      filePath,
    };

    this.entries.set(id, entry);
    log.info('KB entry added', { id, category: params.category, title: params.title });

    return entry;
  }

  /** Search KB entries by text (grep-style, for MVP) */
  search(query: string, category?: KBCategory): KBEntry[] {
    const queryLower = query.toLowerCase();
    const results: KBEntry[] = [];

    for (const entry of this.entries.values()) {
      if (category && entry.category !== category) continue;

      const searchable = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase();
      if (searchable.includes(queryLower)) {
        results.push(entry);
      }
    }

    return results;
  }

  /** Get entry by ID */
  get(id: string): KBEntry | undefined {
    return this.entries.get(id);
  }

  /** List all entries, optionally filtered by category */
  list(category?: KBCategory): KBEntry[] {
    const all = Array.from(this.entries.values());
    if (category) return all.filter(e => e.category === category);
    return all;
  }

  /** Get stats */
  stats(): { total: number; byCategory: Record<string, number> } {
    const byCategory: Record<string, number> = {};
    for (const cat of KB_CATEGORIES) {
      byCategory[cat] = this.list(cat).length;
    }
    return { total: this.entries.size, byCategory };
  }

  // ── Internal ─────────────────────────────────────────────

  private ensureDirectories(): void {
    for (const cat of KB_CATEGORIES) {
      const dir = path.join(this.baseDir, cat);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /** Scan the KB directory and load all entries into memory */
  private loadIndex(): void {
    this.entries.clear();
    for (const cat of KB_CATEGORIES) {
      const dir = path.join(this.baseDir, cat);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const entry = this.parseFile(filePath, cat);
          if (entry) this.entries.set(entry.id, entry);
        } catch (err) {
          log.warn('Failed to parse KB file', { file, error: String(err) });
        }
      }
    }
    log.info('KB index loaded', { entries: this.entries.size });
  }

  /** Parse a KB markdown file into a KBEntry */
  private parseFile(filePath: string, category: KBCategory): KBEntry | null {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const filename = path.basename(filePath);

    // Extract ID from filename: KB-{id}-{slug}.md
    const match = filename.match(/^KB-(\d+)-(.+)\.md$/);
    if (!match) return null;

    const id = match[1];
    const slug = match[2];

    // Parse frontmatter-style metadata from first lines
    const lines = raw.split('\n');
    let title = slug;
    let tags: string[] = [];
    let createdAt = '';
    let contentStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('# ')) {
        title = line.slice(2).trim();
        contentStart = i + 1;
      } else if (line.startsWith('Tags:')) {
        tags = line.slice(5).split(',').map(t => t.trim()).filter(Boolean);
      } else if (line.startsWith('Created:')) {
        createdAt = line.slice(8).trim();
      } else if (line === '---' && i > 0) {
        contentStart = i + 1;
        break;
      }
    }

    const content = lines.slice(contentStart).join('\n').trim();

    return {
      id, category, slug, title, content, tags,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: createdAt || new Date().toISOString(),
      filePath,
    };
  }

  private renderMarkdown(params: {
    id: string; title: string; category: string; tags: string[];
    content: string; createdAt: string;
  }): string {
    return [
      `# ${params.title}`,
      '',
      `ID: KB-${params.id}`,
      `Category: ${params.category}`,
      `Tags: ${params.tags.join(', ')}`,
      `Created: ${params.createdAt}`,
      '',
      '---',
      '',
      params.content,
      '',
    ].join('\n');
  }

  private nextId(): string {
    const existing = Array.from(this.entries.keys()).map(k => parseInt(k, 10)).filter(n => !isNaN(n));
    const max = existing.length > 0 ? Math.max(...existing) : 0;
    return String(max + 1).padStart(4, '0');
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }
}
