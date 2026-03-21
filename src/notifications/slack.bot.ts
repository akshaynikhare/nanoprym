/**
 * Slack Bot — Notifications and human-in-loop via Slack
 *
 * Channels:
 * - #nanoprym-auto: auto-fix logs (bug/security/test)
 * - #nanoprym-decisions: needs approval (threaded)
 * - #nanoprym-failures: failed tasks with reports
 * - #nanoprym-daily: summary (only when something happened)
 *
 * Uses Bolt.js in Socket Mode for interactive approval workflows.
 * Falls back to legacy webhook posting if bot tokens are not configured.
 */
import { App, type BlockAction } from '@slack/bolt';
import type { EventBus } from '../core/event-bus.js';
import type { Message } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('slack-bot');

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

export interface SlackTaskActions {
  merge: (taskId: string) => Promise<void>;
  reject: (taskId: string) => Promise<void>;
}

export class SlackBot {
  private config: SlackConfig;
  private actions: SlackTaskActions;
  private app: App | null = null;
  private threadMap: Map<string, string> = new Map();

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
    await this.app.start();
    log.info('Slack bot started in Socket Mode');
  }

  /** Stop the Bolt.js app */
  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      log.info('Slack bot stopped');
    }
    this.threadMap.clear();
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
        this.postToChannel('decisions', `*Task started*: ${msg.content.text.slice(0, 200)}`).then(ts => {
          if (ts) this.threadMap.set(msg.taskId, ts);
        });
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
        const threadTs = this.threadMap.get(taskId);
        const result = await this.app.client.chat.postMessage({
          channel: this.config.channels.decisions,
          text: `Task ${taskId} ready for review`,
          blocks,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        });
        if (result.ts && !this.threadMap.has(taskId)) {
          this.threadMap.set(taskId, result.ts);
        }
      } catch (err) {
        log.warn('Failed to post approval message', { taskId, error: String(err) });
      }
    } else {
      await this.postViaWebhook('decisions', `🔔 *Task ready for review*: \`${taskId}\` on branch \`${branch}\``);
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

  private async postToThread(taskId: string, channel: keyof SlackConfig['channels'], text: string): Promise<void> {
    if (!this.config.enabled) return;

    const threadTs = this.threadMap.get(taskId);

    if (this.app) {
      try {
        await this.app.client.chat.postMessage({
          channel: this.config.channels[channel],
          text,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        });
      } catch (err) {
        log.warn('Slack thread post failed', { taskId, channel, error: String(err) });
      }
      return;
    }

    await this.postViaWebhook(channel, text);
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
    return `🔔 *Decision needed*: ${msg.content.text.slice(0, 200)}`;
  }

  private formatScanFailure(msg: Message): string {
    const errors = (msg.content.data?.errors as string[]) ?? [];
    return `⚠️ *Scanner failed*: ${errors.length} issues found\n${errors.slice(0, 3).join('\n')}`;
  }
}
