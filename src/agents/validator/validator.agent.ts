/**
 * Validator Agent — Orchestrates scanner plugins + test runner
 * Triggered by IMPLEMENTATION_READY (before Copilot review)
 * Publishes SCAN_RESULT with pass/fail + detailed errors
 *
 * Stage 1 validation: deterministic, free, fast
 * If scanners pass → triggers Copilot review (Stage 2)
 * If scanners fail → sends errors back to Builder
 */
import { BaseAgent, type AgentResult } from '../_shared/agent.base.js';
import { runAllScanners } from '../../plugins/plugin.loader.js';
import type { BuiltContext } from '../_shared/context.builder.js';
import type { Message, AgentConfig } from '../_shared/agent.types.js';
import { EventBus } from '../../core/event-bus.js';
import { createChildLogger } from '../../_shared/logger.js';

const log = createChildLogger('validator-agent');

export class ValidatorAgent extends BaseAgent {
  private workingDir: string;

  constructor(config: AgentConfig, bus: EventBus, workingDir?: string) {
    super(config, bus);
    this.workingDir = workingDir ?? process.cwd();
  }

  static createConfig(overrides?: Partial<AgentConfig>): AgentConfig {
    return {
      id: 'validator',
      role: 'validator',
      modelLevel: 'level1',
      timeout: 60_000,
      maxIterations: 3,
      prompt: { system: '' }, // No LLM needed — runs plugins deterministically
      contextStrategy: {
        sources: [
          { topic: 'IMPLEMENTATION_READY', priority: 'required', strategy: 'latest', amount: 1 },
        ],
        format: 'chronological',
        maxTokens: 10_000,
      },
      triggers: [
        { topic: 'IMPLEMENTATION_READY', action: 'execute_task' },
      ],
      hooks: {
        onComplete: {
          action: 'publish_message',
          config: { topic: 'SCAN_RESULT' },
        },
      },
      ...overrides,
    };
  }

  protected async execute(_context: BuiltContext, triggeringMessage: Message): Promise<AgentResult> {
    log.info('Running validation scanners', { taskId: triggeringMessage.taskId });

    const { passed, results } = await runAllScanners(this.workingDir);

    // Collect all errors across scanners
    const allErrors: string[] = [];
    const allWarnings: string[] = [];
    const scannerSummaries: Record<string, { passed: boolean; errorCount: number }> = {};

    for (const [name, result] of results) {
      scannerSummaries[name] = {
        passed: result.success,
        errorCount: result.errors.length,
      };

      for (const err of result.errors) {
        const location = err.file ? `${err.file}:${err.line ?? '?'}` : '';
        const rule = err.rule ? `[${err.rule}]` : '';
        allErrors.push(`${name}: ${location} ${rule} ${err.message}`);
      }

      allWarnings.push(...result.warnings.map(w => `${name}: ${w}`));
    }

    log.info('Validation complete', {
      passed,
      errorCount: allErrors.length,
      warningCount: allWarnings.length,
      scanners: scannerSummaries,
    });

    return {
      summary: passed
        ? `All scanners passed (${results.size} scanners, 0 errors)`
        : `Scanners failed (${allErrors.length} errors)`,
      data: {
        approved: passed,
        errors: allErrors,
        warnings: allWarnings,
        scanners: scannerSummaries,
      },
      completionStatus: {
        canValidate: true,
        percentComplete: 100,
      },
    };
  }
}
