/**
 * Planner Agent — Reads issues, creates implementation plans
 * Triggered by ISSUE_OPENED, publishes PLAN_READY
 */
import { BaseAgent, type AgentResult } from '../_shared/agent.base.js';
import { ClaudeProvider, type ClaudeExecutionResult } from '../../providers/claude.provider.js';
import type { BuiltContext } from '../_shared/context.builder.js';
import type { Message, AgentConfig } from '../_shared/agent.types.js';
import { EventBus } from '../../core/event-bus.js';
import { loadPrompt } from '../_shared/prompt.loader.js';
import { createChildLogger } from '../../_shared/logger.js';

const log = createChildLogger('planner-agent');

export class PlannerAgent extends BaseAgent {
  private claude: ClaudeProvider;

  constructor(config: AgentConfig, bus: EventBus, claude?: ClaudeProvider) {
    super(config, bus);
    this.claude = claude ?? new ClaudeProvider();
  }

  /** Create default planner config */
  static createConfig(overrides?: Partial<AgentConfig>): AgentConfig {
    const prompt = loadPrompt('planner');
    return {
      id: 'planner',
      role: 'planner',
      modelLevel: 'level2',
      timeout: 180_000,
      maxIterations: 3,
      prompt: { system: prompt.system },
      contextStrategy: {
        sources: [
          { topic: 'ISSUE_OPENED', priority: 'required', strategy: 'latest', amount: 1 },
          { topic: 'STATE_SNAPSHOT', priority: 'medium', strategy: 'latest', amount: 1 },
        ],
        format: 'chronological',
        maxTokens: 100_000,
      },
      triggers: [
        { topic: 'ISSUE_OPENED', action: 'execute_task' },
      ],
      hooks: {
        onComplete: {
          action: 'publish_message',
          config: {
            topic: 'PLAN_READY',
          },
        },
      },
      ...overrides,
    };
  }

  protected async execute(context: BuiltContext, triggeringMessage: Message): Promise<AgentResult> {
    const systemPrompt = this.config.prompt.system;
    const taskPrompt = this.buildTaskPrompt(context, triggeringMessage);

    log.info('Planning task', {
      taskId: triggeringMessage.taskId,
      contextTokens: context.tokenEstimate,
    });

    const result = await this.claude.execute({
      prompt: taskPrompt,
      systemPrompt,
      allowedTools: ['Read', 'Glob', 'Grep'],
      maxTurns: 10,
      outputFormat: 'json',
      timeoutMs: this.config.timeout,
    });

    return this.parseResult(result);
  }

  private buildTaskPrompt(context: BuiltContext, triggeringMessage: Message): string {
    const parts: string[] = [];

    parts.push('## Task');
    parts.push(triggeringMessage.content.text);

    if (triggeringMessage.content.data) {
      const data = triggeringMessage.content.data;
      if (data.title) parts.push(`Title: ${data.title}`);
      if (data.issueNumber) parts.push(`Issue: #${data.issueNumber}`);
      if (data.complexity) parts.push(`Complexity: ${data.complexity}`);
    }

    if (context.prompt) {
      parts.push('\n## Context');
      parts.push(context.prompt);
    }

    parts.push('\n## Instructions');
    parts.push('Create a plan with acceptance criteria. Output as JSON.');

    return parts.join('\n');
  }

  private parseResult(result: ClaudeExecutionResult): AgentResult {
    try {
      const parsed = JSON.parse(result.output);
      return {
        summary: parsed.summary ?? 'Plan created',
        data: {
          plan: parsed.plan,
          summary: parsed.summary,
          filesAffected: parsed.filesAffected ?? [],
          risks: parsed.risks ?? [],
          acceptanceCriteria: parsed.acceptanceCriteria ?? [],
        },
        completionStatus: {
          canValidate: true,
          percentComplete: 100,
        },
      };
    } catch {
      // If JSON parsing fails, treat raw output as plan text
      return {
        summary: 'Plan created (raw format)',
        data: {
          plan: result.output,
          summary: result.output.slice(0, 200),
          filesAffected: [],
          acceptanceCriteria: [],
        },
        completionStatus: {
          canValidate: true,
          percentComplete: 100,
        },
      };
    }
  }
}
