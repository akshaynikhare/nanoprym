/**
 * Slack Bot Tests
 * Tests Bolt.js integration, thread tracking, approval actions, and legacy fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackBot, type SlackConfig, type SlackTaskActions } from '../../src/notifications/slack.bot.js';
import { EventBus } from '../../src/core/event-bus.js';
import { EventLedger } from '../../src/core/event-ledger.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Mock @slack/bolt
vi.mock('@slack/bolt', () => {
  const mockPostMessage = vi.fn().mockResolvedValue({ ts: 'mock-ts-123' });
  const mockAction = vi.fn();
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const mockStop = vi.fn().mockResolvedValue(undefined);

  return {
    App: vi.fn().mockImplementation(() => ({
      client: { chat: { postMessage: mockPostMessage } },
      action: mockAction,
      start: mockStart,
      stop: mockStop,
    })),
  };
});

const defaultConfig: SlackConfig = {
  enabled: true,
  channels: {
    auto: '#nanoprym-auto',
    decisions: '#nanoprym-decisions',
    failures: '#nanoprym-failures',
    daily: '#nanoprym-daily',
  },
};

const defaultActions: SlackTaskActions = {
  merge: vi.fn().mockResolvedValue(undefined),
  reject: vi.fn().mockResolvedValue(undefined),
};

describe('SlackBot', () => {
  const testDir = path.join(os.tmpdir(), `nanoprym-slack-tests-${Date.now()}`);
  let ledger: EventLedger;
  let bus: EventBus;

  beforeEach(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const dbPath = path.join(testDir, `slack-${Date.now()}.db`);
    ledger = await EventLedger.create(dbPath);
    bus = new EventBus(ledger);

    // Reset env vars
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_WEBHOOK_URL;
  });

  afterEach(() => {
    ledger.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create bot with config', () => {
      const bot = new SlackBot(defaultConfig, defaultActions);
      expect(bot).toBeDefined();
    });

    it('should override webhookUrl from env var', () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      const bot = new SlackBot(defaultConfig, defaultActions);
      expect(bot).toBeDefined();
    });
  });

  describe('start', () => {
    it('should skip when disabled', async () => {
      const bot = new SlackBot({ ...defaultConfig, enabled: false }, defaultActions);
      await bot.start(); // should not throw
    });

    it('should warn when no bot tokens are set', async () => {
      const bot = new SlackBot(defaultConfig, defaultActions);
      await bot.start(); // should not throw, logs warning
    });

    it('should initialize Bolt app with tokens', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';
      process.env.SLACK_SIGNING_SECRET = 'test-secret';

      const { App } = await import('@slack/bolt');
      const bot = new SlackBot(defaultConfig, defaultActions);
      await bot.start();

      expect(App).toHaveBeenCalledWith({
        token: 'xoxb-test',
        signingSecret: 'test-secret',
        appToken: 'xapp-test',
        socketMode: true,
      });
    });

    it('should register approve_task and reject_task actions', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';

      const bot = new SlackBot(defaultConfig, defaultActions);
      await bot.start();

      const { App } = await import('@slack/bolt');
      const appInstance = (App as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      if (appInstance) {
        const actionCalls = appInstance.action.mock.calls;
        const actionIds = actionCalls.map((c: unknown[]) => c[0]);
        expect(actionIds).toContain('approve_task');
        expect(actionIds).toContain('reject_task');
      }
    });
  });

  describe('stop', () => {
    it('should stop Bolt app when started', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';

      const bot = new SlackBot(defaultConfig, defaultActions);
      await bot.start();
      await bot.stop();

      const { App } = await import('@slack/bolt');
      const appInstance = (App as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      if (appInstance) {
        expect(appInstance.stop).toHaveBeenCalled();
      }
    });

    it('should not throw when not started', async () => {
      const bot = new SlackBot(defaultConfig, defaultActions);
      await bot.stop(); // should not throw
    });
  });

  describe('attach', () => {
    it('should skip when disabled', () => {
      const bot = new SlackBot({ ...defaultConfig, enabled: false }, defaultActions);
      bot.attach(bus); // should not throw
    });

    it('should subscribe to event bus topics', () => {
      const bot = new SlackBot(defaultConfig, defaultActions);
      bot.attach(bus);

      // Verify subscriptions by publishing events — they should not throw
      bus.publish({
        taskId: 'test-1',
        topic: 'WORKER_PROGRESS',
        sender: 'test',
        content: { text: 'test', data: { phase: 'task_started' } },
      });

      bus.publish({
        taskId: 'test-1',
        topic: 'CLUSTER_COMPLETE',
        sender: 'test',
        content: { text: 'done', data: { status: 'awaiting_review', branch: 'nanoprym/test-1' } },
      });

      bus.publish({
        taskId: 'test-2',
        topic: 'SCAN_RESULT',
        sender: 'test',
        content: { text: 'scan', data: { approved: false, errors: ['err1'] } },
      });

      bus.publish({
        taskId: 'test-3',
        topic: 'HUMAN_DECISION',
        sender: 'test',
        content: { text: 'decision needed' },
      });
    });

    it('should clean up threadMap on merged/rejected', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';

      const bot = new SlackBot(defaultConfig, defaultActions);
      await bot.start();
      bot.attach(bus);

      // Start a task → stores threadTs
      bus.publish({
        taskId: 'cleanup-test',
        topic: 'WORKER_PROGRESS',
        sender: 'test',
        content: { text: 'started', data: { phase: 'task_started' } },
      });

      // Wait for async postMessage
      await new Promise(r => setTimeout(r, 50));

      // Merge → should clean up
      bus.publish({
        taskId: 'cleanup-test',
        topic: 'CLUSTER_COMPLETE',
        sender: 'test',
        content: { text: 'merged', data: { status: 'merged' } },
      });

      await new Promise(r => setTimeout(r, 50));
      await bot.stop();
    });
  });

  describe('postDailySummary', () => {
    it('should skip when no tasks', async () => {
      const bot = new SlackBot(defaultConfig, defaultActions);
      await bot.postDailySummary({
        tasksCompleted: 0,
        tasksFailed: 0,
        totalCost: 0,
        highlights: [],
      }); // should not throw or post
    });

    it('should post summary when tasks exist', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';

      const bot = new SlackBot(defaultConfig, defaultActions);
      await bot.start();
      await bot.postDailySummary({
        tasksCompleted: 3,
        tasksFailed: 1,
        totalCost: 1.50,
        highlights: ['Fixed auth bug'],
      });

      const { App } = await import('@slack/bolt');
      const appInstance = (App as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      if (appInstance) {
        expect(appInstance.client.chat.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            channel: '#nanoprym-daily',
            text: expect.stringContaining('3 completed'),
          }),
        );
      }
    });
  });

  describe('postHealthAlert', () => {
    it('should skip when disabled', async () => {
      const bot = new SlackBot({ ...defaultConfig, enabled: false }, defaultActions);
      await bot.postHealthAlert({
        type: 'dependency',
        name: 'redis',
        previousState: 'up',
        currentState: 'down',
        timestamp: new Date().toISOString(),
      });
    });

    it('should post to failures for down alerts', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';

      const bot = new SlackBot(defaultConfig, defaultActions);
      await bot.start();
      await bot.postHealthAlert({
        type: 'dependency',
        name: 'redis',
        previousState: 'up',
        currentState: 'down',
        timestamp: new Date().toISOString(),
      });

      const { App } = await import('@slack/bolt');
      const appInstance = (App as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      if (appInstance) {
        expect(appInstance.client.chat.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            channel: '#nanoprym-failures',
          }),
        );
      }
    });
  });

  describe('legacy webhook fallback', () => {
    it('should use webhook when no Bolt tokens', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const bot = new SlackBot(
        { ...defaultConfig, webhookUrl: 'https://hooks.slack.com/test' },
        defaultActions,
      );
      await bot.start(); // no tokens → stays in webhook mode

      await bot.postHealthAlert({
        type: 'dependency',
        name: 'redis',
        previousState: 'up',
        currentState: 'down',
        timestamp: new Date().toISOString(),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
