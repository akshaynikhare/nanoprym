import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KBStore } from '../../src/knowledge/kb.store.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('KBStore', () => {
  const testDir = path.join(os.tmpdir(), `nanoprym-kb-test-${Date.now()}`);
  let store: KBStore;

  beforeEach(() => {
    store = new KBStore(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should create KB directories', () => {
    expect(fs.existsSync(path.join(testDir, 'bugs'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'decisions'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'patterns'))).toBe(true);
  });

  it('should add a KB entry', () => {
    const entry = store.add({
      category: 'bugs',
      title: 'Null pointer in auth module',
      content: 'The auth module crashes when token is expired',
      tags: ['auth', 'null-pointer'],
    });

    expect(entry.id).toBe('0001');
    expect(entry.category).toBe('bugs');
    expect(entry.title).toBe('Null pointer in auth module');
    expect(fs.existsSync(entry.filePath)).toBe(true);
  });

  it('should auto-increment IDs', () => {
    store.add({ category: 'bugs', title: 'Bug 1', content: 'First' });
    store.add({ category: 'bugs', title: 'Bug 2', content: 'Second' });
    const third = store.add({ category: 'decisions', title: 'Decision 1', content: 'Third' });

    expect(third.id).toBe('0003');
  });

  it('should search by text', () => {
    store.add({ category: 'bugs', title: 'Auth crash', content: 'Token expired causes crash' });
    store.add({ category: 'patterns', title: 'Error handling', content: 'Always use try-catch' });
    store.add({ category: 'bugs', title: 'DB timeout', content: 'Connection pool exhausted' });

    const results = store.search('crash');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Auth crash');
  });

  it('should search by tag', () => {
    store.add({ category: 'bugs', title: 'Bug A', content: 'Content', tags: ['auth', 'critical'] });
    store.add({ category: 'bugs', title: 'Bug B', content: 'Content', tags: ['db'] });

    const results = store.search('auth');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Bug A');
  });

  it('should filter search by category', () => {
    store.add({ category: 'bugs', title: 'Token bug', content: 'token issue' });
    store.add({ category: 'patterns', title: 'Token pattern', content: 'token handling' });

    const bugsOnly = store.search('token', 'bugs');
    expect(bugsOnly).toHaveLength(1);
    expect(bugsOnly[0].category).toBe('bugs');
  });

  it('should list all entries', () => {
    store.add({ category: 'bugs', title: 'A', content: 'a' });
    store.add({ category: 'decisions', title: 'B', content: 'b' });

    expect(store.list()).toHaveLength(2);
    expect(store.list('bugs')).toHaveLength(1);
    expect(store.list('decisions')).toHaveLength(1);
  });

  it('should get stats', () => {
    store.add({ category: 'bugs', title: 'A', content: 'a' });
    store.add({ category: 'bugs', title: 'B', content: 'b' });
    store.add({ category: 'patterns', title: 'C', content: 'c' });

    const stats = store.stats();
    expect(stats.total).toBe(3);
    expect(stats.byCategory['bugs']).toBe(2);
    expect(stats.byCategory['patterns']).toBe(1);
  });

  it('should persist and reload from disk', () => {
    store.add({ category: 'bugs', title: 'Persistent bug', content: 'Should survive reload' });

    // Create new store pointing to same dir
    const store2 = new KBStore(testDir);
    const entries = store2.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Persistent bug');
  });
});
