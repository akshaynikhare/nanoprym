/**
 * Nanoprym Orchestrator — Main entry point
 * Manages task lifecycle: receive → route → plan → build → review → commit
 *
 * Creates agents based on config router, wires them to event bus,
 * monitors for completion or failure.
 */
import { EventLedger } from './event-ledger.js';
import { EventBus } from './event-bus.js';
import { StateSnapshotter } from './state-snapshot.js';
import { routeTask, type WorkflowTemplate } from './config-router.js';
import { PlannerAgent } from '../agents/planner/planner.agent.js';
import { BuilderAgent } from '../agents/builder/builder.agent.js';
import { ReviewerAgent } from '../agents/reviewer/reviewer.agent.js';
import { ClaudeProvider } from '../providers/claude.provider.js';
import { GitManager, type WorktreeInfo } from '../git/git.manager.js';
import { SandboxManager } from '../security/sandbox.manager.js';
import { HealthServer, type HealthStatus } from '../http/health.server.js';
import { ApiServer } from '../http/api.server.js';
import { HealthMonitor } from '../monitoring/health.monitor.js';
import { SlackBot, type SlackTaskActions } from '../notifications/slack.bot.js';
import { mergeTask, rejectTask } from './task-actions.js';
import { InboxWatcher } from './inbox-watcher.js';
import { LearningEngine } from '../evolution/learning.engine.js';
import { RepoManager } from '../repos/repo.manager.js';
import type { TaskComplexity, TaskType, Message, NotificationsConfig, DetailedHealthStatus } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';
import { LEDGER_DIR } from '../_shared/constants.js';
import { generateId } from '../_shared/utils.js';
import { DatabaseClient } from '../db/db.client.js';
import path from 'node:path';
import fs from 'node:fs';

const log = createChildLogger('orchestrator');

export interface TaskInput {
  title: string;
  description: string;
  complexity: TaskComplexity;
  taskType: TaskType;
  issueNumber?: number;
  source: string;
  repoName?: string;
}

export class Orchestrator {
  private activeLedger: EventLedger | null = null;
  private activeBus: EventBus | null = null;
  private activeAgents: Array<{ stop: () => void }> = [];
  private activeWorktree: WorktreeInfo | null = null;
  private healthServer: HealthServer | null = null;
  private apiServer: ApiServer | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private slackBot: SlackBot | null = null;
  private inboxWatcher: InboxWatcher | null = null;
  private db: DatabaseClient | null = null;
  private repoManager: RepoManager;
  private ledgerBaseDir: string;
  private claude: ClaudeProvider;
  private gitManager: GitManager;

  constructor(options?: { configDir?: string; repoRoot?: string; healthPort?: number; dashboardDir?: string; notifications?: NotificationsConfig }) {
    this.ledgerBaseDir = path.resolve(process.env.HOME ?? '~', options?.configDir ?? LEDGER_DIR);
    if (!fs.existsSync(this.ledgerBaseDir)) {
      fs.mkdirSync(this.ledgerBaseDir, { recursive: true });
    }
    this.claude = new ClaudeProvider();
    this.gitManager = new GitManager(options?.repoRoot);
    this.repoManager = new RepoManager();

    this.healthServer = new HealthServer({
      port: options?.healthPort,
      activeTaskCheck: () => this.activeBus !== null,
    });

    // Start API server for dashboard on port 9091
    this.apiServer = new ApiServer({
      port: (options?.healthPort ?? 9090) + 1,
      activeTaskCheck: () => this.activeBus !== null,
      dashboardDir: options?.dashboardDir,
      ledgerBaseDir: this.ledgerBaseDir,
      gitManager: this.gitManager,
    });

    // Start health monitor and wire to servers
    this.healthMonitor = new HealthMonitor({
      activeTaskCheck: () => this.activeBus !== null,
    });
    this.healthMonitor.start();
    this.healthServer.attachMonitor(this.healthMonitor);
    this.apiServer.attachMonitor(this.healthMonitor);

    // Initialize DB for health snapshot persistence (async, non-blocking)
    DatabaseClient.create().then(db => {
      this.db = db;
      this.healthMonitor?.attachDb(db);
      log.info('Health DB initialized');
    }).catch(err => {
      log.warn('Failed to initialize health DB, snapshots will not persist', { error: String(err) });
    });
    this.apiServer.attachOrchestrator(this);

    // Initialize Slack bot if configured
    if (options?.notifications?.slack) {
      const taskActions: SlackTaskActions = {
        merge: (taskId) => mergeTask(taskId, { gitManager: this.gitManager, ledgerBaseDir: this.ledgerBaseDir }),
        reject: (taskId) => rejectTask(taskId, { gitManager: this.gitManager, ledgerBaseDir: this.ledgerBaseDir }),
      };

      this.slackBot = new SlackBot(options.notifications.slack, taskActions);
      this.slackBot.start().catch((err) => {
        log.error('Slack bot failed to start', { error: String(err) });
      });

      // Wire health alerts → Slack
      const bot = this.slackBot;
      this.healthMonitor.onAlert((alert) => {
        bot.postHealthAlert(alert).catch(() => {});
      });
    }

    // Initialize inbox watcher for human decisions via ~/.nanoprym/inbox.md
    this.inboxWatcher = new InboxWatcher(options?.configDir);
  }

  /** Start a new task — creates ledger, agents, and kicks off pipeline */
  async startTask(task: TaskInput): Promise<string> {
    const taskId = generateId();

    // Resolve git manager — use per-repo if repoName specified, else default
    let gitManager = this.gitManager;
    if (task.repoName) {
      const repoPath = this.repoManager.resolve(task.repoName);
      gitManager = new GitManager(repoPath);
      log.info('Using repo-specific git manager', { repoName: task.repoName, repoPath });
    }

    // Use per-project ledger dir if repo is registered
    let ledgerDir = this.ledgerBaseDir;
    if (task.repoName) {
      const projectConfig = this.repoManager.getProjectConfig(task.repoName);
      if (projectConfig) {
        ledgerDir = projectConfig.ledgerPath;
        if (!fs.existsSync(ledgerDir)) fs.mkdirSync(ledgerDir, { recursive: true });
      }
    }

    const ledgerPath = path.join(ledgerDir, `${taskId}.db`);

    // Initialize event sourcing
    this.activeLedger = await EventLedger.create(ledgerPath);
    this.activeBus = new EventBus(this.activeLedger);

    // State snapshotter auto-subscribes to events
    new StateSnapshotter(this.activeBus);

    // Wire learning engine for self-evolution tracking
    // LearningEngine auto-subscribes to EventBus (fire-and-forget like StateSnapshotter)
    new LearningEngine(this.activeBus);

    // Attach event bus to API server for SSE streaming
    if (this.apiServer) {
      this.apiServer.attachEventBus(this.activeBus, this.activeLedger);
    }

    // Attach Slack bot for notifications
    if (this.slackBot) {
      this.slackBot.attach(this.activeBus);
    }

    // Start inbox watcher for human decisions
    if (this.inboxWatcher) {
      this.inboxWatcher.start(this.activeBus);
    }

    // Route to appropriate workflow
    const route = routeTask(task.complexity, task.taskType);
    log.info('Starting task', { taskId, ...task, route: route.template });

    // Create worktree for isolated execution
    try {
      this.activeWorktree = await gitManager.createWorktree(taskId);
      log.info('Worktree created', { taskId, path: this.activeWorktree.path, branch: this.activeWorktree.branch });
    } catch (error) {
      log.error('Failed to create worktree', { taskId, error: String(error) });
      throw error;
    }

    // Create agents based on template (with worktree path)
    const agentCount = this.createAgents(route.template, this.activeBus, this.activeWorktree.path);

    // Emit lifecycle: agents created
    this.activeBus.publish({
      taskId,
      topic: 'WORKER_PROGRESS',
      sender: 'orchestrator',
      content: {
        text: `Task pipeline started: ${route.template} with ${agentCount} agent(s)`,
        data: { phase: 'task_started', template: route.template, agentCount, branch: this.activeWorktree.branch },
      },
    });

    // Publish initial event — triggers the pipeline
    this.activeBus.publish({
      taskId,
      topic: 'ISSUE_OPENED',
      sender: 'orchestrator',
      content: {
        text: task.description,
        data: {
          title: task.title,
          complexity: task.complexity,
          taskType: task.taskType,
          issueNumber: task.issueNumber,
          source: task.source,
          repoName: task.repoName,
          route,
        },
      },
    });

    // VALIDATION_RESULT (approved) → run tests → CLUSTER_COMPLETE
    this.activeBus.subscribeTopic('VALIDATION_RESULT', async (msg: Message) => {
      if (msg.content.data?.approved !== true) return;
      if (msg.sender === 'test-runner') return; // avoid infinite loop

      log.info('Review approved, running tests', { taskId });
      const worktreePath = this.activeWorktree?.path;

      // Run tests in Docker sandbox (fallback to local)
      let testsPassed = true;
      let testOutput = '';
      if (worktreePath) {
        const sandbox = new SandboxManager(gitManager.getRepoRoot());
        if (sandbox.isAvailable()) {
          this.activeBus?.publish({
            taskId, topic: 'WORKER_PROGRESS', sender: 'orchestrator',
            content: { text: 'Running tests in Docker sandbox', data: { phase: 'testing', method: 'docker' } },
          });
          const result = await sandbox.runTests(worktreePath);
          testsPassed = result.success;
          testOutput = result.output;
        } else {
          log.info('Docker not available, skipping sandbox tests');
        }
      }

      if (!testsPassed) {
        // Test failure → publish rejection for builder retry
        this.activeBus?.publish({
          taskId, topic: 'VALIDATION_RESULT', sender: 'test-runner',
          content: { text: `Tests failed:\n${testOutput.slice(-2000)}`, data: { approved: false, errors: [testOutput.slice(-2000)], source: 'test-runner' } },
        });
        return;
      }

      // Tests passed → awaiting human review in dashboard
      this.activeBus?.publish({
        taskId, topic: 'CLUSTER_COMPLETE', sender: 'orchestrator',
        content: {
          text: `Task ready for review`,
          data: { status: 'awaiting_review', branch: this.activeWorktree?.branch, worktreePath },
        },
      });
    });

    // Monitor for completion — emit lifecycle event
    this.activeBus.subscribeTopic('CLUSTER_COMPLETE', (msg: Message) => {
      log.info('Task completed', { taskId, status: msg.content.data?.status });
      this.activeBus?.publish({
        taskId,
        topic: 'WORKER_PROGRESS',
        sender: 'orchestrator',
        content: {
          text: `Task ${taskId} completed`,
          data: { phase: 'task_completed', status: msg.content.data?.status },
        },
      });
    });

    return taskId;
  }

  /** Resume a task from its persisted ledger */
  async resumeTask(taskId: string): Promise<void> {
    const ledgerPath = path.join(this.ledgerBaseDir, `${taskId}.db`);

    if (!fs.existsSync(ledgerPath)) {
      throw new Error(`No ledger found for task ${taskId}`);
    }

    this.activeLedger = await EventLedger.create(ledgerPath);
    this.activeBus = new EventBus(this.activeLedger);

    // Attach event bus to API server for SSE streaming
    if (this.apiServer) {
      this.apiServer.attachEventBus(this.activeBus, this.activeLedger);
    }

    // Attach Slack bot for notifications
    if (this.slackBot) {
      this.slackBot.attach(this.activeBus);
    }

    // Start inbox watcher for human decisions
    if (this.inboxWatcher) {
      this.inboxWatcher.start(this.activeBus);
    }

    // Replay: read all messages to reconstruct state
    const messages = this.activeBus.query({ taskId });
    log.info('Resuming task', { taskId, messageCount: messages.length });

    // Determine what template was used
    const issueMsg = messages.find(m => m.topic === 'ISSUE_OPENED');
    const template = (issueMsg?.content.data?.route as { template: WorkflowTemplate })?.template ?? 'full-workflow';

    // Re-create agents
    const agentCount = this.createAgents(template, this.activeBus);

    // Emit lifecycle: task resumed
    this.activeBus.publish({
      taskId,
      topic: 'WORKER_PROGRESS',
      sender: 'orchestrator',
      content: {
        text: `Task resumed: ${template} with ${agentCount} agent(s), replaying from ${messages.length} events`,
        data: { phase: 'task_resumed', template, agentCount, replayedEvents: messages.length },
      },
    });

    // Find last significant event to determine where to resume
    const lastEvent = messages[messages.length - 1];
    if (lastEvent) {
      log.info('Resuming from', { topic: lastEvent.topic, sender: lastEvent.sender });
      // Re-emit the last event to re-trigger the appropriate agent
      this.activeBus.publish({
        taskId,
        topic: lastEvent.topic,
        sender: 'orchestrator-resume',
        content: lastEvent.content,
        metadata: { resumed: true },
      });
    }
  }

  /** Get the active event bus (for external listeners) */
  getEventBus(): EventBus | null {
    return this.activeBus;
  }

  /** Get the current health status from the health server */
  getHealthStatus(): HealthStatus | null {
    if (!this.healthServer) return null;
    return this.healthServer.getHealthStatus();
  }

  /** Get detailed health status including dependencies and system metrics */
  getDetailedHealthStatus(): DetailedHealthStatus | null {
    if (!this.healthMonitor) return null;
    return this.healthMonitor.getDetailedStatus();
  }

  /** Shutdown all agents, health server, and close ledger */
  shutdown(): void {
    // Notify SSE clients before tearing down
    if (this.activeBus) {
      this.activeBus.publish({
        taskId: 'system',
        topic: 'WORKER_PROGRESS',
        sender: 'orchestrator',
        content: {
          text: 'Orchestrator shutting down',
          data: { phase: 'shutdown' },
        },
      });
    }

    for (const agent of this.activeAgents) {
      agent.stop();
    }
    this.activeAgents = [];

    if (this.activeLedger) {
      this.activeLedger.close();
      this.activeLedger = null;
    }
    this.activeBus = null;

    if (this.healthMonitor) {
      this.healthMonitor.stop();
      this.healthMonitor = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    if (this.slackBot) {
      this.slackBot.stop().catch(() => {});
      this.slackBot = null;
    }

    if (this.inboxWatcher) {
      this.inboxWatcher.stop();
      this.inboxWatcher = null;
    }

    if (this.healthServer) {
      this.healthServer.stop().catch(() => {});
      this.healthServer = null;
    }

    if (this.apiServer) {
      this.apiServer.stop().catch(() => {});
      this.apiServer = null;
    }

    log.info('Orchestrator shutdown');
  }

  /** Create agents based on workflow template */
  private createAgents(template: WorkflowTemplate, bus: EventBus, worktreePath?: string): number {
    this.activeAgents = [];

    const wireWorktree = (builder: BuilderAgent, reviewer?: ReviewerAgent) => {
      if (worktreePath) {
        builder.setWorktreePath(worktreePath);
        if (reviewer) reviewer.setWorktreePath(worktreePath);
      }
    };

    switch (template) {
      case 'single-worker': {
        const builder = new BuilderAgent(
          BuilderAgent.createConfig({
            triggers: [
              { topic: 'ISSUE_OPENED', action: 'execute_task' },
              { topic: 'WORKER_PROGRESS', action: 'execute_task', logic: { engine: 'javascript', script: 'return message.sender === "builder";' } },
            ],
          }),
          bus,
          this.claude,
          this.gitManager,
        );
        wireWorktree(builder);
        builder.start();
        this.activeAgents.push(builder);
        break;
      }

      case 'worker-validator': {
        const builder = new BuilderAgent(
          BuilderAgent.createConfig({
            triggers: [
              { topic: 'ISSUE_OPENED', action: 'execute_task' },
              { topic: 'WORKER_PROGRESS', action: 'execute_task', logic: { engine: 'javascript', script: 'return message.sender === "builder";' } },
              { topic: 'VALIDATION_RESULT', action: 'execute_task', logic: { engine: 'javascript', script: 'return message.content.data?.approved === false;' } },
            ],
            contextStrategy: {
              sources: [
                { topic: 'ISSUE_OPENED', priority: 'required', strategy: 'latest', amount: 1 },
                { topic: 'STATE_SNAPSHOT', priority: 'required', strategy: 'latest', amount: 1 },
                { topic: 'WORKER_PROGRESS', priority: 'medium', strategy: 'latest', amount: 3, since: 'last_task_end' },
                { topic: 'VALIDATION_RESULT', priority: 'high', strategy: 'latest', amount: 10, since: 'last_task_end' },
              ],
              format: 'chronological',
              maxTokens: 200_000,
            },
          }),
          bus,
          this.claude,
          this.gitManager,
        );
        const reviewer = new ReviewerAgent(ReviewerAgent.createConfig(), bus, this.gitManager, this.claude);
        wireWorktree(builder, reviewer);
        builder.start();
        reviewer.start();
        this.activeAgents.push(builder, reviewer);
        break;
      }

      case 'full-workflow': {
        const planner = new PlannerAgent(PlannerAgent.createConfig(), bus, this.claude);
        const builder = new BuilderAgent(BuilderAgent.createConfig(), bus, this.claude, this.gitManager);
        const reviewer = new ReviewerAgent(ReviewerAgent.createConfig(), bus, this.gitManager, this.claude);
        wireWorktree(builder, reviewer);
        planner.start();
        builder.start();
        reviewer.start();
        this.activeAgents.push(planner, builder, reviewer);
        break;
      }

      case 'debug-workflow': {
        const builder = new BuilderAgent(
          BuilderAgent.createConfig({
            triggers: [
              { topic: 'ISSUE_OPENED', action: 'execute_task' },
              {
                topic: 'VALIDATION_RESULT',
                action: 'execute_task',
                logic: {
                  engine: 'javascript',
                  script: 'return message.content.data?.approved === false;',
                },
              },
            ],
            contextStrategy: {
              sources: [
                { topic: 'ISSUE_OPENED', priority: 'required', strategy: 'latest', amount: 1 },
                { topic: 'STATE_SNAPSHOT', priority: 'required', strategy: 'latest', amount: 1 },
                { topic: 'WORKER_PROGRESS', priority: 'medium', strategy: 'latest', amount: 3, since: 'last_task_end' },
                { topic: 'VALIDATION_RESULT', priority: 'high', strategy: 'latest', amount: 10, since: 'last_task_end' },
              ],
              format: 'chronological',
              maxTokens: 200_000,
            },
          }),
          bus,
          this.claude,
          this.gitManager,
        );
        const reviewer = new ReviewerAgent(ReviewerAgent.createConfig(), bus, this.gitManager, this.claude);
        wireWorktree(builder, reviewer);
        builder.start();
        reviewer.start();
        this.activeAgents.push(builder, reviewer);
        break;
      }
    }

    log.info('Agents created', { template, count: this.activeAgents.length });
    return this.activeAgents.length;
  }
}
