#!/usr/bin/env node
/**
 * Nanoprym CLI — Command-line interface
 * Usage: nanoprym <command> [options]
 */
import { Command } from 'commander';
import { Orchestrator } from '../core/orchestrator.js';
import { loadConfig } from '../config/config.loader.js';
import { createChildLogger } from '../_shared/logger.js';
import { NANOPRYM_VERSION } from '../_shared/constants.js';
import type { TaskComplexity, TaskType } from '../_shared/types.js';

const log = createChildLogger('cli');

const program = new Command();

program
  .name('nanoprym')
  .description('Self-evolving AI agent orchestration system')
  .version(NANOPRYM_VERSION);

// ── nanoprym run ────────────────────────────────────────────
program
  .command('run')
  .description('Run a task (from issue or description)')
  .argument('<description>', 'Task description or GitHub issue number')
  .option('-c, --complexity <level>', 'Task complexity: TRIVIAL|SIMPLE|STANDARD|CRITICAL', 'STANDARD')
  .option('-t, --type <type>', 'Task type: TASK|DEBUG|INQUIRY', 'TASK')
  .option('--title <title>', 'Task title')
  .option('--issue <number>', 'GitHub issue number')
  .option('--source <source>', 'Task source', 'cli')
  .action(async (description: string, options) => {
    loadConfig(); // validates config exists and is parseable
    const orchestrator = new Orchestrator({ repoRoot: process.cwd() });

    try {
      const taskId = await orchestrator.startTask({
        title: options.title ?? description.slice(0, 80),
        description,
        complexity: options.complexity as TaskComplexity,
        taskType: options.type as TaskType,
        issueNumber: options.issue ? parseInt(options.issue, 10) : undefined,
        source: options.source,
      });

      log.info('Task started', { taskId });
      console.log(`Task ${taskId} started`);

      // Keep process alive while task runs
      process.on('SIGINT', () => {
        log.info('Shutting down...');
        orchestrator.shutdown();
        process.exit(0);
      });
    } catch (error) {
      log.error('Task failed to start', { error: String(error) });
      process.exit(1);
    }
  });

// ── nanoprym resume ─────────────────────────────────────────
program
  .command('resume')
  .description('Resume a failed/interrupted task')
  .argument('<taskId>', 'Task ID to resume')
  .action(async (taskId: string) => {
    const orchestrator = new Orchestrator({ repoRoot: process.cwd() });

    try {
      await orchestrator.resumeTask(taskId);
      log.info('Task resumed', { taskId });
    } catch (error) {
      log.error('Resume failed', { error: String(error) });
      process.exit(1);
    }
  });

// ── nanoprym status ─────────────────────────────────────────
program
  .command('status')
  .description('Show current task status')
  .action(async () => {
    // TODO: Read from ledger directory, show active tasks
    console.log('Status: No active tasks (stub)');
  });

// ── nanoprym tom ────────────────────────────────────────────
const tomCmd = program
  .command('tom')
  .description('Token Optimization Module commands');

tomCmd
  .command('status')
  .description('TOM status and metrics')
  .action(async () => {
    const { TomClient } = await import('../tom/tom.client.js');
    const client = new TomClient();
    const alive = await client.ping();
    console.log(`TOM sidecar: ${alive ? 'running' : 'not running'}`);
  });

tomCmd
  .command('compress')
  .description('Test compression on input text')
  .argument('<text>', 'Text to compress')
  .action(async (text: string) => {
    const { TomClient } = await import('../tom/tom.client.js');
    const client = new TomClient();
    try {
      const result = await client.compress(text);
      console.log(`Original:   ${result.original_chars} chars`);
      console.log(`Compressed: ${result.compressed_chars} chars`);
      console.log(`Ratio:      ${(result.ratio * 100).toFixed(1)}% saved`);
      console.log(`Layers:     ${result.layers.join(', ')}`);
      console.log(`Output:     ${result.text}`);
    } catch {
      console.error('TOM sidecar not running. Start with: make tom-start');
    }
  });

// ── nanoprym audit ──────────────────────────────────────────
program
  .command('audit')
  .description('View audit trail')
  .option('-n, --count <n>', 'Number of recent entries', '20')
  .action(async (options) => {
    // TODO: Query ledger files
    console.log(`Showing last ${options.count} audit entries (stub)`);
  });

// ── nanoprym config ─────────────────────────────────────────
program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

program.parse();
