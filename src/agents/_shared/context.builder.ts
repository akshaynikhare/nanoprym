/**
 * Context Builder — Priority-based context assembly with token budgeting
 *
 * Selects messages from the event bus based on the agent's contextStrategy.
 * Required sources always included. High/medium/low included until budget exhausted.
 * Compact variants used as fallback if full messages don't fit.
 *
 * Token estimation: chars / 4 (conservative).
 */
import { EventBus } from '../../core/event-bus.js';
import type { ContextStrategy, ContextSource, Message, MessageTopic } from './agent.types.js';
import { createChildLogger } from '../../_shared/logger.js';
import { MAX_CHARS_GUARD } from '../../_shared/constants.js';

const log = createChildLogger('context-builder');
const CHARS_PER_TOKEN = 4;

export interface ContextSection {
  topic: MessageTopic;
  priority: string;
  messages: Message[];
  charCount: number;
}

export interface BuiltContext {
  sections: ContextSection[];
  prompt: string;
  tokenEstimate: number;
  charCount: number;
  truncated: boolean;
}

export class ContextBuilder {
  private bus: EventBus;
  private strategy: ContextStrategy;

  constructor(bus: EventBus, strategy: ContextStrategy) {
    this.bus = bus;
    this.strategy = strategy;
  }

  /** Build context for a given task, respecting token budget */
  build(taskId: string): BuiltContext {
    const maxChars = Math.min(
      this.strategy.maxTokens * CHARS_PER_TOKEN,
      MAX_CHARS_GUARD,
    );

    // Sort sources by priority
    const priorityOrder = { required: 0, high: 1, medium: 2, low: 3 };
    const sortedSources = [...this.strategy.sources].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );

    const sections: ContextSection[] = [];
    let totalChars = 0;
    let truncated = false;

    for (const source of sortedSources) {
      const messages = this.fetchMessages(taskId, source);
      const section = this.buildSection(source, messages);

      if (source.priority === 'required') {
        // Required: always include
        sections.push(section);
        totalChars += section.charCount;
      } else if (totalChars + section.charCount <= maxChars) {
        // Fits within budget
        sections.push(section);
        totalChars += section.charCount;
      } else if (source.compactAmount && source.compactAmount < source.amount) {
        // Try compact variant (fewer messages)
        const compactMessages = messages.slice(-source.compactAmount);
        const compactSection = this.buildSection(source, compactMessages);
        if (totalChars + compactSection.charCount <= maxChars) {
          sections.push(compactSection);
          totalChars += compactSection.charCount;
          truncated = true;
        } else {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    }

    // Assemble prompt text
    const prompt = this.renderPrompt(sections);

    log.debug('Context built', {
      taskId,
      sections: sections.length,
      totalChars,
      tokenEstimate: Math.ceil(totalChars / CHARS_PER_TOKEN),
      truncated,
    });

    return {
      sections,
      prompt,
      tokenEstimate: Math.ceil(totalChars / CHARS_PER_TOKEN),
      charCount: totalChars,
      truncated,
    };
  }

  /** Fetch messages from the event bus based on source config */
  private fetchMessages(taskId: string, source: ContextSource): Message[] {
    const queryOpts: Parameters<EventBus['query']>[0] = {
      taskId,
      topic: source.topic,
    };

    if (source.since) {
      queryOpts.since = source.since;
    }

    if (source.strategy === 'latest') {
      queryOpts.order = 'DESC';
      queryOpts.limit = source.amount;
      const results = this.bus.query(queryOpts);
      return results.reverse(); // Return chronological order
    }

    if (source.strategy === 'oldest') {
      queryOpts.order = 'ASC';
      queryOpts.limit = source.amount;
      return this.bus.query(queryOpts);
    }

    // 'all' strategy
    queryOpts.order = 'ASC';
    return this.bus.query(queryOpts);
  }

  /** Build a context section from messages */
  private buildSection(source: ContextSource, messages: Message[]): ContextSection {
    const charCount = messages.reduce((sum, msg) => {
      return sum + (msg.content.text?.length ?? 0) +
        (msg.content.data ? JSON.stringify(msg.content.data).length : 0);
    }, 0);

    return {
      topic: source.topic,
      priority: source.priority,
      messages,
      charCount,
    };
  }

  /** Render sections into a prompt string (chronological) */
  private renderPrompt(sections: ContextSection[]): string {
    // Flatten all messages, sort chronologically
    const allMessages = sections.flatMap(s => s.messages);
    allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const parts: string[] = [];
    for (const msg of allMessages) {
      parts.push(`== [${msg.topic}] from ${msg.sender} ==`);
      parts.push(msg.content.text);
      if (msg.content.data) {
        parts.push(JSON.stringify(msg.content.data, null, 2));
      }
      parts.push('');
    }

    return parts.join('\n');
  }
}
