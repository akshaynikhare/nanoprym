import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KBConsistencyChecker } from '../../src/knowledge/kb.checker.js';
import { KBStore } from '../../src/knowledge/kb.store.js';
import { KBVectorStore } from '../../src/knowledge/kb.vector.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('KBConsistencyChecker', () => {
  const testDir = path.join(os.tmpdir(), `nanoprym-kbcheck-${Date.now()}`);
  let store: KBStore;
  let vector: KBVectorStore;
  let checker: KBConsistencyChecker;

  beforeEach(() => {
    store = new KBStore(testDir);
    vector = new KBVectorStore();
    checker = new KBConsistencyChecker(store, vector);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should report empty KB as consistent', async () => {
    // Mock Qdrant as unavailable — no vectors to compare
    vi.spyOn(vector, 'isAvailable').mockResolvedValue(false);

    const report = await checker.check();
    expect(report.gitEntries).toBe(0);
    expect(report.qdrantPoints).toBe(0);
    expect(report.missing).toHaveLength(0);
    expect(report.orphaned).toHaveLength(0);
    expect(report.stale).toHaveLength(0);
    expect(report.healthy).toBe(0);
  });

  it('should detect missing vectors when Qdrant is empty', async () => {
    store.add({ category: 'bugs', title: 'Bug A', content: 'content a' });
    store.add({ category: 'patterns', title: 'Pattern B', content: 'content b' });

    // Qdrant unavailable → 0 points
    vi.spyOn(vector, 'isAvailable').mockResolvedValue(false);

    const report = await checker.check();
    expect(report.gitEntries).toBe(2);
    expect(report.qdrantPoints).toBe(0);
    expect(report.missing).toHaveLength(2);
    expect(report.healthy).toBe(0);
  });

  it('should report healthy when all entries are synced', async () => {
    store.add({ category: 'bugs', title: 'Bug A', content: 'content a' });

    // Mock Qdrant scroll to return the same IDs (no hash check since no contentHash in payload)
    vi.spyOn(vector, 'isAvailable').mockResolvedValue(true);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          points: [{ id: '0001', payload: {} }],
          next_page_offset: null,
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const report = await checker.check();
    expect(report.gitEntries).toBe(1);
    expect(report.qdrantPoints).toBe(1);
    expect(report.missing).toHaveLength(0);
    expect(report.orphaned).toHaveLength(0);
    expect(report.healthy).toBe(1);

    vi.unstubAllGlobals();
  });

  it('should detect orphaned Qdrant points', async () => {
    // Git has no entries, but Qdrant has a point
    vi.spyOn(vector, 'isAvailable').mockResolvedValue(true);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          points: [{ id: 'orphan-1', payload: {} }],
          next_page_offset: null,
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const report = await checker.check();
    expect(report.gitEntries).toBe(0);
    expect(report.qdrantPoints).toBe(1);
    expect(report.orphaned).toEqual(['orphan-1']);

    vi.unstubAllGlobals();
  });

  it('should detect stale vectors with hash mismatch', async () => {
    store.add({ category: 'bugs', title: 'Bug A', content: 'original content' });

    vi.spyOn(vector, 'isAvailable').mockResolvedValue(true);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          points: [{ id: '0001', payload: { contentHash: 'stale-hash-value' } }],
          next_page_offset: null,
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const report = await checker.check();
    expect(report.stale).toEqual(['0001']);
    expect(report.healthy).toBe(0);

    vi.unstubAllGlobals();
  });

  it('should sync and repair missing entries', async () => {
    store.add({ category: 'bugs', title: 'Bug A', content: 'content a' });

    vi.spyOn(vector, 'isAvailable').mockResolvedValue(false);
    vi.spyOn(vector, 'upsert').mockResolvedValue(true);

    const report = await checker.sync();
    expect(report.missing).toHaveLength(1);
    expect(report.repaired).toBe(1);
    expect(vector.upsert).toHaveBeenCalledOnce();
  });
});
