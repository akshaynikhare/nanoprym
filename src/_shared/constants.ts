/**
 * Nanoprym Constants
 */

// ── Versioning ───────────────────────────────────────────────
export const NANOPRYM_VERSION = '0.1.0';
export const SPEC_VERSION = '2.0.0';

// ── Paths ────────────────────────────────────────────────────
export const CONFIG_DIR = '.nanoprym';
export const LEDGER_DIR = `${CONFIG_DIR}/ledgers`;
export const KB_DIR = `${CONFIG_DIR}/kb`;
export const RESEARCH_DIR = `${CONFIG_DIR}/research`;

// ── Limits ───────────────────────────────────────────────────
export const MAX_RETRY_ATTEMPTS = 3;
export const MAX_TASK_ITERATIONS = 5;
export const STUCK_DETECTION_THRESHOLD = 3.5;
export const CONTEXT_STALENESS_THRESHOLD = 5; // re-read after N tool calls
export const MAX_CHARS_GUARD = 500_000;

// ── Token Budgets ────────────────────────────────────────────
export const TOKEN_BUDGET = {
  planner: 100_000,
  builder: 200_000,
  reviewer: 50_000,
  validator: 50_000,
} as const;

// ── State Snapshot Limits ────────────────────────────────────
export const SNAPSHOT_LIMITS = {
  taskTextMax: 2000,
  planTextMax: 2500,
  summaryMax: 300,
  errorsMax: 5,
  blockersMax: 5,
  criteriaMax: 10,
} as const;

// ── TOM ──────────────────────────────────────────────────────
export const TOM_SOCKET_PATH = '/tmp/nanoprym-tom.sock';
export const TOM_CLOUD_BUDGET_USD = 5.00;

// ── Git ──────────────────────────────────────────────────────
export const GIT_BRANCH_PREFIX = 'nanoprym/';
export const CONVENTIONAL_COMMIT_TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore',
] as const;
