/**
 * Nanoprym Error Hierarchy
 */

export class NanoprymError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'NanoprymError';
  }
}

export class ProviderError extends NanoprymError {
  constructor(message: string, retryable: boolean, context?: Record<string, unknown>) {
    super(message, 'PROVIDER_ERROR', retryable, context);
    this.name = 'ProviderError';
  }
}

export class AgentStuckError extends NanoprymError {
  constructor(agentId: string, stuckScore: number) {
    super(`Agent ${agentId} stuck (score: ${stuckScore})`, 'AGENT_STUCK', true, { agentId, stuckScore });
    this.name = 'AgentStuckError';
  }
}

export class ContextBudgetExceeded extends NanoprymError {
  constructor(agentRole: string, tokenCount: number, budget: number) {
    super(
      `Context budget exceeded for ${agentRole}: ${tokenCount} > ${budget}`,
      'CONTEXT_BUDGET_EXCEEDED',
      false,
      { agentRole, tokenCount, budget }
    );
    this.name = 'ContextBudgetExceeded';
  }
}

export class LedgerWriteError extends NanoprymError {
  constructor(message: string) {
    super(message, 'LEDGER_WRITE_ERROR', true);
    this.name = 'LedgerWriteError';
  }
}

export class TaskFailedError extends NanoprymError {
  constructor(taskId: string, reason: string, attempts: number) {
    super(`Task ${taskId} failed after ${attempts} attempts: ${reason}`, 'TASK_FAILED', false, { taskId, attempts });
    this.name = 'TaskFailedError';
  }
}
