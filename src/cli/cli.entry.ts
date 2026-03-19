#!/usr/bin/env node
/**
 * Nanoprym CLI — Command-line interface
 * Usage: nanoprym <command> [options]
 */
import { Command } from 'commander';
import { Orchestrator } from '../core/orchestrator.js';
import { EventLedger } from '../core/event-ledger.js';
import { loadConfig } from '../config/config.loader.js';
// createChildLogger available from _shared/logger if needed
import { NANOPRYM_VERSION, LEDGER_DIR } from '../_shared/constants.js';
import type { TaskComplexity, TaskType, Message } from '../_shared/types.js';
import path from 'node:path';
import fs from 'node:fs';

// logger available via createChildLogger('cli') when needed

// ── Pretty console output ───────────────────────────────────
const C = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const TOPIC_ICONS: Record<string, string> = {
  ISSUE_OPENED: '📋',
  PLAN_READY: '📝',
  IMPLEMENTATION_READY: '🔨',
  WORKER_PROGRESS: '⏳',
  VALIDATION_RESULT: '✅',
  SCAN_RESULT: '🔍',
  STATE_SNAPSHOT: '📸',
  CLUSTER_COMPLETE: '🏁',
  HUMAN_DECISION: '👤',
  AUTO_FIX_APPLIED: '🔧',
};

function formatEvent(msg: Message): string {
  const icon = TOPIC_ICONS[msg.topic] ?? '•';
  const time = msg.timestamp.toISOString().slice(11, 19);
  const topic = msg.topic.padEnd(22);
  const sender = C.cyan(msg.sender.padEnd(12));
  const text = msg.content.text.slice(0, 120).replace(/\n/g, ' ');
  return `${C.dim(time)} ${icon} ${C.bold(topic)} ${sender} ${text}`;
}

// ── CLI Program ─────────────────────────────────────────────
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
  .option('-q, --quiet', 'Suppress event stream output')
  .action(async (description: string, options) => {
    loadConfig();
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

      console.log(`\n${C.bold('Task started')}: ${C.cyan(taskId)}`);
      console.log(`${C.dim('Complexity')}: ${options.complexity}  ${C.dim('Type')}: ${options.type}`);
      console.log(`${C.dim('Press Ctrl+C to stop')}\n`);

      // Live event stream — show every event as it happens
      const bus = orchestrator.getEventBus();
      if (bus && !options.quiet) {
        bus.subscribe((msg: Message) => {
          // Skip STATE_SNAPSHOT noise
          if (msg.topic === 'STATE_SNAPSHOT') return;
          console.log(formatEvent(msg));
        });
      }

      // Wait for completion or Ctrl+C
      await new Promise<void>((resolve) => {
        if (bus) {
          bus.subscribeTopic('CLUSTER_COMPLETE', (msg: Message) => {
            const status = msg.content.data?.status;
            console.log(`\n${status === 'failed' ? C.red('Task FAILED') : C.green('Task COMPLETE')}`);
            console.log(msg.content.text.slice(0, 300));
            orchestrator.shutdown();
            resolve();
          });
        }

        process.on('SIGINT', () => {
          console.log(`\n${C.yellow('Shutting down...')}`);
          orchestrator.shutdown();
          resolve();
        });
      });
    } catch (error) {
      console.error(C.red(`Failed: ${String(error)}`));
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
      console.log(C.green(`Task ${taskId} resumed`));
    } catch (error) {
      console.error(C.red(`Resume failed: ${String(error)}`));
      process.exit(1);
    }
  });

// ── nanoprym status ─────────────────────────────────────────
program
  .command('status')
  .description('Show status of all tasks')
  .option('--task <taskId>', 'Show specific task')
  .action(async (options) => {
    const ledgerDir = path.resolve(process.env.HOME ?? '~', LEDGER_DIR);

    if (!fs.existsSync(ledgerDir)) {
      console.log(C.dim('No tasks yet.'));
      return;
    }

    const ledgerFiles = fs.readdirSync(ledgerDir).filter(f => f.endsWith('.db'));

    if (ledgerFiles.length === 0) {
      console.log(C.dim('No tasks yet.'));
      return;
    }

    // Filter to specific task if requested
    const files = options.task
      ? ledgerFiles.filter(f => f.includes(options.task))
      : ledgerFiles;

    console.log(`\n${C.bold('Nanoprym Tasks')} (${files.length} total)\n`);

    for (const file of files.slice(-10)) {
      const taskId = file.replace('.db', '');
      const ledgerPath = path.join(ledgerDir, file);

      try {
        const ledger = await EventLedger.create(ledgerPath);
        const messages = ledger.query({});

        if (messages.length === 0) {
          console.log(`  ${C.dim(taskId)} — ${C.dim('empty')}`);
          ledger.close();
          continue;
        }

        const first = messages[0];
        const last = messages[messages.length - 1];
        const title = first.content.data?.title ?? first.content.text.slice(0, 60);
        const topics = messages.map(m => m.topic);
        const isComplete = topics.includes('CLUSTER_COMPLETE');
        const hasFailed = messages.some(m => m.topic === 'CLUSTER_COMPLETE' && (m.content.data?.status === 'failed' || m.content.data?.status === 'escalated'));

        let status = C.yellow('in progress');
        if (isComplete && !hasFailed) status = C.green('completed');
        if (hasFailed) status = C.red('failed');

        console.log(`  ${C.cyan(taskId.slice(0, 8))} ${status} ${C.bold(String(title))}`);
        console.log(`    ${C.dim('Events')}: ${messages.length}  ${C.dim('Last')}: ${last.topic} by ${last.sender}`);

        // Show detailed events if specific task requested
        if (options.task) {
          console.log(`\n  ${C.bold('Event Log')}:`);
          for (const msg of messages) {
            if (msg.topic === 'STATE_SNAPSHOT') continue;
            console.log(`  ${formatEvent(msg)}`);
          }
        }

        ledger.close();
      } catch {
        console.log(`  ${C.dim(taskId)} — ${C.red('unreadable')}`);
      }
    }
    console.log('');
  });

// ── nanoprym logs ───────────────────────────────────────────
program
  .command('logs')
  .description('Stream events from a task')
  .argument('<taskId>', 'Task ID (or partial match)')
  .action(async (taskId: string) => {
    const ledgerDir = path.resolve(process.env.HOME ?? '~', LEDGER_DIR);
    const match = fs.readdirSync(ledgerDir).find(f => f.includes(taskId));

    if (!match) {
      console.error(C.red(`No task found matching: ${taskId}`));
      process.exit(1);
    }

    const ledger = await EventLedger.create(path.join(ledgerDir, match));
    const messages = ledger.query({});

    console.log(`\n${C.bold('Task')}: ${match.replace('.db', '')}`);
    console.log(`${C.bold('Events')}: ${messages.length}\n`);

    for (const msg of messages) {
      if (msg.topic === 'STATE_SNAPSHOT') continue;
      console.log(formatEvent(msg));
    }

    ledger.close();
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
    console.log(`TOM sidecar: ${alive ? C.green('running') : C.red('not running')}`);
    if (!alive) console.log(C.dim('Start with: make tom-start'));
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
      console.log(`Saved:      ${C.green((result.ratio * 100).toFixed(1) + '%')}`);
      console.log(`Layers:     ${result.layers.join(', ')}`);
      console.log(`Output:     ${result.text}`);
    } catch {
      console.error(C.red('TOM sidecar not running.') + ' Start with: make tom-start');
    }
  });

// ── nanoprym audit ──────────────────────────────────────────
program
  .command('audit')
  .description('View audit trail for a task')
  .argument('[taskId]', 'Task ID (optional, shows all if omitted)')
  .option('-n, --count <n>', 'Number of entries', '20')
  .action(async (taskId: string | undefined, options) => {
    const ledgerDir = path.resolve(process.env.HOME ?? '~', LEDGER_DIR);

    if (!fs.existsSync(ledgerDir)) {
      console.log(C.dim('No audit entries.'));
      return;
    }

    const files = taskId
      ? fs.readdirSync(ledgerDir).filter(f => f.includes(taskId))
      : fs.readdirSync(ledgerDir).filter(f => f.endsWith('.db')).slice(-5);

    for (const file of files) {
      const ledger = await EventLedger.create(path.join(ledgerDir, file));
      const messages = ledger.query({ limit: parseInt(options.count, 10), order: 'DESC' });

      console.log(`\n${C.bold('Task')}: ${file.replace('.db', '')}`);
      for (const msg of messages.reverse()) {
        console.log(formatEvent(msg));
      }
      ledger.close();
    }
  });

// ── nanoprym health ─────────────────────────────────────────
program
  .command('health')
  .description('Check orchestrator health status')
  .option('-p, --port <port>', 'Health check port', '9090')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const http = await import('node:http');

    const request = http.default.request(
      { hostname: '127.0.0.1', port, path: '/health', method: 'GET', timeout: 3000 },
      (response) => {
        let data = '';
        response.on('data', (chunk: Buffer) => { data += chunk; });
        response.on('end', () => {
          try {
            const health = JSON.parse(data);
            const statusColor = health.status === 'ok' ? C.green : C.red;
            console.log(`\n${C.bold('Orchestrator Health')}\n`);
            console.log(`  ${C.dim('Status')}:      ${statusColor(health.status)}`);
            console.log(`  ${C.dim('Version')}:     ${health.version}`);
            console.log(`  ${C.dim('Uptime')}:      ${health.uptime}s`);
            console.log(`  ${C.dim('Active Task')}: ${health.activeTask ? C.yellow('yes') : C.dim('no')}`);
            console.log(`  ${C.dim('Timestamp')}:   ${health.timestamp}`);
            console.log('');
          } catch {
            console.error(C.red('Invalid response from health endpoint'));
            process.exit(1);
          }
        });
      },
    );

    request.on('error', () => {
      console.error(C.red(`No orchestrator running on port ${port}`));
      process.exit(1);
    });

    request.on('timeout', () => {
      request.destroy();
      console.error(C.red(`Health check timed out (port ${port})`));
      process.exit(1);
    });

    request.end();
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
