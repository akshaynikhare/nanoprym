/**
 * Prompt Loader — Loads versioned system prompts from prompts/ directory
 *
 * Prompts are stored as: prompts/{role}/v{NNN}.system.md
 * The latest version is loaded by default.
 * Brain hierarchy (L0/L1/L2) prepended to prompt context.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRole } from './agent.types.js';
import { createChildLogger } from '../../_shared/logger.js';

const log = createChildLogger('prompt-loader');

const PROMPTS_DIR = path.resolve(process.cwd(), 'prompts');

export interface LoadedPrompt {
  role: AgentRole;
  version: string;
  system: string;
  subsequent?: string;
  filePath: string;
}

/** Load the latest prompt version for a given role */
export function loadPrompt(role: AgentRole): LoadedPrompt {
  const roleDir = path.join(PROMPTS_DIR, role);

  if (!fs.existsSync(roleDir)) {
    throw new Error(`Prompt directory not found: ${roleDir}`);
  }

  const files = fs.readdirSync(roleDir)
    .filter(f => f.endsWith('.system.md'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error(`No prompt files found in ${roleDir}`);
  }

  const latestFile = files[0];
  const version = latestFile.replace('.system.md', '');
  const filePath = path.join(roleDir, latestFile);
  const system = fs.readFileSync(filePath, 'utf-8');

  // Check for subsequent prompt (used for retry iterations)
  const subsequentFile = latestFile.replace('.system.md', '.subsequent.md');
  const subsequentPath = path.join(roleDir, subsequentFile);
  const subsequent = fs.existsSync(subsequentPath)
    ? fs.readFileSync(subsequentPath, 'utf-8')
    : undefined;

  log.info('Prompt loaded', { role, version, file: latestFile });

  return { role, version, system, subsequent, filePath };
}

/** Load a specific prompt version */
export function loadPromptVersion(role: AgentRole, version: string): LoadedPrompt {
  const filePath = path.join(PROMPTS_DIR, role, `${version}.system.md`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt not found: ${filePath}`);
  }

  const system = fs.readFileSync(filePath, 'utf-8');

  return { role, version, system, filePath };
}

/** List all available prompt versions for a role */
export function listPromptVersions(role: AgentRole): string[] {
  const roleDir = path.join(PROMPTS_DIR, role);

  if (!fs.existsSync(roleDir)) return [];

  return fs.readdirSync(roleDir)
    .filter(f => f.endsWith('.system.md'))
    .map(f => f.replace('.system.md', ''))
    .sort();
}
