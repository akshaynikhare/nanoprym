/**
 * Event Ledger — SQLite-backed immutable event store
 * Every agent action is a message in the ledger.
 * Crash recovery = replay ledger events.
 *
 * Uses sql.js (WASM SQLite) for portability — no native compilation needed.
 * On the target MacBook, can swap to better-sqlite3 for performance.
 */
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { Message, MessageTopic } from '../_shared/types.js';
import { generateId } from '../_shared/utils.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('event-ledger');

export class EventLedger {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private closed = false;

  private constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  static async create(dbPath: string): Promise<EventLedger> {
    const SQL = await initSqlJs();

    let db: SqlJsDatabase;
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      db = new SQL.Database();
    }

    const ledger = new EventLedger(db, dbPath);
    ledger.initialize();
    log.info('Ledger opened', { path: dbPath });
    return ledger;
  }

  private initialize(): void {
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        sender TEXT NOT NULL,
        content_text TEXT,
        content_data TEXT,
        metadata TEXT,
        timestamp TEXT NOT NULL
      )
    `);
    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_messages_task_topic ON messages(task_id, topic, timestamp)`);
    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(task_id, sender, timestamp)`);
  }

  append(message: Omit<Message, 'id' | 'timestamp'>): Message | null {
    if (this.closed || !this.db) {
      log.warn('Attempted write after close');
      return null;
    }

    const fullMessage: Message = {
      ...message,
      id: generateId(),
      timestamp: new Date(),
    };

    this.db.run(
      `INSERT INTO messages (id, task_id, topic, sender, content_text, content_data, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullMessage.id,
        fullMessage.taskId,
        fullMessage.topic,
        fullMessage.sender,
        fullMessage.content.text,
        fullMessage.content.data ? JSON.stringify(fullMessage.content.data) : null,
        fullMessage.metadata ? JSON.stringify(fullMessage.metadata) : null,
        fullMessage.timestamp.toISOString(),
      ]
    );

    this.persist();
    return fullMessage;
  }

  query(options: {
    taskId?: string;
    topic?: MessageTopic;
    sender?: string;
    since?: string;
    limit?: number;
    order?: 'ASC' | 'DESC';
  }): Message[] {
    if (!this.db) return [];

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.taskId) { conditions.push('task_id = ?'); params.push(options.taskId); }
    if (options.topic) { conditions.push('topic = ?'); params.push(options.topic); }
    if (options.sender) { conditions.push('sender = ?'); params.push(options.sender); }
    if (options.since) { conditions.push('timestamp > ?'); params.push(options.since); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = options.order ?? 'ASC';
    const limit = options.limit ? `LIMIT ${options.limit}` : '';

    const stmt = this.db.prepare(`SELECT * FROM messages ${where} ORDER BY rowid ${order} ${limit}`);
    stmt.bind(params);

    const results: Message[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, string | number | null>;
      results.push(this.rowToMessage(row));
    }
    stmt.free();

    return results;
  }

  findLast(options: { taskId?: string; topic?: MessageTopic }): Message | undefined {
    const results = this.query({ ...options, limit: 1, order: 'DESC' });
    return results[0];
  }

  count(options: { taskId?: string; topic?: MessageTopic }): number {
    if (!this.db) return 0;

    const conditions: string[] = [];
    const params: string[] = [];

    if (options.taskId) { conditions.push('task_id = ?'); params.push(options.taskId); }
    if (options.topic) { conditions.push('topic = ?'); params.push(options.topic); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM messages ${where}`);
    stmt.bind(params);
    stmt.step();
    const row = stmt.getAsObject() as { count: number };
    stmt.free();
    return row.count;
  }

  close(): void {
    if (this.db && !this.closed) {
      this.persist();
      this.db.close();
    }
    this.closed = true;
    this.db = null;
    log.info('Ledger closed');
  }

  private persist(): void {
    if (!this.db || this.closed) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  private rowToMessage(row: Record<string, string | number | null>): Message {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      topic: String(row.topic) as MessageTopic,
      sender: String(row.sender),
      content: {
        text: row.content_text ? String(row.content_text) : '',
        data: row.content_data ? JSON.parse(String(row.content_data)) : undefined,
      },
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
      timestamp: new Date(String(row.timestamp)),
    };
  }
}
