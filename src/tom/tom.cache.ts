/**
 * TOM Template Cache — Deduplicates repeated prompts
 * SHA-256 hash of normalized prompt → cached compressed version
 * TTL: 24 hours, configurable
 */
import { createHash } from 'node:crypto';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('tom-cache');

interface CacheEntry {
  compressed: string;
  originalChars: number;
  compressedChars: number;
  ratio: number;
  hitCount: number;
  lastHitAt: number;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class TomCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Try to get a cached compressed version */
  get(text: string): { text: string; ratio: number } | null {
    const key = this.hash(text);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    entry.hitCount++;
    entry.lastHitAt = Date.now();
    return { text: entry.compressed, ratio: entry.ratio };
  }

  /** Store a compressed result */
  set(originalText: string, compressedText: string): void {
    const key = this.hash(originalText);
    const originalChars = originalText.length;
    const compressedChars = compressedText.length;
    const ratio = originalChars > 0 ? 1 - (compressedChars / originalChars) : 0;

    this.cache.set(key, {
      compressed: compressedText,
      originalChars,
      compressedChars,
      ratio,
      hitCount: 0,
      lastHitAt: Date.now(),
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Get cache stats */
  stats(): { size: number; totalHits: number; topTemplates: Array<{ hash: string; hits: number; ratio: number }> } {
    let totalHits = 0;
    const templates: Array<{ hash: string; hits: number; ratio: number }> = [];

    for (const [key, entry] of this.cache) {
      totalHits += entry.hitCount;
      templates.push({ hash: key.slice(0, 8), hits: entry.hitCount, ratio: entry.ratio });
    }

    templates.sort((a, b) => b.hits - a.hits);

    return {
      size: this.cache.size,
      totalHits,
      topTemplates: templates.slice(0, 10),
    };
  }

  /** Clear expired entries */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    if (removed > 0) log.debug('Cache cleanup', { removed, remaining: this.cache.size });
    return removed;
  }

  /** Clear all entries */
  clear(): void {
    this.cache.clear();
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }
}
