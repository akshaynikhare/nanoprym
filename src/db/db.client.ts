/**
 * Database Client — SQLite (Phase 1) with PostgreSQL migration path (Phase 2)
 *
 * Uses sql.js (WASM) for portability.
 * Provides typed query helpers for metrics, costs, and audit data.
 */
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('db-client');

const DEFAULT_DB_PATH = path.resolve(process.env.HOME ?? '~', '.nanoprym', 'nanoprym.db');

export class DatabaseClient {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;

  private constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  static async create(dbPath: string = DEFAULT_DB_PATH): Promise<DatabaseClient> {
    const SQL = await initSqlJs();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let db: SqlJsDatabase;
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    const client = new DatabaseClient(db, dbPath);
    client.runMigrations();
    log.info('Database opened', { path: dbPath });
    return client;
  }

  /** Run all migrations */
  private runMigrations(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        complexity TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        issue_number INTEGER,
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        metric_type TEXT NOT NULL,
        value REAL NOT NULL,
        metadata TEXT,
        recorded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cost_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        recorded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompt_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        version TEXT NOT NULL,
        tasks_run INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 0,
        human_corrections INTEGER DEFAULT 0,
        avg_iterations REAL DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learned_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_type TEXT NOT NULL,
        description TEXT NOT NULL,
        source_signals TEXT,
        signal_count INTEGER DEFAULT 1,
        active INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_task ON metrics(task_id);
      CREATE INDEX IF NOT EXISTS idx_cost_task ON cost_tracking(task_id);
      CREATE INDEX IF NOT EXISTS idx_cost_provider ON cost_tracking(provider, recorded_at);
    `);
  }

  /** Execute raw SQL */
  exec(sql: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(sql);
    this.persist();
  }

  /** Query and return rows */
  query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | null)[]);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  /** Insert and return last rowid */
  insert(sql: string, params: unknown[] = []): number {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(sql, params as (string | number | null)[]);
    this.persist();
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    return result[0]?.values[0]?.[0] as number ?? 0;
  }

  close(): void {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
    }
    log.info('Database closed');
  }

  private persist(): void {
    if (!this.db) return;
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }
}
