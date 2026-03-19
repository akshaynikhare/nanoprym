/**
 * Nanoprym Utility Functions
 */
import { randomUUID, createHash } from 'node:crypto';

export function generateId(): string {
  return randomUUID();
}

export function estimateTokens(text: string): number {
  // Conservative: 1 token ≈ 4 chars
  return Math.ceil(text.length / 4);
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function kebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function hashString(str: string): string {
  return createHash('sha256').update(str).digest('hex');
}
