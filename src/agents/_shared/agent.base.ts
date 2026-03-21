/**
 * Base Agent — State machine for all Nanoprym agents
 *
 * States: idle → evaluating → building-context → executing → idle
 *
 * Each agent:
 * - Subscribes to trigger topics on the event bus
 * - When triggered, evaluates optional logic script
 * - If trigger fires, builds context from ledger
 * - Executes task via provider (Claude, Copilot, etc.)
 * - Publishes result via onComplete hook
 */
import { EventBus } from '../../core/event-bus.js';
import type {
  AgentConfig,
  AgentRole,
  AgentState,
  Message,
  MessageTopic,
} from './agent.types.js';
import { TriggerEngine } from './trigger.engine.js';
import { ContextBuilder } from './context.builder.js';
import { createChildLogger } from '../../_shared/logger.js';
import { MAX_RETRY_ATTEMPTS } from '../../_shared/constants.js';

export abstract class BaseAgent {
  readonly id: string;
  readonly role: AgentRole;
  protected state: AgentState = 'idle';
  protected iteration = 0;
  protected config: AgentConfig;
  protected bus: EventBus;
  protected triggerEngine: TriggerEngine;
  protected contextBuilder: ContextBuilder;
  protected log: ReturnType<typeof createChildLogger>;

  constructor(config: AgentConfig, bus: EventBus) {
    this.id = config.id;
    this.role = config.role;
    this.config = config;
    this.bus = bus;
    this.triggerEngine = new TriggerEngine(bus);
    this.contextBuilder = new ContextBuilder(bus, config.contextStrategy);
    this.log = createChildLogger(`agent:${this.id}`);
  }

  /** Start listening for trigger topics */
  start(): void {
    for (const trigger of this.config.triggers) {
      this.bus.subscribeTopic(trigger.topic, (message: Message) => {
        this.handleTrigger(trigger.topic, message).catch((err) => {
          this.log.error('Trigger handling failed', { error: String(err) });
        });
      });
    }
    this.log.info('Agent started', { role: this.role, triggers: this.config.triggers.map(t => t.topic) });
  }

  /** Stop listening */
  stop(): void {
    this.state = 'idle';
    this.log.info('Agent stopped');
  }

  getState(): AgentState {
    return this.state;
  }

  getIteration(): number {
    return this.iteration;
  }

  /** Handle an incoming message that matches a trigger topic */
  private async handleTrigger(topic: MessageTopic, message: Message): Promise<void> {
    if (this.state !== 'idle') {
      this.log.debug('Ignoring trigger — agent busy', { state: this.state, topic });
      return;
    }

    // Find the matching trigger config
    const trigger = this.config.triggers.find(t => t.topic === topic);
    if (!trigger) return;

    // Phase 1: Evaluate trigger logic (optional)
    this.state = 'evaluating';
    if (trigger.logic) {
      const shouldFire = this.triggerEngine.evaluate(trigger.logic, message);
      if (!shouldFire) {
        this.state = 'idle';
        this.log.debug('Trigger logic returned false', { topic });
        return;
      }
    }

    // Phase 2: Build context
    this.state = 'building-context';
    const context = this.contextBuilder.build(message.taskId);
    this.log.info('Context built', {
      taskId: message.taskId,
      tokenEstimate: context.tokenEstimate,
      sourceCount: context.sections.length,
    });

    // Phase 3: Execute task
    this.state = 'executing';
    this.iteration++;

    try {
      const result = await this.execute(context, message);
      await this.handleResult(result, message);
    } catch (error) {
      await this.handleError(error, message);
    }

    this.state = 'idle';
  }

  /** Subclasses implement the actual execution logic */
  protected abstract execute(
    context: ReturnType<ContextBuilder['build']>,
    triggeringMessage: Message,
  ): Promise<AgentResult>;

  /** Process the result — publish via onComplete hook */
  private async handleResult(result: AgentResult, triggeringMessage: Message): Promise<void> {
    const hook = this.config.hooks?.onComplete;
    if (!hook) return;

    // Check hook logic (should we publish?)
    if (hook.logic) {
      const shouldPublish = this.triggerEngine.evaluateHookLogic(hook.logic, result, triggeringMessage);
      if (!shouldPublish) {
        this.log.debug('Hook logic returned false, skipping publish');
        return;
      }
    }

    // Determine topic — transform can override
    let topic: MessageTopic = (hook.config?.topic as MessageTopic) ?? 'CLUSTER_COMPLETE';
    let content = hook.config?.content as Message['content'] | undefined;

    if (hook.transform) {
      const transformed = this.triggerEngine.evaluateTransform(hook.transform, result, triggeringMessage);
      if (transformed.topic) topic = transformed.topic as MessageTopic;
      if (transformed.content) content = transformed.content as Message['content'];
    }

    this.bus.publish({
      taskId: triggeringMessage.taskId,
      topic,
      sender: this.id,
      content: content ?? {
        text: result.summary ?? JSON.stringify(result),
        data: result.data as Record<string, unknown> | undefined,
      },
    });

    this.log.info('Result published', { topic, iteration: this.iteration });
  }

  /** Handle execution errors — retry or escalate */
  private async handleError(error: unknown, triggeringMessage: Message): Promise<void> {
    const maxRetries = this.config.maxIterations ?? MAX_RETRY_ATTEMPTS;
    const errorMessage = error instanceof Error ? error.message : String(error);

    this.log.error('Execution failed', {
      iteration: this.iteration,
      maxRetries,
      error: errorMessage,
    });

    if (this.iteration < maxRetries) {
      // Publish failure progress so we can retry
      this.bus.publish({
        taskId: triggeringMessage.taskId,
        topic: 'WORKER_PROGRESS',
        sender: this.id,
        content: {
          text: `Execution failed (attempt ${this.iteration}/${maxRetries}): ${errorMessage}`,
          data: { error: errorMessage, iteration: this.iteration, canValidate: false },
        },
      });
    } else {
      // Escalate — max retries reached
      this.bus.publish({
        taskId: triggeringMessage.taskId,
        topic: 'CLUSTER_COMPLETE',
        sender: this.id,
        content: {
          text: `Agent ${this.id} failed after ${this.iteration} attempts`,
          data: { error: errorMessage, status: 'failed', iteration: this.iteration },
        },
      });
    }
  }
}

/** Result returned by agent execute() */
export interface AgentResult {
  summary: string;
  data?: Record<string, unknown>;
  completionStatus?: {
    canValidate: boolean;
    percentComplete: number;
    blockers?: string[];
    nextSteps?: string[];
  };
}
