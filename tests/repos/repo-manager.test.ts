/**
 * RepoManager Tests
 * Tests repo add (local), list, get, remove, resolve, exists
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RepoManager } from '../../src/repos/repo.manager.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

describe('RepoManager', () => {
  let testBase: string;
  let fakeRepoPath: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Unique temp dir per test to avoid cross-test state
    testBase = path.join(os.tmpdir(), `nanoprym-repo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    originalHome = process.env.HOME;
    process.env.HOME = testBase;
    fs.mkdirSync(testBase, { recursive: true });

    // Create a fake git repo to register
    fakeRepoPath = path.join(testBase, 'fake-repo');
    fs.mkdirSync(fakeRepoPath, { recursive: true });
    execSync('git init', { cwd: fakeRepoPath, stdio: 'ignore' });
    execSync('git commit --allow-empty -m "init"', { cwd: fakeRepoPath, stdio: 'ignore' });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(testBase, { recursive: true, force: true });
  });

  it('should add a local repo', async () => {
    const manager = new RepoManager();
    const info = await manager.add(fakeRepoPath, { name: 'test-repo' });

    expect(info.name).toBe('test-repo');
    expect(info.repoPath).toBe(fakeRepoPath);
    expect(info.cloned).toBe(false);
  });

  it('should list registered repos', async () => {
    const manager = new RepoManager();
    await manager.add(fakeRepoPath, { name: 'repo-a' });

    const list = manager.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('repo-a');
  });

  it('should get a repo by name', async () => {
    const manager = new RepoManager();
    await manager.add(fakeRepoPath, { name: 'my-repo' });

    const info = manager.get('my-repo');
    expect(info).toBeDefined();
    expect(info!.name).toBe('my-repo');
    expect(info!.repoPath).toBe(fakeRepoPath);
  });

  it('should return undefined for unknown repo', () => {
    const manager = new RepoManager();
    expect(manager.get('nonexistent')).toBeUndefined();
  });

  it('should resolve a repo name to its path', async () => {
    const manager = new RepoManager();
    await manager.add(fakeRepoPath, { name: 'resolvable' });

    const resolved = manager.resolve('resolvable');
    expect(resolved).toBe(fakeRepoPath);
  });

  it('should throw when resolving unknown repo', () => {
    const manager = new RepoManager();
    expect(() => manager.resolve('nope')).toThrow(/not registered/);
  });

  it('should check if a repo exists on disk', async () => {
    const manager = new RepoManager();
    await manager.add(fakeRepoPath, { name: 'exists-check' });

    expect(manager.exists('exists-check')).toBe(true);
    expect(manager.exists('ghost')).toBe(false);
  });

  it('should remove a repo', async () => {
    const manager = new RepoManager();
    await manager.add(fakeRepoPath, { name: 'removable' });

    manager.remove('removable');

    const fresh = new RepoManager();
    expect(fresh.get('removable')).toBeUndefined();
  });

  it('should throw when adding duplicate repo name', async () => {
    const manager = new RepoManager();
    await manager.add(fakeRepoPath, { name: 'dupe' });

    await expect(manager.add(fakeRepoPath, { name: 'dupe' })).rejects.toThrow(/already registered/);
  });

  it('should throw when adding non-git directory', async () => {
    const plainDir = path.join(testBase, 'not-a-repo');
    fs.mkdirSync(plainDir, { recursive: true });

    const manager = new RepoManager();
    await expect(manager.add(plainDir)).rejects.toThrow(/Not a git repository/);
  });

  it('should throw when removing unknown repo', () => {
    const manager = new RepoManager();
    expect(() => manager.remove('ghost')).toThrow(/not registered/);
  });

  it('should create project config with brain, kb, ledgers', async () => {
    const manager = new RepoManager();
    await manager.add(fakeRepoPath, { name: 'with-project' });

    const projectConfig = manager.getProjectConfig('with-project');
    expect(projectConfig).toBeDefined();
    expect(fs.existsSync(projectConfig!.brainPath)).toBe(true);
    expect(fs.existsSync(projectConfig!.kbPath)).toBe(true);
    expect(fs.existsSync(projectConfig!.ledgerPath)).toBe(true);
  });

  it('should default name to directory basename for local paths', async () => {
    const manager = new RepoManager();
    const info = await manager.add(fakeRepoPath);

    expect(info.name).toBe('fake-repo');
  });

  it('should persist across instances', async () => {
    const manager1 = new RepoManager();
    await manager1.add(fakeRepoPath, { name: 'persistent' });

    const manager2 = new RepoManager();
    const info = manager2.get('persistent');
    expect(info).toBeDefined();
    expect(info!.name).toBe('persistent');
  });
});
