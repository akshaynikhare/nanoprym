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
import { GitManager } from '../git/git.manager.js';
// import { RetryManager } from '../recovery/retry.manager.js';
import type { TaskComplexity, TaskType, Message } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';
import { LEDGER_DIR } from '../_shared/constants.js';
import { generateId } from '../_shared/utils.js';
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
}

export class Orchestrator {
  private activeLedger: EventLedger | null = null;
  private activeBus: EventBus | null = null;
  private activeAgents: Array<{ stop: () => void }> = [];
  private ledgerBaseDir: string;
  private claude: ClaudeProvider;
  private gitManager: GitManager;

  constructor(options?: { configDir?: string; repoRoot?: string }) {
    this.ledgerBaseDir = path.resolve(process.env.HOME ?? '~', options?.configDir ?? LEDGER_DIR);
    if (!fs.existsSync(this.ledgerBaseDir)) {
      fs.mkdirSync(this.ledgerBaseDir, { recursive: true });
    }
    this.claude = new ClaudeProvider();
    this.gitManager = new GitManager(options?.repoRoot);
  }

  /** Start a new task — creates ledger, agents, and kicks off pipeline */
  async startTask(task: TaskInput): Promise<string> {
    const taskId = generateId();
    const ledgerPath = path.join(this.ledgerBaseDir, `${taskId}.db`);

    // Initialize event sourcing
    this.activeLedger = await EventLedger.create(ledgerPath);
    this.activeBus = new EventBus(this.activeLedger);

    // State snapshotter auto-subscribes to events
    new StateSnapshotter(this.activeBus);

    // Route to appropriate workflow
    const route = routeTask(task.complexity, task.taskType);
    log.info('Starting task', { taskId, ...task, route: route.template });

    // Create agents based on template
    this.createAgents(route.template, this.activeBus);

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
          route,
        },
      },
    });

    // Monitor for completion
    this.activeBus.subscribeTopic('CLUSTER_COMPLETE', (msg: Message) => {
      log.info('Task completed', { taskId, status: msg.content.data?.status });
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

    // Replay: read all messages to reconstruct state
    const messages = this.activeBus.query({ taskId });
    log.info('Resuming task', { taskId, messageCount: messages.length });

    // Determine what template was used
    const issueMsg = messages.find(m => m.topic === 'ISSUE_OPENED');
    const template = (issueMsg?.content.data?.route as { template: WorkflowTemplate })?.template ?? 'full-workflow';

    // Re-create agents
    this.createAgents(template, this.activeBus);

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

  /** Shutdown all agents and close ledger */
  shutdown(): void {
    for (const agent of this.activeAgents) {
      agent.stop();
    }
    this.activeAgents = [];

    if (this.activeLedger) {
      this.activeLedger.close();
      this.activeLedger = null;
    }
    this.activeBus = null;
    log.info('Orchestrator shutdown');
  }

  /** Create agents based on workflow template */
  private createAgents(template: WorkflowTemplate, bus: EventBus): void {
    this.activeAgents = [];

    switch (template) {
      case 'single-worker': {
        const builder = new BuilderAgent(BuilderAgent.createConfig(), bus, this.claude);
        builder.start();
        this.activeAgents.push(builder);
        break;
      }

      case 'worker-validator': {
        const builder = new BuilderAgent(BuilderAgent.createConfig(), bus, this.claude);
        const reviewer = new ReviewerAgent(ReviewerAgent.createConfig(), bus, this.gitManager);
        builder.start();
        reviewer.start();
        this.activeAgents.push(builder, reviewer);
        break;
      }

      case 'full-workflow': {
        const planner = new PlannerAgent(PlannerAgent.createConfig(), bus, this.claude);
        const builder = new BuilderAgent(BuilderAgent.createConfig(), bus, this.claude);
        const reviewer = new ReviewerAgent(ReviewerAgent.createConfig(), bus, this.gitManager);
        planner.start();
        builder.start();
        reviewer.start();
        this.activeAgents.push(planner, builder, reviewer);
        break;
      }

      case 'debug-workflow': {
        // Debug: skip planner, builder investigates and fixes
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
          }),
          bus,
          this.claude,
        );
        const reviewer = new ReviewerAgent(ReviewerAgent.createConfig(), bus, this.gitManager);
        builder.start();
        reviewer.start();
        this.activeAgents.push(builder, reviewer);
        break;
      }
    }

    log.info('Agents created', { template, count: this.activeAgents.length });
  }
}
