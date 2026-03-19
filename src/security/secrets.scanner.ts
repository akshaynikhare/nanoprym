/**
 * Secrets Scanner — Detects accidentally committed secrets
 * Runs before any git commit to prevent credential leaks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('secrets-scanner');

interface SecretMatch {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

/** Patterns that indicate secrets (regex + description) */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'AWS Secret Key', pattern: /(?:aws_secret_access_key|secret_key)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/gi },
  { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}/gi },
  { name: 'Generic Secret', pattern: /(?:secret|password|passwd|token)\s*[:=]\s*['"]?[A-Za-z0-9_!@#$%^&*-]{8,}/gi },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'Anthropic Key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenAI Key', pattern: /sk-[A-Za-z0-9]{48,}/g },
  { name: 'Slack Token', pattern: /xox[boaprs]-[A-Za-z0-9-]{10,}/g },
];

/** Files to always skip */
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2',
  '.ttf', '.eot', '.mp3', '.mp4', '.zip', '.tar', '.gz', '.db',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', '.nanoprym/ledgers',
]);

/** Scan files for secrets */
export function scanForSecrets(rootDir: string, files?: string[]): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const filesToScan = files ?? collectFiles(rootDir);

  for (const filePath of filesToScan) {
    const ext = path.extname(filePath).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { name, pattern } of SECRET_PATTERNS) {
          // Reset regex state
          pattern.lastIndex = 0;
          if (pattern.test(line)) {
            matches.push({
              file: path.relative(rootDir, filePath),
              line: i + 1,
              pattern: name,
              snippet: line.slice(0, 100).replace(/[A-Za-z0-9_-]{20,}/g, '***REDACTED***'),
            });
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  if (matches.length > 0) {
    log.warn('Secrets detected', { count: matches.length, files: [...new Set(matches.map(m => m.file))] });
  }

  return matches;
}

/** Collect all files recursively, skipping ignored dirs */
function collectFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/** Safe exec wrapper — sanitizes commands before execution */
export function isSafeCommand(command: string): { safe: boolean; reason?: string } {
  const dangerous = [
    { pattern: /rm\s+-rf\s+\//, reason: 'Recursive delete from root' },
    { pattern: />\s*\/dev\/sd/, reason: 'Write to block device' },
    { pattern: /mkfs/, reason: 'Filesystem format' },
    { pattern: /dd\s+if=/, reason: 'Direct disk write' },
    { pattern: /:(){ :|:& };:/, reason: 'Fork bomb' },
    { pattern: /curl.*\|\s*(?:bash|sh)/, reason: 'Pipe to shell' },
    { pattern: /wget.*\|\s*(?:bash|sh)/, reason: 'Pipe to shell' },
    { pattern: /git\s+push\s+.*--force/, reason: 'Force push' },
    { pattern: /git\s+reset\s+--hard/, reason: 'Hard reset' },
    { pattern: /chmod\s+777/, reason: 'World-writable permissions' },
  ];

  for (const { pattern, reason } of dangerous) {
    if (pattern.test(command)) {
      return { safe: false, reason };
    }
  }

  return { safe: true };
}
