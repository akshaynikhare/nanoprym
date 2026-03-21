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
import { NANOPRYM_VERSION, LEDGER_DIR, DASHBOARD_DIST_DIR } from '../_shared/constants.js';
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
  .option('-r, --repo <name>', 'Target repo name (from nanoprym repo list)')
  .option('-q, --quiet', 'Suppress event stream output')
  .action(async (description: string, options) => {
    const config = loadConfig();

    // Resolve repo root — from --repo flag or cwd
    let repoRoot = process.cwd();
    if (options.repo) {
      const { RepoManager } = await import('../repos/repo.manager.js');
      const repoManager = new RepoManager();
      repoRoot = repoManager.resolve(options.repo);
    }

    const dashboardDir = path.resolve(process.cwd(), DASHBOARD_DIST_DIR);
    const orchestrator = new Orchestrator({
      repoRoot,
      dashboardDir: fs.existsSync(dashboardDir) ? dashboardDir : undefined,
      notifications: config.notifications,
    });

    try {
      const taskId = await orchestrator.startTask({
        title: options.title ?? description.slice(0, 80),
        description,
        complexity: options.complexity as TaskComplexity,
        taskType: options.type as TaskType,
        issueNumber: options.issue ? parseInt(options.issue, 10) : undefined,
        source: options.source,
        repoName: options.repo,
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

// ── nanoprym serve ──────────────────────────────────────────
program
  .command('serve')
  .description('Run nanoprym as a long-lived daemon (API + health + dashboard)')
  .option('-p, --port <port>', 'Health server port (API = port+1)', '9090')
  .option('--no-dashboard', 'Skip serving dashboard static files')
  .action(async (options) => {
    const config = loadConfig();
    const dashboardDir = options.dashboard
      ? path.resolve(process.cwd(), DASHBOARD_DIST_DIR)
      : undefined;

    const orchestrator = new Orchestrator({
      repoRoot: process.cwd(),
      healthPort: parseInt(options.port, 10),
      dashboardDir: dashboardDir && fs.existsSync(dashboardDir) ? dashboardDir : undefined,
      notifications: config.notifications,
    });

    const apiPort = parseInt(options.port, 10) + 1;

    console.log(`\n${C.bold('Nanoprym Daemon')}\n`);
    console.log(`  ${C.dim('Health')}: ${C.cyan(`http://localhost:${options.port}/health`)}`);
    console.log(`  ${C.dim('API')}:    ${C.cyan(`http://localhost:${apiPort}/api/health/details`)}`);
    console.log(`  ${C.dim('Tasks')}: ${C.cyan(`curl -X POST http://localhost:${apiPort}/api/tasks -H 'Content-Type: application/json' -d '{"description":"..."}' `)}`);
    console.log(`  ${C.dim('SSE')}:    ${C.cyan(`http://localhost:${apiPort}/api/events/stream`)}`);
    console.log(`\n  ${C.green('Listening...')} ${C.dim('Press Ctrl+C to stop')}\n`);

    process.on('SIGINT', () => {
      console.log(`\n${C.yellow('Shutting down...')}`);
      orchestrator.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      orchestrator.shutdown();
      process.exit(0);
    });
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

// ── nanoprym kb ─────────────────────────────────────────────
const kbCmd = program
  .command('kb')
  .description('Knowledge base commands');

kbCmd
  .command('sync')
  .description('Check KB consistency and auto-repair (Git → Qdrant)')
  .option('--dry-run', 'Check only, do not repair')
  .action(async (options) => {
    const { KBConsistencyChecker } = await import('../knowledge/kb.checker.js');
    const checker = new KBConsistencyChecker();

    console.log(`\n${C.bold('KB Consistency Check')}\n`);

    const report = options.dryRun
      ? await checker.check()
      : await checker.sync();

    console.log(`  ${C.dim('Git entries')}:    ${report.gitEntries}`);
    console.log(`  ${C.dim('Qdrant points')}: ${report.qdrantPoints}`);
    console.log(`  ${C.dim('Healthy')}:        ${C.green(String(report.healthy))}`);

    if (report.missing.length > 0)
      console.log(`  ${C.dim('Missing')}:        ${C.yellow(String(report.missing.length))} ${C.dim('(Git → Qdrant)')}`);
    if (report.orphaned.length > 0)
      console.log(`  ${C.dim('Orphaned')}:       ${C.yellow(String(report.orphaned.length))} ${C.dim('(Qdrant only)')}`);
    if (report.stale.length > 0)
      console.log(`  ${C.dim('Stale')}:          ${C.yellow(String(report.stale.length))} ${C.dim('(hash mismatch)')}`);

    if (!options.dryRun && report.repaired > 0)
      console.log(`  ${C.dim('Repaired')}:       ${C.green(String(report.repaired))}`);

    if (report.errors.length > 0) {
      console.log(`\n  ${C.red('Errors')}:`);
      for (const err of report.errors) {
        console.log(`    ${C.dim('•')} ${err}`);
      }
    }

    const isClean = report.missing.length === 0 && report.orphaned.length === 0 && report.stale.length === 0;
    console.log(`\n  ${isClean ? C.green('✓ KB is consistent') : options.dryRun ? C.yellow('Run without --dry-run to repair') : C.green('✓ Sync complete')}\n`);
  });

kbCmd
  .command('stats')
  .description('Show KB statistics')
  .action(async () => {
    const { KBStore } = await import('../knowledge/kb.store.js');
    const store = new KBStore();
    const stats = store.stats();

    console.log(`\n${C.bold('KB Statistics')}\n`);
    console.log(`  ${C.dim('Total entries')}: ${stats.total}`);
    for (const [cat, count] of Object.entries(stats.byCategory)) {
      if (count > 0) console.log(`  ${C.dim(cat.padEnd(20))} ${count}`);
    }
    console.log('');
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

// ── nanoprym rollback ──────────────────────────────────────
const rollbackCmd = program
  .command('rollback')
  .description('Rollback an evolution version with cascade detection');

rollbackCmd
  .command('run')
  .description('Rollback a specific evolution version')
  .argument('<version>', 'Evolution version number (e.g. 42)')
  .option('-d, --decision <decision>', 'Decision: rollback_all|manual_fix|cancel', 'rollback_all')
  .action(async (versionStr: string, options) => {
    const { RollbackManager } = await import('../recovery/rollback.manager.js');
    const version = parseInt(versionStr, 10);
    if (isNaN(version)) {
      console.error(C.red(`Invalid version: ${versionStr}`));
      process.exit(1);
    }

    const manager = new RollbackManager(process.cwd());

    // Show cascade warning first
    const cascade = manager.detectCascade(version);
    if (cascade.affected.length > 0) {
      console.log(`\n${C.yellow('Cascade Warning')}\n`);
      console.log(`  Rolling back ${C.bold(`v${version}`)} affects ${C.yellow(String(cascade.affected.length))} downstream evolution(s):`);
      for (const v of cascade.affected) {
        const rec = manager.getVersion(v);
        console.log(`    ${C.dim('→')} v${v}: ${rec?.description?.slice(0, 60) ?? 'unknown'}`);
      }
      console.log('');
    }

    const decision = options.decision as 'rollback_all' | 'manual_fix' | 'cancel';
    console.log(`  ${C.dim('Decision')}: ${C.bold(decision)}\n`);

    const result = await manager.rollback(version, decision);

    if (result.success) {
      if (result.decision === 'cancel') {
        console.log(C.yellow('Rollback cancelled.'));
      } else {
        console.log(C.green(`Rollback complete.`));
        if (result.rolledBack.length > 0)
          console.log(`  ${C.dim('Rolled back')}: ${result.rolledBack.map(v => `v${v}`).join(', ')}`);
        if (result.ruleAdded)
          console.log(`  ${C.dim('Rule added')}:  ${result.ruleAdded}`);
      }
    } else {
      console.error(C.red(`Rollback failed: ${result.error}`));
      process.exit(1);
    }
  });

rollbackCmd
  .command('list')
  .description('List all registered evolutions')
  .option('-s, --status <status>', 'Filter by status: active|rolled_back')
  .action(async (options) => {
    const { RollbackManager } = await import('../recovery/rollback.manager.js');
    const manager = new RollbackManager(process.cwd());
    const evolutions = manager.listEvolutions(options.status ? { status: options.status } : undefined);

    if (evolutions.length === 0) {
      console.log(C.dim('\nNo evolutions registered.\n'));
      return;
    }

    console.log(`\n${C.bold('Evolutions')} (${evolutions.length} total)\n`);
    for (const evo of evolutions) {
      const statusColor = evo.status === 'active' ? C.green : C.red;
      console.log(`  v${String(evo.version).padEnd(4)} ${statusColor(evo.status.padEnd(12))} ${C.bold(evo.description.slice(0, 60))}`);
      console.log(`  ${' '.repeat(5)} ${C.dim(`tag: ${evo.gitTag}  commit: ${evo.commitHash.slice(0, 8)}  deps: [${evo.dependsOn.join(', ')}]`)}`);
    }
    console.log('');
  });

rollbackCmd
  .command('cascade')
  .description('Preview cascade impact without rolling back')
  .argument('<version>', 'Evolution version number')
  .action(async (versionStr: string) => {
    const { RollbackManager } = await import('../recovery/rollback.manager.js');
    const version = parseInt(versionStr, 10);
    if (isNaN(version)) {
      console.error(C.red(`Invalid version: ${versionStr}`));
      process.exit(1);
    }

    const manager = new RollbackManager(process.cwd());
    const record = manager.getVersion(version);
    if (!record) {
      console.error(C.red(`Evolution v${version} not found`));
      process.exit(1);
    }

    const cascade = manager.detectCascade(version);

    console.log(`\n${C.bold('Cascade Analysis')} for ${C.cyan(`v${version}`)}\n`);
    console.log(`  ${C.dim('Description')}: ${record.description}`);
    console.log(`  ${C.dim('Status')}:      ${record.status === 'active' ? C.green('active') : C.red('rolled_back')}`);
    console.log(`  ${C.dim('Affected')}:    ${cascade.affected.length === 0 ? C.green('none') : C.yellow(String(cascade.affected.length))}`);

    if (cascade.affected.length > 0) {
      console.log(`\n  ${C.bold('Dependency chains')}:`);
      for (const chain of cascade.chain) {
        const labels = chain.map(v => `v${v}`).join(' → ');
        console.log(`    ${labels}`);
      }
    }
    console.log('');
  });

// ── nanoprym health ─────────────────────────────────────────
program
  .command('health')
  .description('Check orchestrator health status')
  .option('-p, --port <port>', 'API server port', '9091')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const http = await import('node:http');

    const request = http.default.request(
      { hostname: '127.0.0.1', port, path: '/api/health/details', method: 'GET', timeout: 3000 },
      (response) => {
        let data = '';
        response.on('data', (chunk: Buffer) => { data += chunk; });
        response.on('end', () => {
          try {
            const health = JSON.parse(data);
            const statusColor = health.status === 'ok' ? C.green : health.status === 'degraded' ? C.yellow : C.red;
            console.log(`\n${C.bold('Orchestrator Health')}\n`);
            console.log(`  ${C.dim('Status')}:      ${statusColor(health.status)}`);
            console.log(`  ${C.dim('Version')}:     ${health.version}`);
            console.log(`  ${C.dim('Uptime')}:      ${health.uptime}s`);
            console.log(`  ${C.dim('Active Task')}: ${health.activeTask ? C.yellow('yes') : C.dim('no')}`);
            console.log(`  ${C.dim('Timestamp')}:   ${health.timestamp}`);

            // System metrics
            if (health.system) {
              console.log(`\n${C.bold('System')}\n`);
              console.log(`  ${C.dim('Memory')}:      ${health.system.memoryUsedMb}MB / ${health.system.memoryTotalMb}MB (${health.system.memoryPercent}%)`);
            }

            // Dependencies
            if (health.dependencies?.length > 0) {
              console.log(`\n${C.bold('Dependencies')}\n`);
              for (const dep of health.dependencies) {
                const stateColor = dep.state === 'up' ? C.green : dep.state === 'down' ? C.red : C.dim;
                const latency = dep.latencyMs != null ? C.dim(` (${dep.latencyMs}ms)`) : '';
                console.log(`  ${dep.name.padEnd(10)} ${stateColor(dep.state)}${latency}`);
                if (dep.error && dep.state === 'down') {
                  console.log(`  ${' '.repeat(10)} ${C.dim(dep.error.slice(0, 80))}`);
                }
              }
            }

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

// ── nanoprym dashboard ──────────────────────────────────────
program
  .command('dashboard')
  .description('Open the web dashboard')
  .option('-p, --port <port>', 'API server port', '9091')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    console.log(`\n${C.bold('Nanoprym Dashboard')}\n`);
    console.log(`  ${C.dim('URL')}:  ${C.cyan(`http://localhost:${port}`)}`);
    console.log(`  ${C.dim('API')}:  ${C.cyan(`http://localhost:${port}/api/events`)}`);
    console.log(`  ${C.dim('SSE')}:  ${C.cyan(`http://localhost:${port}/api/events/stream`)}`);
    console.log(`\n  ${C.dim('Note')}: Dashboard requires ${C.cyan('nanoprym serve')} to be running.`);
    console.log(`  ${C.dim('Dev' )}: Run ${C.cyan('cd dashboard && npm run dev')} for hot-reload mode.\n`);
  });

// ── nanoprym repo ───────────────────────────────────────────
const repoCmd = program
  .command('repo')
  .description('Manage target repos for nanoprym to work on');

repoCmd
  .command('add')
  .description('Add a repo (clone from URL or register local path)')
  .argument('<url-or-path>', 'Git URL to clone or local path to register')
  .option('-n, --name <name>', 'Custom name (defaults to repo directory name)')
  .action(async (urlOrPath: string, options) => {
    const { RepoManager } = await import('../repos/repo.manager.js');
    const repoManager = new RepoManager();

    try {
      const info = await repoManager.add(urlOrPath, { name: options.name });
      console.log(`\n${C.green('Repo added')}\n`);
      console.log(`  ${C.dim('Name')}:    ${C.bold(info.name)}`);
      console.log(`  ${C.dim('Path')}:    ${info.repoPath}`);
      if (info.repoUrl) console.log(`  ${C.dim('URL')}:     ${info.repoUrl}`);
      console.log(`  ${C.dim('Cloned')}:  ${info.cloned ? 'yes' : 'no (local)'}`);
      console.log(`\n  ${C.dim('Run tasks with')}: ${C.cyan(`nanoprym run "fix bug" --repo ${info.name}`)}\n`);
    } catch (error) {
      console.error(C.red(`Failed: ${String(error)}`));
      process.exit(1);
    }
  });

repoCmd
  .command('list')
  .description('List all registered repos')
  .action(async () => {
    const { RepoManager } = await import('../repos/repo.manager.js');
    const repoManager = new RepoManager();
    const repos = repoManager.list();

    if (repos.length === 0) {
      console.log(`\n${C.dim('No repos registered.')} Add one with: ${C.cyan('nanoprym repo add <url|path>')}\n`);
      return;
    }

    console.log(`\n${C.bold('Registered Repos')} (${repos.length})\n`);
    for (const repo of repos) {
      const exists = fs.existsSync(repo.repoPath);
      const status = exists ? C.green('ok') : C.red('missing');
      console.log(`  ${C.bold(repo.name.padEnd(20))} ${status}  ${C.dim(repo.repoPath)}`);
      if (repo.repoUrl) console.log(`  ${' '.repeat(20)}       ${C.dim(repo.repoUrl)}`);
    }
    console.log('');
  });

repoCmd
  .command('remove')
  .description('Remove a registered repo')
  .argument('<name>', 'Repo name to remove')
  .option('--delete', 'Also delete cloned files from disk')
  .action(async (name: string, options) => {
    const { RepoManager } = await import('../repos/repo.manager.js');
    const repoManager = new RepoManager();

    try {
      repoManager.remove(name, { deleteFiles: options.delete });
      console.log(C.green(`Repo "${name}" removed.`));
      if (options.delete) console.log(C.dim('Cloned files deleted.'));
    } catch (error) {
      console.error(C.red(`Failed: ${String(error)}`));
      process.exit(1);
    }
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
