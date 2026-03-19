/**
 * Slack Bot — Notifications and human-in-loop via Slack
 *
 * Channels:
 * - #nanoprym-auto: auto-fix logs (bug/security/test)
 * - #nanoprym-decisions: needs approval (threaded)
 * - #nanoprym-failures: failed tasks with reports
 * - #nanoprym-daily: summary (only when something happened)
 *
 * Uses Slack Web API directly (not Bolt.js yet — add in production)
 * For MVP, posts via incoming webhook or slack CLI
 */
import { EventBus } from '../core/event-bus.js';
import type { Message } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('slack-bot');

export interface SlackConfig {
  enabled: boolean;
  webhookUrl?: string;
  channels: {
    auto: string;
    decisions: string;
    failures: string;
    daily: string;
  };
}

export class SlackBot {
  private config: SlackConfig;
  // bus reference kept for future unsubscribe support

  constructor(config: SlackConfig) {
    this.config = config;
  }

  /** Subscribe to event bus and auto-post to appropriate channels */
  attach(bus: EventBus): void {
    if (!this.config.enabled) {
      log.info('Slack notifications disabled');
      return;
    }

    // bus reference stored for future use
    void bus;

    bus.subscribeTopic('CLUSTER_COMPLETE', (msg) => {
      const status = msg.content.data?.status;
      if (status === 'failed' || status === 'escalated') {
        this.postToChannel('failures', this.formatFailure(msg));
      } else {
        this.postToChannel('auto', this.formatCompletion(msg));
      }
    });

    bus.subscribeTopic('HUMAN_DECISION', (msg) => {
      this.postToChannel('decisions', this.formatDecision(msg));
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

  /** Post message to a Slack channel via webhook */
  private async postToChannel(channel: keyof SlackConfig['channels'], text: string): Promise<void> {
    if (!this.config.enabled || !this.config.webhookUrl) {
      log.debug('Slack message (not sent)', { channel, text: text.slice(0, 100) });
      return;
    }

    try {
      const resp = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: this.config.channels[channel], text }),
      });

      if (!resp.ok) {
        log.warn('Slack post failed', { channel, status: resp.status });
      }
    } catch (error) {
      log.warn('Slack not reachable', { error: String(error) });
    }
  }

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
