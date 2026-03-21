/**
 * Nanoprym API Server — REST + SSE endpoints for the dashboard
 * Extends the health server with event querying and real-time streaming.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { NANOPRYM_VERSION, HEALTH_CHECK_PORT, GIT_BRANCH_PREFIX } from '../_shared/constants.js';
import { createChildLogger } from '../_shared/logger.js';
import type { Message, MessageTopic, TaskComplexity, TaskType } from '../_shared/types.js';
import type { EventBus } from '../core/event-bus.js';
import { EventLedger } from '../core/event-ledger.js';
import { mergeTask, rejectTask } from '../core/task-actions.js';
import { GitManager } from '../git/git.manager.js';
import type { HealthMonitor } from '../monitoring/health.monitor.js';
import type { Orchestrator, TaskInput } from '../core/orchestrator.js';
import { getRegisteredScanners, getRegisteredGenerators, getRegisteredTesters } from '../plugins/plugin.loader.js';
import { RollbackManager } from '../recovery/rollback.manager.js';
import type { RollbackDecision } from '../recovery/rollback.manager.js';

const log = createChildLogger('api-server');

export interface ApiServerOptions {
  port?: number;
  activeTaskCheck?: () => boolean;
  dashboardDir?: string;
  ledgerBaseDir?: string;
  gitManager?: GitManager;
}

export class ApiServer {
  private server: http.Server;
  private startedAt: number;
  private activeTaskCheck: () => boolean;
  private dashboardDir: string | null;
  private sseClients: Set<http.ServerResponse> = new Set();
  private healthMonitor: HealthMonitor | null = null;
  private orchestrator: Orchestrator | null = null;
  private eventBus: EventBus | null = null;
  private eventLedger: EventLedger | null = null;
  private busHandler: ((msg: Message) => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ledgerBaseDir: string | null;
  private gitManager: GitManager | null;

  constructor(options?: ApiServerOptions) {
    const port = options?.port ?? HEALTH_CHECK_PORT;
    this.startedAt = Date.now();
    this.activeTaskCheck = options?.activeTaskCheck ?? (() => false);
    this.dashboardDir = options?.dashboardDir ?? null;
    this.ledgerBaseDir = options?.ledgerBaseDir ?? null;
    this.gitManager = options?.gitManager ?? null;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(port, () => {
      log.info('API server started', { port });
    });

    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        log.warn('API port already in use, skipping', { port });
        return;
      }
      log.error('API server error', { error: String(error) });
    });
  }

  /** Attach an event bus for SSE streaming */
  attachEventBus(bus: EventBus, ledger: EventLedger): void {
    // Detach previous if any
    this.detachEventBus();

    this.eventBus = bus;
    this.eventLedger = ledger;

    this.busHandler = (msg: Message) => {
      const data = JSON.stringify(this.serializeMessage(msg));
      for (const client of this.sseClients) {
        client.write(`id: ${msg.id}\ndata: ${data}\n\n`);
      }
    };

    bus.subscribe(this.busHandler);

    // SSE heartbeat every 30s to keep connections alive
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.sseClients) {
        client.write(`:heartbeat\n\n`);
      }
    }, 30_000);

    log.info('Event bus attached for SSE');
  }

  /** Detach event bus */
  detachEventBus(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.eventBus && this.busHandler) {
      this.eventBus.unsubscribe(this.busHandler);
    }
    this.eventBus = null;
    this.eventLedger = null;
    this.busHandler = null;
  }

  /** Attach a health monitor for dependency-aware status */
  attachMonitor(monitor: HealthMonitor): void {
    this.healthMonitor = monitor;
  }

  /** Attach orchestrator for task submission via API */
  attachOrchestrator(orchestrator: Orchestrator): void {
    this.orchestrator = orchestrator;
  }

  /** Get health status */
  getHealthStatus() {
    const overallStatus = this.healthMonitor
      ? this.healthMonitor.getDetailedStatus().status
      : 'ok';

    const hasActiveTask = this.activeTaskCheck();
    return {
      status: overallStatus === 'down' ? 'degraded' : overallStatus,
      version: NANOPRYM_VERSION,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      activeTask: hasActiveTask,
      activeTaskCount: hasActiveTask ? 1 : 0,
    };
  }

  /** Get the underlying http.Server */
  getServer(): http.Server {
    return this.server;
  }

  /** Stop the server */
  stop(): Promise<void> {
    // Close all SSE connections
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();
    this.detachEventBus();

    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) { reject(error); return; }
        log.info('API server stopped');
        resolve();
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // CORS headers for dashboard dev server
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // POST routes
    if (req.method === 'POST') {
      if (pathname === '/api/tasks') {
        this.handleSubmitTask(req, res);
        return;
      }
      if (pathname === '/api/kb/sync') {
        this.handleKBSync(req, res);
        return;
      }
      if (pathname === '/api/tom/compress') {
        this.handleTOMCompress(req, res);
        return;
      }
      if (pathname === '/api/repos') {
        this.handleAddRepo(req, res);
        return;
      }
      const taskActionMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/(merge|reject)$/);
      if (taskActionMatch) {
        const [, taskId, action] = taskActionMatch;
        if (action === 'merge') this.handleMerge(taskId, res);
        else this.handleReject(taskId, res);
        return;
      }
      const evoRollbackMatch = pathname.match(/^\/api\/evolutions\/(\d+)\/rollback$/);
      if (evoRollbackMatch) {
        this.handleEvolutionRollback(parseInt(evoRollbackMatch[1], 10), req, res);
        return;
      }
      this.json(res, 405, { error: 'Method not allowed' });
      return;
    }

    // DELETE routes
    if (req.method === 'DELETE') {
      const repoMatch = pathname.match(/^\/api\/repos\/([a-zA-Z0-9_-]+)$/);
      if (repoMatch) {
        this.handleRemoveRepo(repoMatch[1], res);
        return;
      }
      this.json(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (req.method !== 'GET') {
      this.json(res, 405, { error: 'Method not allowed' });
      return;
    }

    // GET routes
    if (pathname === '/health' || pathname === '/health/') {
      this.json(res, 200, this.getHealthStatus());
    } else if (pathname === '/api/health/details') {
      this.handleHealthDetails(res);
    } else if (pathname === '/api/health/history') {
      this.handleHealthHistory(url, res);
    } else if (pathname === '/api/events') {
      this.handleQueryEvents(url, res);
    } else if (pathname === '/api/events/stream') {
      this.handleSSE(req, res);
    } else if (pathname === '/api/status') {
      this.handleStatus(res);
    } else if (pathname === '/api/tasks') {
      this.handleListTasks(res);
    } else if (pathname === '/api/kb/stats') {
      this.handleKBStats(res);
    } else if (pathname === '/api/tom/status') {
      this.handleTOMStatus(res);
    } else if (pathname === '/api/scanners') {
      this.handleScanners(res);
    } else if (pathname === '/api/testers') {
      this.handleTesters(res);
    } else if (pathname === '/api/generators') {
      this.handleGenerators(res);
    } else if (pathname === '/api/repos') {
      this.handleListRepos(res);
    } else if (pathname === '/api/evolutions') {
      this.handleEvolutionsList(res);
    } else {
      const evoCascadeMatch = pathname.match(/^\/api\/evolutions\/(\d+)\/cascade$/);
      if (evoCascadeMatch) {
        this.handleEvolutionCascade(parseInt(evoCascadeMatch[1], 10), res);
        return;
      }
      const taskMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)(\/diff)?$/);
      if (taskMatch) {
        const [, taskId, isDiff] = taskMatch;
        if (isDiff) this.handleTaskDiff(taskId, res);
        else this.handleTaskDetail(taskId, res);
      } else if (pathname === '/' || pathname.startsWith('/dashboard')
        || pathname === '/repos' || pathname === '/tools') {
        this.serveDashboard(pathname, res);
      } else {
        this.json(res, 404, { error: 'Not found' });
      }
    }
  }

  /** POST /api/tasks — Submit a new task to the running orchestrator */
  private handleSubmitTask(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.orchestrator) {
      this.json(res, 503, { error: 'Orchestrator not attached' });
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const task: TaskInput = {
          title: parsed.title ?? (parsed.description ?? '').slice(0, 80),
          description: parsed.description,
          complexity: (parsed.complexity ?? 'STANDARD') as TaskComplexity,
          taskType: (parsed.taskType ?? 'TASK') as TaskType,
          issueNumber: parsed.issueNumber,
          source: parsed.source ?? 'api',
          repoName: parsed.repoName,
        };

        if (!task.description) {
          this.json(res, 400, { error: 'description is required' });
          return;
        }

        const taskId = await this.orchestrator!.startTask(task);
        this.json(res, 201, { taskId, status: 'started' });
      } catch (err) {
        this.json(res, 400, { error: String(err) });
      }
    });
  }

  /** GET /api/events?topic=X&sender=Y&limit=50 */
  private handleQueryEvents(url: URL, res: http.ServerResponse): void {
    if (!this.eventLedger) {
      this.json(res, 200, { events: [], message: 'No active task' });
      return;
    }

    const topic = url.searchParams.get('topic') as MessageTopic | null;
    const sender = url.searchParams.get('sender');
    const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
    const since = url.searchParams.get('since');

    try {
      const messages = this.eventLedger.query({
        topic: topic ?? undefined,
        sender: sender ?? undefined,
        limit,
        since: since ?? undefined,
        order: 'ASC',
      });

      this.json(res, 200, {
        events: messages.map(m => this.serializeMessage(m)),
        total: messages.length,
      });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** GET /api/events/stream — Server-Sent Events */
  private handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    // Replay missed events if client provides Last-Event-ID
    const lastEventId = req.headers['last-event-id'] as string | undefined;
    if (lastEventId && this.eventLedger) {
      const allEvents = this.eventLedger.query({ order: 'ASC' });
      let replay = false;
      for (const msg of allEvents) {
        if (msg.id === lastEventId) { replay = true; continue; }
        if (replay) {
          const data = JSON.stringify(this.serializeMessage(msg));
          res.write(`id: ${msg.id}\ndata: ${data}\n\n`);
        }
      }
    }

    this.sseClients.add(res);
    log.info('SSE client connected', { total: this.sseClients.size });

    req.on('close', () => {
      this.sseClients.delete(res);
      log.info('SSE client disconnected', { total: this.sseClients.size });
    });
  }

  /** GET /api/health/history?limit=100 — Historical health snapshots */
  private handleHealthHistory(url: URL, res: http.ServerResponse): void {
    if (!this.healthMonitor) {
      this.json(res, 200, { snapshots: [] });
      return;
    }
    const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
    const snapshots = this.healthMonitor.getHistory(limit);
    this.json(res, 200, { snapshots, total: snapshots.length });
  }

  /** GET /api/health/details — Full dependency and system health */
  private handleHealthDetails(res: http.ServerResponse): void {
    if (!this.healthMonitor) {
      this.json(res, 200, { ...this.getHealthStatus(), dependencies: [], system: null });
      return;
    }
    this.json(res, 200, this.healthMonitor.getDetailedStatus());
  }

  /** GET /api/status — Task & system overview */
  private handleStatus(res: http.ServerResponse): void {
    const health = this.getHealthStatus();
    const eventCount = this.eventLedger?.count({}) ?? 0;

    this.json(res, 200, {
      ...health,
      sseClients: this.sseClients.size,
      eventCount,
    });
  }

  /** Serve dashboard static files */
  private serveDashboard(pathname: string, res: http.ServerResponse): void {
    if (!this.dashboardDir) {
      // Serve embedded fallback
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Nanoprym Dashboard</h1><p>Dashboard not built. Run <code>cd dashboard && npm run build</code></p></body></html>');
      return;
    }

    let filePath = pathname === '/' || pathname === '/dashboard'
      ? path.join(this.dashboardDir, 'index.html')
      : path.join(this.dashboardDir, pathname.replace('/dashboard', ''));

    // Security: prevent directory traversal
    if (!filePath.startsWith(this.dashboardDir)) {
      this.json(res, 403, { error: 'Forbidden' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      // SPA fallback
      filePath = path.join(this.dashboardDir, 'index.html');
    }

    const ext = path.extname(filePath);
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };

    res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  }

  /** GET /api/tasks — List all tasks from ledger files */
  private async handleListTasks(res: http.ServerResponse): Promise<void> {
    if (!this.ledgerBaseDir) {
      this.json(res, 200, { tasks: [] });
      return;
    }

    try {
      const files = fs.existsSync(this.ledgerBaseDir)
        ? fs.readdirSync(this.ledgerBaseDir).filter(f => f.endsWith('.db'))
        : [];
      const tasks = [];

      for (const file of files) {
        const taskId = file.replace('.db', '');
        const ledgerPath = path.join(this.ledgerBaseDir, file);

        try {
          const ledger = await EventLedger.create(ledgerPath);
          const status = this.determineTaskStatus(ledger);
          const issueMsg = ledger.query({ topic: 'ISSUE_OPENED' as MessageTopic, limit: 1 })[0];
          const eventCount = ledger.count({});

          // Extract test summary from SCAN_RESULT / VALIDATION_RESULT events
          const testEvents = [
            ...ledger.query({ topic: 'SCAN_RESULT' as MessageTopic }),
            ...ledger.query({ topic: 'VALIDATION_RESULT' as MessageTopic }),
          ];
          let testsPassed = 0;
          let testsFailed = 0;
          for (const te of testEvents) {
            testsPassed += (te.content.data?.passed as number) ?? 0;
            testsFailed += (te.content.data?.failed as number) ?? 0;
          }

          tasks.push({
            taskId,
            title: issueMsg?.content.data?.title ?? taskId,
            description: (issueMsg?.content.text ?? '').slice(0, 200),
            complexity: issueMsg?.content.data?.complexity ?? 'STANDARD',
            taskType: issueMsg?.content.data?.taskType ?? 'TASK',
            status,
            createdAt: issueMsg?.timestamp.toISOString() ?? new Date().toISOString(),
            eventCount,
            branch: `${GIT_BRANCH_PREFIX}${taskId}`,
            testsPassed,
            testsFailed,
            repoName: issueMsg?.content.data?.repoName as string | undefined,
          });

          ledger.close();
        } catch (err) {
          log.warn('Failed to read ledger', { taskId, error: String(err) });
        }
      }

      this.json(res, 200, { tasks });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** GET /api/tasks/:taskId — Task detail with all events */
  private async handleTaskDetail(taskId: string, res: http.ServerResponse): Promise<void> {
    if (!this.ledgerBaseDir) {
      this.json(res, 404, { error: 'No ledger directory' });
      return;
    }

    const ledgerPath = path.join(this.ledgerBaseDir, `${taskId}.db`);
    if (!fs.existsSync(ledgerPath)) {
      this.json(res, 404, { error: 'Task not found' });
      return;
    }

    try {
      const ledger = await EventLedger.create(ledgerPath);
      const messages = ledger.query({ order: 'ASC' });
      const status = this.determineTaskStatus(ledger);
      const issueMsg = messages.find(m => m.topic === 'ISSUE_OPENED');

      ledger.close();

      this.json(res, 200, {
        taskId,
        title: issueMsg?.content.data?.title ?? taskId,
        description: issueMsg?.content.text ?? '',
        complexity: issueMsg?.content.data?.complexity ?? 'STANDARD',
        taskType: issueMsg?.content.data?.taskType ?? 'TASK',
        status,
        branch: `${GIT_BRANCH_PREFIX}${taskId}`,
        events: messages.map(m => this.serializeMessage(m)),
        eventCount: messages.length,
      });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** GET /api/tasks/:taskId/diff — Git diff for the task branch */
  private async handleTaskDiff(taskId: string, res: http.ServerResponse): Promise<void> {
    if (!this.gitManager) {
      this.json(res, 503, { error: 'Git manager not available' });
      return;
    }

    const branch = `${GIT_BRANCH_PREFIX}${taskId}`;
    const worktreePath = path.join(this.gitManager.getRepoRoot(), '..', '.nanoprym-worktrees', taskId);

    try {
      if (!fs.existsSync(worktreePath)) {
        this.json(res, 200, { taskId, branch, diff: '', files: [] });
        return;
      }

      const diff = await this.gitManager.getDiff(worktreePath);
      const files = await this.gitManager.getChangedFiles(worktreePath);
      this.json(res, 200, { taskId, branch, diff, files });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** POST /api/tasks/:taskId/merge — Merge branch to main, cleanup */
  private async handleMerge(taskId: string, res: http.ServerResponse): Promise<void> {
    if (!this.gitManager || !this.ledgerBaseDir) {
      this.json(res, 503, { error: 'Git manager not available' });
      return;
    }

    try {
      await mergeTask(taskId, { gitManager: this.gitManager, ledgerBaseDir: this.ledgerBaseDir });
      log.info('Task merged via dashboard', { taskId });
      this.json(res, 200, { taskId, status: 'merged', message: `Branch ${GIT_BRANCH_PREFIX}${taskId} merged to main` });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** POST /api/tasks/:taskId/reject — Delete branch + worktree */
  private async handleReject(taskId: string, res: http.ServerResponse): Promise<void> {
    if (!this.gitManager || !this.ledgerBaseDir) {
      this.json(res, 503, { error: 'Git manager not available' });
      return;
    }

    try {
      await rejectTask(taskId, { gitManager: this.gitManager, ledgerBaseDir: this.ledgerBaseDir });
      log.info('Task rejected via dashboard', { taskId });
      this.json(res, 200, { taskId, status: 'rejected', message: `Task ${taskId} rejected, branch deleted` });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** Determine task status from ledger events */
  private determineTaskStatus(ledger: EventLedger): string {
    const completeMsgs = ledger.query({ topic: 'CLUSTER_COMPLETE' as MessageTopic, order: 'DESC' });

    for (const msg of completeMsgs) {
      const s = msg.content.data?.status;
      if (s === 'merged' || s === 'rejected') return s;
      if (s === 'awaiting_review') return 'awaiting_review';
    }

    const issueMsg = ledger.query({ topic: 'ISSUE_OPENED' as MessageTopic, limit: 1 });
    if (issueMsg.length > 0) return 'in_progress';

    return 'unknown';
  }

  private serializeMessage(msg: Message) {
    return {
      id: msg.id,
      taskId: msg.taskId,
      topic: msg.topic,
      sender: msg.sender,
      text: msg.content.text,
      data: msg.content.data,
      metadata: msg.metadata,
      timestamp: msg.timestamp.toISOString(),
    };
  }

  /** GET /api/kb/stats — KB entry counts by category */
  private async handleKBStats(res: http.ServerResponse): Promise<void> {
    try {
      const { KBStore } = await import('../knowledge/kb.store.js');
      const store = new KBStore();
      const stats = store.stats();
      this.json(res, 200, stats);
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** POST /api/kb/sync — Run KB consistency check + repair */
  private async handleKBSync(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk; });
      req.on('end', async () => {
        const parsed = body ? JSON.parse(body) : {};
        const dryRun = parsed.dryRun === true;

        const { KBConsistencyChecker } = await import('../knowledge/kb.checker.js');
        const checker = new KBConsistencyChecker();
        const report = dryRun ? await checker.check() : await checker.sync();
        this.json(res, 200, report);
      });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** GET /api/tom/status — TOM sidecar status */
  private async handleTOMStatus(res: http.ServerResponse): Promise<void> {
    try {
      const { TomClient } = await import('../tom/tom.client.js');
      const client = new TomClient();
      const alive = await client.ping();
      this.json(res, 200, { running: alive });
    } catch {
      this.json(res, 200, { running: false });
    }
  }

  /** POST /api/tom/compress — Test compression */
  private async handleTOMCompress(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        if (!parsed.text) {
          this.json(res, 400, { error: 'text is required' });
          return;
        }
        const { TomClient } = await import('../tom/tom.client.js');
        const client = new TomClient();
        const result = await client.compress(parsed.text, parsed.layers);
        this.json(res, 200, result);
      } catch (err) {
        this.json(res, 500, { error: String(err) });
      }
    });
  }

  /** GET /api/scanners — List registered scanners and their availability */
  private handleGenerators(res: http.ServerResponse): void {
    const generators = getRegisteredGenerators().map(g => ({ name: g.name, type: g.type }));
    this.json(res, 200, { generators, total: generators.length });
  }

  private async handleTesters(res: http.ServerResponse): Promise<void> {
    try {
      const testers = getRegisteredTesters();
      const results = await Promise.all(
        testers.map(async (t) => ({
          name: t.name,
          available: await t.isAvailable().catch(() => false),
        })),
      );
      const available = results.filter(r => r.available).length;
      this.json(res, 200, { testers: results, total: results.length, available });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  private async handleScanners(res: http.ServerResponse): Promise<void> {
    try {
      const scanners = getRegisteredScanners();
      const results = await Promise.all(
        scanners.map(async (s) => ({
          name: s.name,
          available: await s.isAvailable().catch(() => false),
        })),
      );
      const available = results.filter(r => r.available).length;
      this.json(res, 200, { scanners: results, total: results.length, available });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** GET /api/evolutions — List all registered evolutions */
  /** GET /api/repos — List registered repos */
  private async handleListRepos(res: http.ServerResponse): Promise<void> {
    try {
      const { RepoManager } = await import('../repos/repo.manager.js');
      const repoManager = new RepoManager();
      const repos = repoManager.list();
      this.json(res, 200, { repos, total: repos.length });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** POST /api/repos — Add a repo (clone URL or register local path) */
  private handleAddRepo(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        if (!parsed.url && !parsed.path) {
          this.json(res, 400, { error: 'url or path is required' });
          return;
        }
        const { RepoManager } = await import('../repos/repo.manager.js');
        const repoManager = new RepoManager();
        const info = await repoManager.add(parsed.url ?? parsed.path, { name: parsed.name });
        this.json(res, 201, info);
      } catch (err) {
        this.json(res, 400, { error: String(err) });
      }
    });
  }

  /** DELETE /api/repos/:name — Remove a registered repo */
  private async handleRemoveRepo(name: string, res: http.ServerResponse): Promise<void> {
    try {
      const { RepoManager } = await import('../repos/repo.manager.js');
      const repoManager = new RepoManager();
      repoManager.remove(name);
      this.json(res, 200, { ok: true, message: `Repo "${name}" removed` });
    } catch (err) {
      this.json(res, 400, { error: String(err) });
    }
  }

  private handleEvolutionsList(res: http.ServerResponse): void {
    try {
      const manager = new RollbackManager(process.cwd());
      const evolutions = manager.listEvolutions();
      const active = evolutions.filter(e => e.status === 'active').length;
      const rolledBack = evolutions.filter(e => e.status === 'rolled_back').length;
      this.json(res, 200, { evolutions, total: evolutions.length, active, rolledBack });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** GET /api/evolutions/:version/cascade — Preview cascade impact */
  private handleEvolutionCascade(version: number, res: http.ServerResponse): void {
    try {
      const manager = new RollbackManager(process.cwd());
      const record = manager.getVersion(version);
      if (!record) {
        this.json(res, 404, { error: `Evolution v${version} not found` });
        return;
      }
      const cascade = manager.detectCascade(version);
      this.json(res, 200, { version, record, cascade });
    } catch (err) {
      this.json(res, 500, { error: String(err) });
    }
  }

  /** POST /api/evolutions/:version/rollback — Execute rollback */
  private handleEvolutionRollback(version: number, req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', async () => {
      try {
        let decision: RollbackDecision = 'rollback_all';
        if (body) {
          const parsed = JSON.parse(body);
          if (parsed.decision) decision = parsed.decision;
        }
        const manager = new RollbackManager(process.cwd(), this.eventBus ?? undefined);
        const result = await manager.rollback(version, decision);
        this.json(res, result.success ? 200 : 400, result);
      } catch (err) {
        this.json(res, 500, { error: String(err) });
      }
    });
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}
