/**
 * Generator Plugin Tests — OpenAPI, Docker, Deployment Guide
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OpenAPIGeneratorPlugin } from '../../src/plugins/generators/openapi-generator/openapi-generator.plugin.js';
import { DockerGeneratorPlugin } from '../../src/plugins/generators/docker-generator/docker-generator.plugin.js';
import { DeployGuideGeneratorPlugin } from '../../src/plugins/generators/deploy-guide-generator/deploy-guide-generator.plugin.js';

describe('OpenAPI Generator', () => {
  const outDir = path.join(os.tmpdir(), `nanoprym-openapi-test-${Date.now()}`);
  const plugin = new OpenAPIGeneratorPlugin();

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('should have correct name and type', () => {
    expect(plugin.name).toBe('openapi-generator');
    expect(plugin.type).toBe('generator');
  });

  it('should generate valid OpenAPI 3.0 spec with defaults', () => {
    const filePath = plugin.generate({}, outDir);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain('openapi.json');

    const spec = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Nanoprym API');
    expect(spec.paths['/health']).toBeDefined();
    expect(spec.paths['/api/tasks']).toBeDefined();
    expect(spec.paths['/api/tasks/{taskId}']).toBeDefined();
    expect(spec.paths['/api/tasks/{taskId}/merge']).toBeDefined();
    expect(spec.paths['/api/tasks/{taskId}/reject']).toBeDefined();
    expect(spec.paths['/api/events']).toBeDefined();
    expect(spec.paths['/api/events/stream']).toBeDefined();
    expect(spec.components.schemas.TaskInput).toBeDefined();
    expect(spec.components.schemas.Error).toBeDefined();
  });

  it('should accept custom title and server URL', () => {
    const filePath = plugin.generate({
      title: 'My Custom API',
      serverUrl: 'https://api.example.com',
      version: '2.0.0',
    }, outDir);

    const spec = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(spec.info.title).toBe('My Custom API');
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.servers[0].url).toBe('https://api.example.com');
  });

  it('should include POST /api/tasks with required description', () => {
    const filePath = plugin.generate({}, outDir);
    const spec = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const postTasks = spec.paths['/api/tasks'].post;
    expect(postTasks.operationId).toBe('submitTask');
    expect(postTasks.requestBody.required).toBe(true);

    const taskInput = spec.components.schemas.TaskInput;
    expect(taskInput.required).toContain('description');
  });

  it('should create output directory if it does not exist', () => {
    const nested = path.join(outDir, 'nested', 'deep');
    plugin.generate({}, nested);
    expect(fs.existsSync(path.join(nested, 'openapi.json'))).toBe(true);
  });
});

describe('Docker Generator', () => {
  const outDir = path.join(os.tmpdir(), `nanoprym-docker-test-${Date.now()}`);
  const plugin = new DockerGeneratorPlugin();

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('should have correct name and type', () => {
    expect(plugin.name).toBe('docker-generator');
    expect(plugin.type).toBe('generator');
  });

  it('should generate Dockerfile and docker-compose.yml', () => {
    const result = plugin.generate({ projectName: 'test-app' }, outDir);

    expect(fs.existsSync(result.dockerfile)).toBe(true);
    expect(fs.existsSync(result.composePath)).toBe(true);
  });

  it('should include python in Dockerfile when pythonRequired is true', () => {
    const result = plugin.generate({ projectName: 'test-app', pythonRequired: true }, outDir);
    const content = fs.readFileSync(result.dockerfile, 'utf-8');

    expect(content).toContain('python3');
    expect(content).toContain('python3-pip');
  });

  it('should not include python when pythonRequired is false', () => {
    const result = plugin.generate({ projectName: 'test-app', pythonRequired: false }, outDir);
    const content = fs.readFileSync(result.dockerfile, 'utf-8');

    expect(content).not.toContain('python3-pip');
  });

  it('should use custom node version', () => {
    const result = plugin.generate({ projectName: 'test-app', nodeVersion: '18' }, outDir);
    const content = fs.readFileSync(result.dockerfile, 'utf-8');

    expect(content).toContain('node:18-slim');
  });

  it('should generate compose with additional services', () => {
    const result = plugin.generate({
      projectName: 'myapp',
      services: [
        {
          name: 'redis',
          image: 'redis:7-alpine',
          ports: ['6379:6379'],
          memLimit: '128M',
        },
      ],
    }, outDir);

    const compose = fs.readFileSync(result.composePath, 'utf-8');
    expect(compose).toContain('redis');
    expect(compose).toContain('redis:7-alpine');
    expect(compose).toContain('6379:6379');
    expect(compose).toContain('128M');
  });

  it('should collect named volumes from services', () => {
    const result = plugin.generate({
      projectName: 'myapp',
      services: [
        {
          name: 'db',
          image: 'postgres:16',
          volumes: ['pg_data:/var/lib/postgresql/data'],
        },
      ],
    }, outDir);

    const compose = fs.readFileSync(result.composePath, 'utf-8');
    expect(compose).toContain('volumes:');
    expect(compose).toContain('pg_data:');
  });

  it('should create output directory if it does not exist', () => {
    const nested = path.join(outDir, 'deep', 'nested');
    plugin.generate({ projectName: 'test' }, nested);
    expect(fs.existsSync(path.join(nested, 'Dockerfile'))).toBe(true);
  });
});

describe('Deploy Guide Generator', () => {
  const outDir = path.join(os.tmpdir(), `nanoprym-deploy-test-${Date.now()}`);
  const plugin = new DeployGuideGeneratorPlugin();

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('should have correct name and type', () => {
    expect(plugin.name).toBe('deploy-guide-generator');
    expect(plugin.type).toBe('generator');
  });

  it('should generate DEPLOYMENT.md with project name', () => {
    const filePath = plugin.generate({ projectName: 'Nanoprym' }, outDir);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# Nanoprym — Deployment Guide');
    expect(content).toContain('Auto-generated by Nanoprym Deploy Guide Generator');
  });

  it('should render prerequisites table', () => {
    const filePath = plugin.generate({
      projectName: 'TestApp',
      prerequisites: [
        { name: 'Node.js', version: '20+', installCmd: 'brew install node' },
        { name: 'Docker', version: '24+' },
      ],
    }, outDir);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Prerequisites');
    expect(content).toContain('Node.js');
    expect(content).toContain('`brew install node`');
    expect(content).toContain('Docker');
    expect(content).toContain('24+');
  });

  it('should render environment variables table', () => {
    const filePath = plugin.generate({
      projectName: 'TestApp',
      envVars: [
        { name: 'API_KEY', description: 'API authentication key', required: true, example: 'sk-abc123' },
        { name: 'DEBUG', description: 'Enable debug mode', required: false },
      ],
    }, outDir);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Environment Variables');
    expect(content).toContain('`API_KEY`');
    expect(content).toContain('Yes');
    expect(content).toContain('`sk-abc123`');
    expect(content).toContain('`DEBUG`');
    expect(content).toContain('No');
  });

  it('should render setup and run steps', () => {
    const filePath = plugin.generate({
      projectName: 'TestApp',
      setupSteps: [
        { title: 'Install dependencies', commands: ['npm ci'] },
        { title: 'Build', commands: ['npm run build'], description: 'Compile TypeScript' },
      ],
      runSteps: [
        { title: 'Start server', commands: ['npm start'] },
      ],
    }, outDir);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Setup');
    expect(content).toContain('### 1. Install dependencies');
    expect(content).toContain('npm ci');
    expect(content).toContain('### 2. Build');
    expect(content).toContain('Compile TypeScript');
    expect(content).toContain('## Running');
    expect(content).toContain('npm start');
  });

  it('should render ports table', () => {
    const filePath = plugin.generate({
      projectName: 'TestApp',
      ports: [
        { port: 9090, description: 'Health check' },
        { port: 9091, description: 'API server' },
      ],
    }, outDir);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Ports');
    expect(content).toContain('9090');
    expect(content).toContain('9091');
  });

  it('should render health check section', () => {
    const filePath = plugin.generate({
      projectName: 'TestApp',
      healthCheck: { url: 'http://localhost:9090/health', expectedStatus: 200 },
    }, outDir);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Health Check');
    expect(content).toContain('http://localhost:9090/health');
    expect(content).toContain('200');
  });

  it('should render troubleshooting section', () => {
    const filePath = plugin.generate({
      projectName: 'TestApp',
      troubleshooting: [
        { problem: 'Port already in use', solution: 'Kill the process on that port or change the config.' },
      ],
    }, outDir);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Troubleshooting');
    expect(content).toContain('**Port already in use**');
    expect(content).toContain('Kill the process on that port');
  });

  it('should create output directory if it does not exist', () => {
    const nested = path.join(outDir, 'sub', 'dir');
    plugin.generate({ projectName: 'Test' }, nested);
    expect(fs.existsSync(path.join(nested, 'DEPLOYMENT.md'))).toBe(true);
  });
});
