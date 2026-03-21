/**
 * Docker Generator Plugin — Generates Dockerfile + docker-compose.yml for a project
 */
import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../../../_shared/logger.js';

const log = createChildLogger('plugin:docker');

export interface DockerService {
  name: string;
  image?: string;
  build?: { context: string; target?: string };
  ports?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  command?: string;
  dependsOn?: string[];
  memLimit?: string;
  restart?: string;
}

export interface DockerInput {
  projectName: string;
  nodeVersion?: string;
  pythonRequired?: boolean;
  services?: DockerService[];
  volumes?: string[];
}

export class DockerGeneratorPlugin {
  readonly name = 'docker-generator';
  readonly type = 'generator' as const;

  generate(input: DockerInput, outputDir: string): { dockerfile: string; composePath: string } {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const dockerfile = this.generateDockerfile(input);
    const compose = this.generateCompose(input);

    const dockerfilePath = path.join(outputDir, 'Dockerfile');
    const composePath = path.join(outputDir, 'docker-compose.yml');

    fs.writeFileSync(dockerfilePath, dockerfile);
    fs.writeFileSync(composePath, compose);

    log.info('Docker files generated', { project: input.projectName, dir: outputDir });
    return { dockerfile: dockerfilePath, composePath };
  }

  private generateDockerfile(input: DockerInput): string {
    const nodeVersion = input.nodeVersion ?? '20';
    const lines: string[] = [
      `# ${input.projectName}`,
      `FROM node:${nodeVersion}-slim AS base`,
      '',
    ];

    if (input.pythonRequired) {
      lines.push(
        'RUN apt-get update && apt-get install -y --no-install-recommends \\',
        '    python3 python3-pip git ca-certificates \\',
        '    && rm -rf /var/lib/apt/lists/*',
        '',
      );
    } else {
      lines.push(
        'RUN apt-get update && apt-get install -y --no-install-recommends \\',
        '    git ca-certificates \\',
        '    && rm -rf /var/lib/apt/lists/*',
        '',
      );
    }

    lines.push(
      'WORKDIR /app',
      '',
      '# Install dependencies',
      'COPY package*.json ./',
      'RUN npm ci --omit=dev',
      '',
      '# Copy source',
      'COPY dist/ dist/',
      '',
      'ENV NODE_ENV=production',
      '',
      'CMD ["node", "dist/index.js"]',
      '',
    );

    return lines.join('\n');
  }

  private generateCompose(input: DockerInput): string {
    const lines: string[] = [
      'version: "3.8"',
      '',
      'services:',
    ];

    // App service
    lines.push(
      `  ${input.projectName}:`,
      '    build:',
      '      context: .',
      '    container_name: ' + input.projectName,
      '    restart: unless-stopped',
    );

    // Additional services
    if (input.services) {
      for (const svc of input.services) {
        lines.push('', `  ${svc.name}:`);
        if (svc.image) lines.push(`    image: ${svc.image}`);
        if (svc.build) {
          lines.push(`    build:`, `      context: ${svc.build.context}`);
          if (svc.build.target) lines.push(`      target: ${svc.build.target}`);
        }
        lines.push(`    container_name: ${input.projectName}-${svc.name}`);
        if (svc.ports?.length) {
          lines.push('    ports:');
          for (const p of svc.ports) lines.push(`      - "${p}"`);
        }
        if (svc.volumes?.length) {
          lines.push('    volumes:');
          for (const v of svc.volumes) lines.push(`      - ${v}`);
        }
        if (svc.environment && Object.keys(svc.environment).length) {
          lines.push('    environment:');
          for (const [k, v] of Object.entries(svc.environment)) {
            lines.push(`      - ${k}=${v}`);
          }
        }
        if (svc.command) lines.push(`    command: ${svc.command}`);
        if (svc.dependsOn?.length) {
          lines.push('    depends_on:');
          for (const d of svc.dependsOn) lines.push(`      - ${d}`);
        }
        if (svc.memLimit) {
          lines.push('    deploy:', '      resources:', '        limits:', `          memory: ${svc.memLimit}`);
        }
        lines.push(`    restart: ${svc.restart ?? 'unless-stopped'}`);
      }
    }

    // Named volumes
    const volumeNames = input.volumes ?? [];
    if (input.services) {
      for (const svc of input.services) {
        for (const v of svc.volumes ?? []) {
          const namedMatch = v.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
          if (namedMatch && !volumeNames.includes(namedMatch[1])) {
            volumeNames.push(namedMatch[1]);
          }
        }
      }
    }

    if (volumeNames.length) {
      lines.push('', 'volumes:');
      for (const v of volumeNames) lines.push(`  ${v}:`);
    }

    lines.push('');
    return lines.join('\n');
  }
}
