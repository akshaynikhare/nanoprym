import { describe, it, expect, afterEach } from 'vitest';
import { HealthServer } from '../../src/http/health.server.js';
import http from 'node:http';

function fetchJson(port: number, path: string, method = 'GET'): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: JSON.parse(data) });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

describe('HealthServer', () => {
  let server: HealthServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('should respond 200 on GET /health', async () => {
    server = new HealthServer({ port: 0 });
    const address = server.getServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;

    // Wait for server to be listening
    await new Promise<void>((resolve) => {
      if (server!.getServer().listening) { resolve(); return; }
      server!.getServer().on('listening', resolve);
    });

    const { status, body } = await fetchJson(port, '/health');

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    expect(body.timestamp).toBeDefined();
    expect(body.activeTask).toBe(false);
    expect(body.activeTaskCount).toBe(0);
  });

  it('should report activeTask and activeTaskCount from the check function', async () => {
    server = new HealthServer({ port: 0, activeTaskCheck: () => true });
    const address = server.getServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;

    await new Promise<void>((resolve) => {
      if (server!.getServer().listening) { resolve(); return; }
      server!.getServer().on('listening', resolve);
    });

    const { body } = await fetchJson(port, '/health');
    expect(body.activeTask).toBe(true);
    expect(body.activeTaskCount).toBe(1);
  });

  it('should return 404 for unknown paths', async () => {
    server = new HealthServer({ port: 0 });
    const address = server.getServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;

    await new Promise<void>((resolve) => {
      if (server!.getServer().listening) { resolve(); return; }
      server!.getServer().on('listening', resolve);
    });

    const { status, body } = await fetchJson(port, '/unknown');
    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('should return 405 for non-GET methods', async () => {
    server = new HealthServer({ port: 0 });
    const address = server.getServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;

    await new Promise<void>((resolve) => {
      if (server!.getServer().listening) { resolve(); return; }
      server!.getServer().on('listening', resolve);
    });

    const { status, body } = await fetchJson(port, '/health', 'POST');
    expect(status).toBe(405);
    expect(body.error).toBe('Method not allowed');
  });

  it('should build correct health status via getHealthStatus()', () => {
    server = new HealthServer({ port: 0 });
    const health = server.getHealthStatus();

    expect(health.status).toBe('ok');
    expect(health.version).toBeDefined();
    expect(health.uptime).toBeGreaterThanOrEqual(0);
    expect(health.activeTask).toBe(false);
    expect(health.activeTaskCount).toBe(0);
  });
});
