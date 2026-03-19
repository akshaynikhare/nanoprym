/**
 * Nanoprym Core Types
 * Shared across all modules
 */

// ── Agent Types ──────────────────────────────────────────────
export type AgentRole = 'planner' | 'builder' | 'reviewer' | 'validator';
export type AgentState = 'idle' | 'evaluating' | 'building-context' | 'executing' | 'completed' | 'failed';

export interface AgentConfig {
  id: string;
  role: AgentRole;
  modelLevel: ModelLevel;
  timeout: number;
  maxIterations: number;
  prompt: { system: string; subsequent?: string };
  contextStrategy: ContextStrategy;
  triggers: Trigger[];
  hooks?: AgentHooks;
}

// ── Model Types ──────────────────────────────────────────────
export type ModelLevel = 'level1' | 'level2' | 'level3';
export type ProviderName = 'claude' | 'copilot' | 'ollama' | 'gemini' | 'deepseek';

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  subscription?: string;
  maxTurns?: number;
  timeout?: number;
}

// ── Task Types ───────────────────────────────────────────────
export type TaskComplexity = 'TRIVIAL' | 'SIMPLE' | 'STANDARD' | 'CRITICAL';
export type TaskType = 'TASK' | 'DEBUG' | 'INQUIRY';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  description: string;
  complexity: TaskComplexity;
  taskType: TaskType;
  status: TaskStatus;
  issueNumber?: number;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Message Bus Types ────────────────────────────────────────
export type MessageTopic =
  | 'ISSUE_OPENED'
  | 'PLAN_READY'
  | 'IMPLEMENTATION_READY'
  | 'VALIDATION_RESULT'
  | 'WORKER_PROGRESS'
  | 'STATE_SNAPSHOT'
  | 'SCAN_RESULT'
  | 'AUTO_FIX_APPLIED'
  | 'EVOLUTION_PROPOSED'
  | 'HUMAN_DECISION'
  | 'CLUSTER_COMPLETE';

export interface Message {
  id: string;
  taskId: string;
  topic: MessageTopic;
  sender: string;
  content: {
    text: string;
    data?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

// ── Context Types ────────────────────────────────────────────
export type ContextPriority = 'required' | 'high' | 'medium' | 'low';

export interface ContextSource {
  topic: MessageTopic;
  priority: ContextPriority;
  strategy: 'latest' | 'oldest' | 'all';
  amount: number;
  since?: string;
  compactAmount?: number;
}

export interface ContextStrategy {
  sources: ContextSource[];
  format: 'chronological';
  maxTokens: number;
}

// ── Trigger Types ────────────────────────────────────────────
export interface Trigger {
  topic: MessageTopic;
  action: 'execute_task';
  logic?: {
    engine: 'javascript';
    script: string;
  };
}

// ── Hook Types ───────────────────────────────────────────────
export interface AgentHooks {
  onComplete?: {
    action: 'publish_message' | 'execute_command';
    config?: Record<string, unknown>;
    logic?: { engine: 'javascript'; script: string };
    transform?: { engine: 'javascript'; script: string };
  };
}

// ── Acceptance Criteria ──────────────────────────────────────
export type CriteriaPriority = 'MUST' | 'SHOULD' | 'NICE';
export type CriteriaStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'CANNOT_VALIDATE';

export interface AcceptanceCriterion {
  id: string;
  criterion: string;
  verification: string;
  priority: CriteriaPriority;
}

export interface CriteriaResult {
  id: string;
  status: CriteriaStatus;
  evidence?: {
    command: string;
    exitCode: number;
    output: string;
  };
  reason?: string;
}

// ── Plan Types ───────────────────────────────────────────────
export interface Plan {
  text: string;
  summary: string;
  filesAffected: string[];
  risks?: string[];
  acceptanceCriteria: AcceptanceCriterion[];
}

// ── State Snapshot ───────────────────────────────────────────
export interface StateSnapshot {
  version: number;
  updatedAt: Date;
  taskId: string;
  task: { raw: string; title: string; issueNumber?: number; source: string };
  plan?: { text: string; summary: string; acceptanceCriteria: AcceptanceCriterion[]; filesAffected: string[] };
  progress?: { canValidate: boolean; percentComplete: number; blockers: string[]; nextSteps: string[] };
  validation?: { approved: boolean; errors: string[]; criteriaResults: CriteriaResult[] };
  debug?: { fixPlan: string; successCriteria: string[]; rootCauses: string[] };
}

// ── Config Types ─────────────────────────────────────────────
export interface NanoprymConfig {
  version: string;
  hardware: { ram_gb: number; gpu: string };
  providers: Record<string, ProviderConfig>;
  tom: TomConfig;
  tasks: { max_concurrent: number; max_iterations: number; retry_attempts: number };
  git: { worktree_isolation: boolean; conventional_commits: boolean; auto_pr: boolean; branch_prefix: string };
  context: Record<AgentRole, number>;
  testing: { coverage_overall: number; coverage_branch: number; runner: string };
}

export interface TomConfig {
  enabled: boolean;
  sidecar_socket: string;
  compression: { layer1_rules: boolean; layer2_spacy: boolean; layer3_cache: boolean };
  routing: { bypass_first_gen: boolean; bypass_complex: boolean; compress_iterations: boolean; route_auxiliary: boolean };
  cloud_budget_monthly_usd: number;
}
