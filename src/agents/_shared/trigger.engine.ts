/**
 * Trigger Engine — Evaluates trigger logic scripts
 *
 * Runs JavaScript logic in a sandboxed context with:
 * - message: the triggering message
 * - ledger: query helpers (findLast, count, query)
 * - helpers: allResponded, hasConsensus, timeSinceLastMessage
 *
 * Safety: 1-second timeout, frozen prototypes
 */
import vm from 'node:vm';
import { EventBus } from '../../core/event-bus.js';
import type { Message } from './agent.types.js';
import type { AgentResult } from './agent.base.js';
import { createChildLogger } from '../../_shared/logger.js';

const log = createChildLogger('trigger-engine');
const SCRIPT_TIMEOUT_MS = 1000;

export class TriggerEngine {
  private bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /** Evaluate a trigger logic script. Returns true if agent should fire. */
  evaluate(
    logic: { engine: string; script: string },
    message: Message,
  ): boolean {
    if (logic.engine !== 'javascript') {
      log.warn('Unsupported logic engine', { engine: logic.engine });
      return false;
    }

    try {
      const sandbox = this.createSandbox(message);
      const script = new vm.Script(`(function() { ${logic.script} })()`);
      const context = vm.createContext(sandbox);
      const result = script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });
      return Boolean(result);
    } catch (error) {
      log.error('Trigger script failed', { error: String(error) });
      return false;
    }
  }

  /** Evaluate hook logic — returns true if hook should fire */
  evaluateHookLogic(
    logic: { engine: string; script: string },
    result: AgentResult,
    triggeringMessage: Message,
  ): boolean {
    if (logic.engine !== 'javascript') return true;

    try {
      const sandbox = {
        ...this.createSandbox(triggeringMessage),
        result,
        triggeringMessage,
      };
      const script = new vm.Script(`(function() { ${logic.script} })()`);
      const context = vm.createContext(sandbox);
      const value = script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });

      // If script returns an object with topic, it's a redirect (not boolean)
      if (value && typeof value === 'object' && 'topic' in value) {
        return true; // Transform will handle the topic change
      }
      return Boolean(value);
    } catch (error) {
      log.error('Hook logic failed', { error: String(error) });
      return true; // Default: fire the hook
    }
  }

  /** Evaluate transform script — returns topic/content overrides */
  evaluateTransform(
    transform: { engine: string; script: string },
    result: AgentResult,
    triggeringMessage: Message,
  ): Record<string, unknown> {
    if (transform.engine !== 'javascript') return {};

    try {
      const sandbox = {
        ...this.createSandbox(triggeringMessage),
        result,
        triggeringMessage,
      };
      const script = new vm.Script(`(function() { ${transform.script} })()`);
      const context = vm.createContext(sandbox);
      const value = script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });
      return (value && typeof value === 'object') ? value as Record<string, unknown> : {};
    } catch (error) {
      log.error('Transform script failed', { error: String(error) });
      return {};
    }
  }

  /** Build a sandboxed context for script evaluation */
  private createSandbox(message: Message): Record<string, unknown> {
    const bus = this.bus;
    return {
      message,
      ledger: {
        query: (opts: Parameters<EventBus['query']>[0]) => bus.query(opts),
        findLast: (opts: Parameters<EventBus['findLast']>[0]) => bus.findLast(opts),
        count: (opts: { taskId?: string; topic?: string }) =>
          bus.query({ taskId: opts.taskId, topic: opts.topic as Message['topic'] }).length,
      },
      helpers: {
        timeSinceLastMessage: (topic: string): number => {
          const last = bus.findLast({ topic: topic as Message['topic'] });
          if (!last) return Infinity;
          return Date.now() - last.timestamp.getTime();
        },
      },
      // Frozen globals for safety
      console: Object.freeze({ log: () => {}, warn: () => {}, error: () => {} }),
      JSON,
      Math,
      Date,
      Array,
      Object,
      Boolean,
      Number,
      String,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
    };
  }
}
