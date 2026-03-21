/**
 * Inbox Watcher — Watches ~/.nanoprym/inbox.md for human decisions
 *
 * Format expected in inbox.md:
 *
 *   ## Decision: <taskId>
 *   Action: approve | reject | comment
 *   ---
 *   <optional comment text>
 *
 * Multiple decisions can be stacked. Once parsed, the watcher
 * publishes HUMAN_DECISION events and clears processed entries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../_shared/logger.js';
import { CONFIG_DIR } from '../_shared/constants.js';
import type { EventBus } from './event-bus.js';

const log = createChildLogger('inbox-watcher');

const INBOX_FILENAME = 'inbox.md';
const POLL_INTERVAL_MS = 3_000;

export interface InboxDecision {
  taskId: string;
  action: 'approve' | 'reject' | 'comment';
  comment: string;
}

export class InboxWatcher {
  private inboxPath: string;
  private bus: EventBus | null = null;
  private watcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastMtime: number = 0;
  private processing = false;

  constructor(configDir?: string) {
    const baseDir = path.resolve(process.env.HOME ?? '~', configDir ?? CONFIG_DIR);
    this.inboxPath = path.join(baseDir, INBOX_FILENAME);

    // Ensure inbox file exists
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.inboxPath)) {
      fs.writeFileSync(this.inboxPath, this.getTemplate());
    }
  }

  /** Attach event bus and start watching */
  start(bus: EventBus): void {
    this.bus = bus;

    // Try fs.watch first, fall back to polling
    try {
      this.watcher = fs.watch(this.inboxPath, { persistent: false }, (_event) => {
        this.onFileChanged();
      });
      log.info('Watching inbox.md (fs.watch)', { path: this.inboxPath });
    } catch {
      log.info('fs.watch unavailable, using polling', { path: this.inboxPath });
    }

    // Always poll as backup (fs.watch can be unreliable)
    this.pollTimer = setInterval(() => this.checkForChanges(), POLL_INTERVAL_MS);

    // Process any existing decisions on startup
    this.onFileChanged();
  }

  /** Stop watching */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.bus = null;
    log.info('Inbox watcher stopped');
  }

  /** Check if file was modified since last check */
  private checkForChanges(): void {
    try {
      const stat = fs.statSync(this.inboxPath);
      const mtime = stat.mtimeMs;
      if (mtime > this.lastMtime) {
        this.lastMtime = mtime;
        this.onFileChanged();
      }
    } catch {
      // File may not exist yet
    }
  }

  /** Handle file change — parse decisions and publish events */
  private async onFileChanged(): Promise<void> {
    if (this.processing || !this.bus) return;
    this.processing = true;

    try {
      const content = fs.readFileSync(this.inboxPath, 'utf-8');
      const decisions = this.parseDecisions(content);

      if (decisions.length === 0) {
        this.processing = false;
        return;
      }

      log.info('Decisions found in inbox', { count: decisions.length });

      for (const decision of decisions) {
        this.bus.publish({
          taskId: decision.taskId,
          topic: 'HUMAN_DECISION',
          sender: 'inbox-watcher',
          content: {
            text: decision.comment || `Human ${decision.action}`,
            data: {
              action: decision.action,
              source: 'inbox.md',
            },
          },
        });

        log.info('Decision published', { taskId: decision.taskId, action: decision.action });
      }

      // Clear processed decisions, keep template
      fs.writeFileSync(this.inboxPath, this.getTemplate());
      this.lastMtime = fs.statSync(this.inboxPath).mtimeMs;
    } catch (err) {
      log.error('Failed to process inbox', { error: String(err) });
    }

    this.processing = false;
  }

  /** Parse inbox.md content into decisions */
  parseDecisions(content: string): InboxDecision[] {
    const decisions: InboxDecision[] = [];
    const blocks = content.split(/^## Decision:/m).slice(1);

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length === 0) continue;

      // First line is the taskId
      const taskId = lines[0].trim();
      if (!taskId) continue;

      // Find action line
      let action: InboxDecision['action'] = 'comment';
      const commentLines: string[] = [];
      let pastSeparator = false;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('Action:')) {
          const val = line.slice('Action:'.length).trim().toLowerCase();
          if (val === 'approve' || val === 'reject' || val === 'comment') {
            action = val;
          }
          continue;
        }

        if (line === '---') {
          pastSeparator = true;
          continue;
        }

        if (pastSeparator && line) {
          commentLines.push(line);
        }
      }

      decisions.push({
        taskId,
        action,
        comment: commentLines.join('\n'),
      });
    }

    return decisions;
  }

  /** Get the template content for inbox.md */
  private getTemplate(): string {
    return `# Nanoprym Inbox

Add decisions below. The watcher will pick them up automatically.

<!-- Example:
## Decision: abc12345
Action: approve
---
Looks good, merge it.
-->
`;
  }
}
