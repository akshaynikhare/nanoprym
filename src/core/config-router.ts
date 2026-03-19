/**
 * Config Router — Complexity × TaskType routing
 * Based on complexity × taskType classification
 */
import type { TaskComplexity, TaskType } from '../_shared/types.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('config-router');

export type WorkflowTemplate = 'single-worker' | 'worker-validator' | 'full-workflow' | 'debug-workflow';

interface RouteResult {
  template: WorkflowTemplate;
  plannerLevel: string;
  builderLevel: string;
  validatorLevel: string;
  validatorCount: number;
  maxIterations: number;
}

const ROUTING_TABLE: Record<TaskComplexity, Record<TaskType, RouteResult>> = {
  TRIVIAL: {
    TASK: { template: 'single-worker', plannerLevel: 'level1', builderLevel: 'level1', validatorLevel: 'level1', validatorCount: 0, maxIterations: 2 },
    DEBUG: { template: 'single-worker', plannerLevel: 'level1', builderLevel: 'level1', validatorLevel: 'level1', validatorCount: 0, maxIterations: 2 },
    INQUIRY: { template: 'single-worker', plannerLevel: 'level1', builderLevel: 'level1', validatorLevel: 'level1', validatorCount: 0, maxIterations: 1 },
  },
  SIMPLE: {
    TASK: { template: 'worker-validator', plannerLevel: 'level1', builderLevel: 'level2', validatorLevel: 'level2', validatorCount: 1, maxIterations: 3 },
    DEBUG: { template: 'debug-workflow', plannerLevel: 'level1', builderLevel: 'level2', validatorLevel: 'level2', validatorCount: 1, maxIterations: 3 },
    INQUIRY: { template: 'single-worker', plannerLevel: 'level1', builderLevel: 'level1', validatorLevel: 'level1', validatorCount: 0, maxIterations: 1 },
  },
  STANDARD: {
    TASK: { template: 'full-workflow', plannerLevel: 'level2', builderLevel: 'level2', validatorLevel: 'level2', validatorCount: 2, maxIterations: 5 },
    DEBUG: { template: 'debug-workflow', plannerLevel: 'level2', builderLevel: 'level2', validatorLevel: 'level2', validatorCount: 2, maxIterations: 5 },
    INQUIRY: { template: 'worker-validator', plannerLevel: 'level2', builderLevel: 'level2', validatorLevel: 'level1', validatorCount: 1, maxIterations: 2 },
  },
  CRITICAL: {
    TASK: { template: 'full-workflow', plannerLevel: 'level2', builderLevel: 'level2', validatorLevel: 'level2', validatorCount: 3, maxIterations: 5 },
    DEBUG: { template: 'full-workflow', plannerLevel: 'level2', builderLevel: 'level2', validatorLevel: 'level2', validatorCount: 3, maxIterations: 5 },
    INQUIRY: { template: 'full-workflow', plannerLevel: 'level2', builderLevel: 'level2', validatorLevel: 'level2', validatorCount: 2, maxIterations: 3 },
  },
};

export function routeTask(complexity: TaskComplexity, taskType: TaskType): RouteResult {
  const result = ROUTING_TABLE[complexity][taskType];
  log.info('Routed task', { complexity, taskType, template: result.template, validators: result.validatorCount });
  return result;
}
