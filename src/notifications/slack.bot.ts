/**
 * Slack Bot — Notifications, human-in-loop, and task creation via Slack
 *
 * Channels:
 * - #nanoprym-auto: auto-fix logs (bug/security/test)
 * - #nanoprym-decisions: needs approval (threaded)
 * - #nanoprym-failures: failed tasks with reports
 * - #nanoprym-daily: summary (only when something happened)
 *
 * Task creation:
 * - @mention nanoprym in any channel with a task description
 * - Bot replies in thread, asks which repo to target
 * - User replies with repo choice, task starts
 * - All lifecycle updates post to that thread
 *
 * Uses Bolt.js in Socket Mode for interactive approval workflows.
 * Falls back to legacy webhook posting if bot tokens are not configured.
 */
import { App, type BlockAction } from '@slack/bolt';
import type { EventBus } from '../core/event-bus.js';
import type { Message, TaskComplexity, TaskType } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('slack-bot');

const PENDING_MENTION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PENDING_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface SlackConfig {
  enabled: boolean;
  webhookUrl?: string;
  socketMode?: boolean;
  channels: {
    auto: string;
    decisions: string;
    failures: string;
    daily: string;
  };
}

export interface RepoInfo {
  name: string;
  repoPath: string;
  repoUrl?: string;
}

export interface TaskInput {
  title: string;
  description: string;
  complexity: TaskComplexity;
  taskType: TaskType;
  source: string;
  repoName?: string;
}

export interface SlackTaskActions {
  merge: (taskId: string) => Promise<void>;
  reject: (taskId: string) => Promise<void>;
  startTask?: (task: TaskInput) => Promise<string>;
  listRepos?: () => RepoInfo[];
}

interface ThreadInfo {
  channel: string;
  threadTs: string;
}

interface PendingMention {
  channel: string;
  threadTs: string;
  userId: string;
  description: string;
  repos: RepoInfo[];
  createdAt: number;
}

export class SlackBot {
  private config: SlackConfig;
  private actions: SlackTaskActions;
  private app: App | null = null;
  private threadMap: Map<string, ThreadInfo> = new Map();
  private pendingMentions: Map<string, PendingMention> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: SlackConfig, actions: SlackTaskActions) {
    const envWebhook = process.env.SLACK_WEBHOOK_URL;
    this.config = envWebhook ? { ...config, webhookUrl: envWebhook } : config;
    this.actions = actions;
  }

  /** Start the Bolt.js app in Socket Mode */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info('Slack notifications disabled');
      return;
    }

    const botToken = process.env.SLACK_BOT_TOKEN;
    const appToken = process.env.SLACK_APP_TOKEN;
    const signingSecret = process.env.SLACK_SIGNING_SECRET;

    if (!botToken || !appToken) {
      if (this.config.webhookUrl) {
        log.warn('SLACK_BOT_TOKEN/SLACK_APP_TOKEN missing — running in legacy webhook mode (no interactive features)');
      } else {
        log.warn('Slack tokens not configured — messages will be logged only');
      }
      return;
    }

    this.app = new App({
      token: botToken,
      signingSecret: signingSecret ?? '',
      appToken,
      socketMode: true,
    });

    this.registerActions();
    this.registerMentionHandler();
    await this.app.start();

    this.cleanupInterval = setInterval(() => this.cleanupPendingMentions(), PENDING_CLEANUP_INTERVAL_MS);

    log.info('Slack bot started in Socket Mode');
  }

  /** Stop the Bolt.js app */
  async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.app) {
      await this.app.stop();
      log.info('Slack bot stopped');
    }
    this.threadMap.clear();
    this.pendingMentions.clear();
  }

  /** Subscribe to event bus and auto-post to appropriate channels */
  attach(bus: EventBus): void {
    if (!this.config.enabled) {
      log.info('Slack notifications disabled');
      return;
    }

    bus.subscribeTopic('WORKER_PROGRESS', (msg) => {
      const phase = msg.content.data?.phase as string | undefined;
      if (phase === 'task_started') {
        // If thread already exists (from @mention), post there; otherwise create new thread
        if (this.threadMap.has(msg.taskId)) {
          this.postToThread(msg.taskId, 'decisions', `*Task started*: ${msg.content.text.slice(0, 200)}`);
        } else {
          this.postToChannel('decisions', `*Task started*: ${msg.content.text.slice(0, 200)}`).then(ts => {
            if (ts) this.threadMap.set(msg.taskId, { channel: this.config.channels.decisions, threadTs: ts });
          });
        }
      } else if (phase === 'testing') {
        this.postToThread(msg.taskId, 'decisions', 'Running tests...');
      }
    });

    bus.subscribeTopic('CLUSTER_COMPLETE', (msg) => {
      const status = msg.content.data?.status as string | undefined;
      if (status === 'awaiting_review') {
        this.postApprovalMessage(msg);
      } else if (status === 'failed' || status === 'escalated') {
        this.postToThread(msg.taskId, 'failures', this.formatFailure(msg));
      } else if (status === 'merged' || status === 'rejected') {
        const icon = status === 'merged' ? '✅' : '🚫';
        this.postToThread(msg.taskId, 'decisions', `${icon} Task *${status}*.`);
        this.threadMap.delete(msg.taskId);
      } else {
        this.postToChannel('auto', this.formatCompletion(msg));
      }
    });

    bus.subscribeTopic('HUMAN_DECISION', (msg) => {
      this.postToThread(msg.taskId, 'decisions', this.formatDecision(msg));
    });

    bus.subscribeTopic('SCAN_RESULT', (msg) => {
      if (msg.content.data?.approved === false) {
        this.postToChannel('auto', this.formatScanFailure(msg));
      }
    });

    log.info('Slack bot attached to event bus');
  }

  /** Post a daily summary */
  async postDailySummary(summary: {
    tasksCompleted: number;
    tasksFailed: number;
    totalCost: number;
    highlights: string[];
  }): Promise<void> {
    if (!this.config.enabled || summary.tasksCompleted + summary.tasksFailed === 0) return;

    const text = [
      '*Nanoprym Daily Summary*',
      `Tasks: ${summary.tasksCompleted} completed, ${summary.tasksFailed} failed`,
      `Cost: $${summary.totalCost.toFixed(2)}`,
      '',
      summary.highlights.length > 0 ? `Highlights: ${summary.highlights.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    await this.postToChannel('daily', text);
  }

  /** Post a health alert */
  async postHealthAlert(alert: {
    type: string;
    name?: string;
    previousState: string;
    currentState: string;
    timestamp: string;
  }): Promise<void> {
    if (!this.config.enabled) return;

    const icon = alert.currentState === 'up' ? '✅' : alert.currentState === 'down' ? '🔴' : '⚠️';
    const subject = alert.name ? `Dependency *${alert.name}*` : 'Overall status';
    const text = `${icon} ${subject}: ${alert.previousState} → ${alert.currentState} (${new Date(alert.timestamp).toLocaleTimeString()})`;

    const channel = alert.currentState === 'up' ? 'auto' : 'failures';
    await this.postToChannel(channel, text);
  }

  // ── Bolt.js action handlers ─────────────────────────────────

  private registerActions(): void {
    if (!this.app) return;

    this.app.action('approve_task', async ({ body, ack }) => {
      await ack();
      const action = (body as BlockAction).actions[0];
      const taskId = 'value' in action ? (action.value as string) : undefined;
      if (!taskId) return;

      try {
        await this.actions.merge(taskId);
        await this.postToThread(taskId, 'decisions', `✅ Task \`${taskId}\` merged.`);
      } catch (err) {
        await this.postToThread(taskId, 'decisions', `❌ Merge failed: ${String(err)}`);
      }
    });

    this.app.action('reject_task', async ({ body, ack }) => {
      await ack();
      const action = (body as BlockAction).actions[0];
      const taskId = 'value' in action ? (action.value as string) : undefined;
      if (!taskId) return;

      try {
        await this.actions.reject(taskId);
        await this.postToThread(taskId, 'decisions', `🚫 Task \`${taskId}\` rejected.`);
      } catch (err) {
        await this.postToThread(taskId, 'decisions', `❌ Reject failed: ${String(err)}`);
      }
    });
  }

  // ── @mention handler ──────────────────────────────────────────

  private registerMentionHandler(): void {
    if (!this.app) return;

    // Handle @nanoprym mentions — start a task creation thread
    this.app.event('app_mention', async ({ event, say }) => {
      try {
        await this.handleMention(event as { text: string; user: string; channel: string; ts: string }, say);
      } catch (err) {
        log.error('Mention handler failed', { error: String(err) });
      }
    });

    // Handle thread replies — repo selection for pending mentions
    this.app.event('message', async ({ event }) => {
      try {
        const msg = event as { text?: string; user?: string; thread_ts?: string; bot_id?: string; subtype?: string };
        // Ignore bot messages to avoid self-reply loops
        if (msg.bot_id || msg.subtype) return;
        if (!msg.thread_ts || !msg.text || !msg.user) return;

        await this.handleThreadReply(msg.thread_ts, msg.text, msg.user);
      } catch (err) {
        log.error('Thread reply handler failed', { error: String(err) });
      }
    });
  }

  private async handleMention(
    event: { text: string; user: string; channel: string; ts: string },
    say: (args: { text: string; thread_ts: string }) => Promise<unknown>,
  ): Promise<void> {
    // Strip the @mention prefix to get the task description
    const description = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

    if (!description) {
      await say({ text: 'What would you like me to work on? Mention me with a task description.', thread_ts: event.ts });
      return;
    }

    if (!this.actions.listRepos) {
      await say({ text: 'Task creation via Slack is not configured.', thread_ts: event.ts });
      return;
    }

    const repos = this.actions.listRepos();

    if (repos.length === 0) {
      await say({
        text: 'No repos registered. Use `nanoprym repo add <url|path>` to register a repo first.',
        thread_ts: event.ts,
      });
      return;
    }

    // Single repo — skip selection, start immediately
    if (repos.length === 1) {
      await say({
        text: `Starting task on *${repos[0].name}*...\n> ${description}`,
        thread_ts: event.ts,
      });
      await this.createTaskFromMention(event.channel, event.ts, description, repos[0].name);
      return;
    }

    // Multiple repos — ask user to pick
    const repoList = repos.map((r, i) => `*${i + 1}.* \`${r.name}\`${r.repoUrl ? ` — ${r.repoUrl}` : ''}`).join('\n');

    await say({
      text: `Which repo should I work on?\n\n${repoList}\n\nReply with the number or repo name.`,
      thread_ts: event.ts,
    });

    this.pendingMentions.set(event.ts, {
      channel: event.channel,
      threadTs: event.ts,
      userId: event.user,
      description,
      repos,
      createdAt: Date.now(),
    });

    log.info('Pending mention stored', { threadTs: event.ts, user: event.user, repoCount: repos.length });
  }

  private async handleThreadReply(threadTs: string, text: string, _userId: string): Promise<void> {
    const pending = this.pendingMentions.get(threadTs);
    if (!pending) return;

    const input = text.trim();

    // Try to match by number
    const num = parseInt(input, 10);
    let repoName: string | undefined;

    if (!isNaN(num) && num >= 1 && num <= pending.repos.length) {
      repoName = pending.repos[num - 1].name;
    } else {
      // Try to match by name (case-insensitive)
      const match = pending.repos.find(r => r.name.toLowerCase() === input.toLowerCase());
      if (match) repoName = match.name;
    }

    if (!repoName) {
      await this.postToChannelDirect(pending.channel, `Invalid selection: \`${input}\`. Reply with a number (1-${pending.repos.length}) or repo name.`, threadTs);
      return;
    }

    this.pendingMentions.delete(threadTs);
    await this.postToChannelDirect(pending.channel, `Starting task on *${repoName}*...\n> ${pending.description}`, threadTs);
    await this.createTaskFromMention(pending.channel, threadTs, pending.description, repoName);
  }

  private async createTaskFromMention(channel: string, threadTs: string, description: string, repoName: string): Promise<void> {
    if (!this.actions.startTask) {
      log.warn('startTask not configured');
      return;
    }

    try {
      const taskId = await this.actions.startTask({
        title: description.slice(0, 80),
        description,
        complexity: 'SIMPLE',
        taskType: 'TASK',
        source: 'slack',
        repoName,
      });

      // Map taskId to originating thread so lifecycle events post there
      this.threadMap.set(taskId, { channel, threadTs });

      await this.postToChannelDirect(channel, `Task \`${taskId.slice(0, 8)}\` created. I'll post updates here.`, threadTs);
      log.info('Task created from Slack mention', { taskId, repoName, channel });
    } catch (err) {
      await this.postToChannelDirect(channel, `Failed to create task: ${String(err)}`, threadTs);
      log.error('Task creation from mention failed', { error: String(err) });
    }
  }

  private cleanupPendingMentions(): void {
    const now = Date.now();
    for (const [key, pending] of this.pendingMentions) {
      if (now - pending.createdAt > PENDING_MENTION_TTL_MS) {
        this.pendingMentions.delete(key);
        log.debug('Expired pending mention', { threadTs: key });
      }
    }
  }

  // ── Block Kit approval message ──────────────────────────────

  private async postApprovalMessage(msg: Message): Promise<void> {
    const taskId = msg.taskId;
    const data = msg.content.data ?? {};
    const branch = (data.branch as string) ?? 'unknown';

    const blocks = [
      {
        type: 'section' as const,
        text: { type: 'mrkdwn' as const, text: `*Task Ready for Review*\nBranch: \`${branch}\`` },
      },
      {
        type: 'section' as const,
        fields: [
          { type: 'mrkdwn' as const, text: `*Task ID:*\n\`${taskId}\`` },
        ],
      },
      {
        type: 'actions' as const,
        elements: [
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Approve' },
            style: 'primary' as const,
            action_id: 'approve_task',
            value: taskId,
          },
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Reject' },
            style: 'danger' as const,
            action_id: 'reject_task',
            value: taskId,
          },
        ],
      },
    ];

    if (this.app) {
      try {
        const threadInfo = this.threadMap.get(taskId);
        const channel = threadInfo?.channel ?? this.config.channels.decisions;
        const threadTs = threadInfo?.threadTs;

        const result = await this.app.client.chat.postMessage({
          channel,
          text: `Task ${taskId} ready for review`,
          blocks,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        });
        if (result.ts && !this.threadMap.has(taskId)) {
          this.threadMap.set(taskId, { channel, threadTs: result.ts });
        }
      } catch (err) {
        log.warn('Failed to post approval message', { taskId, error: String(err) });
      }
    } else {
      await this.postViaWebhook('decisions', `*Task ready for review*: \`${taskId}\` on branch \`${branch}\``);
    }
  }

  // ── Message posting ─────────────────────────────────────────

  private async postToChannel(channel: keyof SlackConfig['channels'], text: string): Promise<string | undefined> {
    if (!this.config.enabled) {
      log.debug('Slack message (not sent)', { channel, text: text.slice(0, 100) });
      return undefined;
    }

    if (this.app) {
      try {
        const result = await this.app.client.chat.postMessage({
          channel: this.config.channels[channel],
          text,
        });
        return result.ts ?? undefined;
      } catch (err) {
        log.warn('Slack post failed', { channel, error: String(err) });
        return undefined;
      }
    }

    await this.postViaWebhook(channel, text);
    return undefined;
  }

  /** Post to a specific channel ID + thread (for @mention threads that aren't in config channels) */
  private async postToChannelDirect(channelId: string, text: string, threadTs?: string): Promise<void> {
    if (!this.app) return;
    try {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
    } catch (err) {
      log.warn('Slack direct post failed', { channelId, error: String(err) });
    }
  }

  private async postToThread(taskId: string, fallbackChannel: keyof SlackConfig['channels'], text: string): Promise<void> {
    if (!this.config.enabled) return;

    const threadInfo = this.threadMap.get(taskId);

    if (this.app) {
      try {
        const channel = threadInfo?.channel ?? this.config.channels[fallbackChannel];
        await this.app.client.chat.postMessage({
          channel,
          text,
          ...(threadInfo?.threadTs ? { thread_ts: threadInfo.threadTs } : {}),
        });
      } catch (err) {
        log.warn('Slack thread post failed', { taskId, fallbackChannel, error: String(err) });
      }
      return;
    }

    await this.postViaWebhook(fallbackChannel, text);
  }

  /** Legacy webhook posting (fallback when Bolt.js tokens not configured) */
  private async postViaWebhook(channel: keyof SlackConfig['channels'], text: string): Promise<void> {
    if (!this.config.webhookUrl) {
      log.debug('Slack message (not sent, no webhook)', { channel, text: text.slice(0, 100) });
      return;
    }

    try {
      const resp = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: this.config.channels[channel], text }),
      });

      if (!resp.ok) {
        log.warn('Slack webhook post failed', { channel, status: resp.status });
      }
    } catch (error) {
      log.warn('Slack not reachable', { error: String(error) });
    }
  }

  // ── Formatters ──────────────────────────────────────────────

  private formatCompletion(msg: Message): string {
    return `✅ *Task completed*: ${msg.content.text.slice(0, 200)}`;
  }

  private formatFailure(msg: Message): string {
    return `❌ *Task failed*: ${msg.content.text.slice(0, 200)}\n${JSON.stringify(msg.content.data?.attempts ?? [], null, 2).slice(0, 500)}`;
  }

  private formatDecision(msg: Message): string {
    return `*Decision needed*: ${msg.content.text.slice(0, 200)}`;
  }

  private formatScanFailure(msg: Message): string {
    const errors = (msg.content.data?.errors as string[]) ?? [];
    return `*Scanner failed*: ${errors.length} issues found\n${errors.slice(0, 3).join('\n')}`;
  }
}
