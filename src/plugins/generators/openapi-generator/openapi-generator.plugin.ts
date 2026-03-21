/**
 * OpenAPI Generator Plugin — Generates OpenAPI 3.0 spec from Nanoprym API endpoints
 */
import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../../../_shared/logger.js';
import { NANOPRYM_VERSION, HEALTH_CHECK_PORT } from '../../../_shared/constants.js';

const log = createChildLogger('plugin:openapi');

export interface OpenAPIInput {
  title?: string;
  description?: string;
  version?: string;
  serverUrl?: string;
}

export class OpenAPIGeneratorPlugin {
  readonly name = 'openapi-generator';
  readonly type = 'generator' as const;

  generate(input: OpenAPIInput, outputDir: string): string {
    const spec = {
      openapi: '3.0.3',
      info: {
        title: input.title ?? 'Nanoprym API',
        description: input.description ?? 'Self-evolving AI agent orchestration system — REST + SSE API',
        version: input.version ?? NANOPRYM_VERSION,
      },
      servers: [
        { url: input.serverUrl ?? `http://localhost:${HEALTH_CHECK_PORT}`, description: 'Local' },
      ],
      paths: {
        '/health': {
          get: {
            summary: 'Health check',
            operationId: 'getHealth',
            tags: ['Health'],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthStatus' } } } },
            },
          },
        },
        '/api/health/details': {
          get: {
            summary: 'Detailed health with dependency status',
            operationId: 'getHealthDetails',
            tags: ['Health'],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/DetailedHealthStatus' } } } },
            },
          },
        },
        '/api/health/history': {
          get: {
            summary: 'Historical health snapshots',
            operationId: 'getHealthHistory',
            tags: ['Health'],
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 }, description: 'Max snapshots to return' },
            ],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { snapshots: { type: 'array', items: { $ref: '#/components/schemas/DetailedHealthStatus' } }, total: { type: 'integer' } } } } } },
            },
          },
        },
        '/api/status': {
          get: {
            summary: 'System status overview',
            operationId: 'getStatus',
            tags: ['System'],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/SystemStatus' } } } },
            },
          },
        },
        '/api/events': {
          get: {
            summary: 'Query events from the ledger',
            operationId: 'queryEvents',
            tags: ['Events'],
            parameters: [
              { name: 'topic', in: 'query', schema: { type: 'string' }, description: 'Filter by message topic' },
              { name: 'sender', in: 'query', schema: { type: 'string' }, description: 'Filter by sender' },
              { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 }, description: 'Max events to return' },
              { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Events after this timestamp' },
            ],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { events: { type: 'array', items: { $ref: '#/components/schemas/Event' } }, total: { type: 'integer' } } } } } },
            },
          },
        },
        '/api/events/stream': {
          get: {
            summary: 'SSE event stream',
            operationId: 'streamEvents',
            tags: ['Events'],
            responses: {
              '200': { description: 'Server-Sent Events stream', content: { 'text/event-stream': { schema: { type: 'string' } } } },
            },
          },
        },
        '/api/tasks': {
          get: {
            summary: 'List all tasks',
            operationId: 'listTasks',
            tags: ['Tasks'],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { tasks: { type: 'array', items: { $ref: '#/components/schemas/TaskSummary' } } } } } } },
            },
          },
          post: {
            summary: 'Submit a new task',
            operationId: 'submitTask',
            tags: ['Tasks'],
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskInput' } } },
            },
            responses: {
              '201': { description: 'Task started', content: { 'application/json': { schema: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string' } } } } } },
              '400': { description: 'Invalid input', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            },
          },
        },
        '/api/tasks/{taskId}': {
          get: {
            summary: 'Get task detail with events',
            operationId: 'getTask',
            tags: ['Tasks'],
            parameters: [
              { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskDetail' } } } },
              '404': { description: 'Task not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            },
          },
        },
        '/api/tasks/{taskId}/diff': {
          get: {
            summary: 'Get git diff for task branch',
            operationId: 'getTaskDiff',
            tags: ['Tasks'],
            parameters: [
              { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskDiff' } } } },
            },
          },
        },
        '/api/tasks/{taskId}/merge': {
          post: {
            summary: 'Merge task branch to main',
            operationId: 'mergeTask',
            tags: ['Tasks'],
            parameters: [
              { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': { description: 'Merged', content: { 'application/json': { schema: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string' }, message: { type: 'string' } } } } } },
              '500': { description: 'Merge failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            },
          },
        },
        '/api/tasks/{taskId}/reject': {
          post: {
            summary: 'Reject task and delete branch',
            operationId: 'rejectTask',
            tags: ['Tasks'],
            parameters: [
              { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': { description: 'Rejected', content: { 'application/json': { schema: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string' }, message: { type: 'string' } } } } } },
              '500': { description: 'Rejection failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            },
          },
        },
      },
      components: {
        schemas: {
          HealthStatus: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              version: { type: 'string' },
              uptime: { type: 'integer', description: 'Uptime in seconds' },
              timestamp: { type: 'string', format: 'date-time' },
              activeTask: { type: 'boolean' },
            },
          },
          DetailedHealthStatus: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
              version: { type: 'string' },
              uptime: { type: 'integer' },
              timestamp: { type: 'string', format: 'date-time' },
              activeTask: { type: 'boolean' },
              system: {
                type: 'object',
                properties: {
                  memoryUsedMb: { type: 'number' },
                  memoryTotalMb: { type: 'number' },
                  memoryPercent: { type: 'number' },
                },
              },
              dependencies: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', enum: ['qdrant', 'redis', 'ollama', 'tom'] },
                    state: { type: 'string', enum: ['up', 'down', 'unknown'] },
                    latencyMs: { type: 'number' },
                    lastChecked: { type: 'string', format: 'date-time' },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
          SystemStatus: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              version: { type: 'string' },
              uptime: { type: 'integer' },
              timestamp: { type: 'string', format: 'date-time' },
              activeTask: { type: 'boolean' },
              sseClients: { type: 'integer' },
              eventCount: { type: 'integer' },
            },
          },
          Event: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              taskId: { type: 'string' },
              topic: { type: 'string' },
              sender: { type: 'string' },
              text: { type: 'string' },
              data: { type: 'object' },
              metadata: { type: 'object' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
          TaskInput: {
            type: 'object',
            required: ['description'],
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              complexity: { type: 'string', enum: ['TRIVIAL', 'SIMPLE', 'STANDARD', 'CRITICAL'], default: 'STANDARD' },
              taskType: { type: 'string', enum: ['TASK', 'DEBUG', 'INQUIRY'], default: 'TASK' },
              issueNumber: { type: 'integer' },
              source: { type: 'string', default: 'api' },
            },
          },
          TaskSummary: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              complexity: { type: 'string' },
              taskType: { type: 'string' },
              status: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              eventCount: { type: 'integer' },
              branch: { type: 'string' },
            },
          },
          TaskDetail: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              complexity: { type: 'string' },
              taskType: { type: 'string' },
              status: { type: 'string' },
              branch: { type: 'string' },
              events: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
              eventCount: { type: 'integer' },
            },
          },
          TaskDiff: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              branch: { type: 'string' },
              diff: { type: 'string' },
              files: { type: 'array', items: { type: 'string' } },
            },
          },
          Error: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    };

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, 'openapi.json');
    fs.writeFileSync(filePath, JSON.stringify(spec, null, 2));
    log.info('OpenAPI spec generated', { file: filePath });
    return filePath;
  }
}
