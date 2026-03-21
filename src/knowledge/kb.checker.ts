/**
 * KB Consistency Checker — Validates Git KB files against Qdrant vectors
 *
 * Git markdown files (.nanoprym/kb/) are the source of truth.
 * This checker detects:
 *   - Missing vectors (Git file exists, no Qdrant point)
 *   - Orphaned vectors (Qdrant point exists, no Git file)
 *   - Stale vectors (content hash mismatch)
 *
 * Can auto-repair by re-indexing missing and removing orphans.
 */
import { createChildLogger } from '../_shared/logger.js';
import { KBStore, type KBEntry } from './kb.store.js';
import { KBVectorStore } from './kb.vector.js';
import crypto from 'node:crypto';

const log = createChildLogger('kb-checker');

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const COLLECTION_NAME = 'nanoprym-kb';

export interface ConsistencyReport {
  timestamp: string;
  gitEntries: number;
  qdrantPoints: number;
  missing: string[];       // IDs in Git but not in Qdrant
  orphaned: string[];      // IDs in Qdrant but not in Git
  stale: string[];         // IDs where content hash differs
  healthy: number;
  repaired: number;
  errors: string[];
}

export class KBConsistencyChecker {
  private store: KBStore;
  private vector: KBVectorStore;

  constructor(store?: KBStore, vector?: KBVectorStore) {
    this.store = store ?? new KBStore();
    this.vector = vector ?? new KBVectorStore();
  }

  /** Run a full consistency check (read-only) */
  async check(): Promise<ConsistencyReport> {
    const report: ConsistencyReport = {
      timestamp: new Date().toISOString(),
      gitEntries: 0,
      qdrantPoints: 0,
      missing: [],
      orphaned: [],
      stale: [],
      healthy: 0,
      repaired: 0,
      errors: [],
    };

    // 1. Load all Git KB entries
    const gitEntries = this.store.list();
    report.gitEntries = gitEntries.length;
    const gitIds = new Set(gitEntries.map(e => e.id));

    // 2. Load all Qdrant point IDs + payloads
    const qdrantPoints = await this.scrollAllPoints();
    report.qdrantPoints = qdrantPoints.size;

    // 3. Find missing vectors (in Git, not in Qdrant)
    for (const id of gitIds) {
      if (!qdrantPoints.has(id)) {
        report.missing.push(id);
      }
    }

    // 4. Find orphaned vectors (in Qdrant, not in Git)
    for (const id of qdrantPoints.keys()) {
      if (!gitIds.has(id)) {
        report.orphaned.push(id);
      }
    }

    // 5. Check for stale vectors (content hash mismatch)
    for (const entry of gitEntries) {
      const point = qdrantPoints.get(entry.id);
      if (!point) continue; // already counted as missing

      const gitHash = this.hashContent(entry);
      const qdrantHash = point.contentHash as string | undefined;
      if (qdrantHash && qdrantHash !== gitHash) {
        report.stale.push(entry.id);
      }
    }

    report.healthy = report.gitEntries - report.missing.length - report.stale.length;

    log.info('Consistency check complete', {
      git: report.gitEntries,
      qdrant: report.qdrantPoints,
      missing: report.missing.length,
      orphaned: report.orphaned.length,
      stale: report.stale.length,
      healthy: report.healthy,
    });

    return report;
  }

  /** Run check + auto-repair: re-index missing/stale, remove orphans */
  async sync(): Promise<ConsistencyReport> {
    const report = await this.check();

    // Re-index missing entries
    for (const id of report.missing) {
      const entry = this.store.get(id);
      if (!entry) continue;

      try {
        const text = `${entry.title}\n${entry.content}`;
        const ok = await this.vector.upsert(id, text, {
          category: entry.category,
          title: entry.title,
          tags: entry.tags,
          contentHash: this.hashContent(entry),
        });
        if (ok) report.repaired++;
        else report.errors.push(`Failed to index ${id}`);
      } catch (err) {
        report.errors.push(`Error indexing ${id}: ${String(err)}`);
      }
    }

    // Re-index stale entries
    for (const id of report.stale) {
      const entry = this.store.get(id);
      if (!entry) continue;

      try {
        const text = `${entry.title}\n${entry.content}`;
        const ok = await this.vector.upsert(id, text, {
          category: entry.category,
          title: entry.title,
          tags: entry.tags,
          contentHash: this.hashContent(entry),
        });
        if (ok) report.repaired++;
        else report.errors.push(`Failed to re-index stale ${id}`);
      } catch (err) {
        report.errors.push(`Error re-indexing ${id}: ${String(err)}`);
      }
    }

    // Remove orphaned points from Qdrant
    for (const id of report.orphaned) {
      try {
        await this.deletePoint(id);
        report.repaired++;
      } catch (err) {
        report.errors.push(`Error removing orphan ${id}: ${String(err)}`);
      }
    }

    log.info('Sync complete', { repaired: report.repaired, errors: report.errors.length });
    return report;
  }

  /** Scroll all points from Qdrant collection */
  private async scrollAllPoints(): Promise<Map<string, Record<string, unknown>>> {
    const points = new Map<string, Record<string, unknown>>();

    const available = await this.vector.isAvailable();
    if (!available) {
      log.warn('Qdrant not available, skipping vector check');
      return points;
    }

    let offset: string | number | null = null;
    const limit = 100;

     
    while (true) {
      try {
        const body: Record<string, unknown> = { limit, with_payload: true };
        if (offset !== null) body.offset = offset;

        const resp = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!resp.ok) break;

        const data = await resp.json() as {
          result: {
            points: Array<{ id: string | number; payload: Record<string, unknown> }>;
            next_page_offset: string | number | null;
          };
        };

        for (const point of data.result.points) {
          points.set(String(point.id), point.payload);
        }

        offset = data.result.next_page_offset;
        if (offset === null || offset === undefined) break;
      } catch (err) {
        log.warn('Qdrant scroll failed', { error: String(err) });
        break;
      }
    }

    return points;
  }

  /** Delete a single point from Qdrant */
  private async deletePoint(id: string): Promise<void> {
    await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: [id] }),
    });
  }

  /** Hash KB entry content for staleness detection */
  private hashContent(entry: KBEntry): string {
    return crypto.createHash('sha256')
      .update(`${entry.title}\n${entry.content}\n${entry.tags.join(',')}`)
      .digest('hex')
      .slice(0, 16);
  }
}
