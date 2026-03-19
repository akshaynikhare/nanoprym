/**
 * Health Check Server — Lightweight HTTP endpoint for liveness/readiness probes
 * Uses Node's built-in http module (no framework dependency).
 */
import http from 'node:http';
import { NANOPRYM_VERSION, HEALTH_CHECK_PORT } from '../_shared/constants.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('health');

export interface HealthStatus {
  status: 'ok' | 'degraded';
  version: string;
  uptime: number;
  timestamp: string;
  activeTask: boolean;
}

export type ActiveTaskCheck = () => boolean;

export class HealthServer {
  private server: http.Server;
  private startedAt: number;
  private activeTaskCheck: ActiveTaskCheck;

  constructor(options?: { port?: number; activeTaskCheck?: ActiveTaskCheck }) {
    const port = options?.port ?? HEALTH_CHECK_PORT;
    this.startedAt = Date.now();
    this.activeTaskCheck = options?.activeTaskCheck ?? (() => false);

    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response);
    });

    this.server.listen(port, () => {
      log.info('Health check server started', { port });
    });

    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        log.warn('Health check port already in use, skipping', { port });
        return;
      }
      log.error('Health check server error', { error: String(error) });
    });
  }

  /** Build current health status */
  getHealthStatus(): HealthStatus {
    return {
      status: 'ok',
      version: NANOPRYM_VERSION,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      activeTask: this.activeTaskCheck(),
    };
  }

  /** Stop the server */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        log.info('Health check server stopped');
        resolve();
      });
    });
  }

  /** Returns the underlying http.Server (useful for testing) */
  getServer(): http.Server {
    return this.server;
  }

  private handleRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
    if (request.method !== 'GET') {
      response.writeHead(405, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    if (request.url === '/health' || request.url === '/health/') {
      const health = this.getHealthStatus();
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(health));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
  }
}
