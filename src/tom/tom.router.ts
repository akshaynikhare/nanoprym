/**
 * TOM Router — Routes LLM requests to the cheapest available model
 *
 * Routing rules (from decisions-log.md):
 * - First-time code gen + complex ops → Claude directly (no TOM)
 * - Iterations/retries → TOM compression → Claude (save tokens)
 * - Auxiliary tasks → TOM routing → cheapest model
 *
 * Provider tiers:
 * Tier 1 (Free): Gemini Free, OpenRouter Free
 * Tier 2 (Cheap): DeepSeek ($0.14/M), Gemini Flash-Lite ($0.075/M)
 * Tier 3 (Premium): Claude Haiku ($0.25/M)
 *
 * Fallback: Local Ollama (Qwen2.5-3B)
 */
import { TomClient } from './tom.client.js';
import { CostTracker } from '../metrics/cost.tracker.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('tom-router');

export type TaskCategory = 'first_gen' | 'complex' | 'iteration' | 'auxiliary';

interface RoutingResult {
  provider: string;
  model: string;
  compressed: boolean;
  compressionRatio?: number;
  prompt: string;
}

interface ProviderEndpoint {
  name: string;
  tier: number;
  model: string;
  apiUrl: string;
  apiKeyEnv?: string;
  costPerMInput: number;
  costPerMOutput: number;
}

const PROVIDERS: ProviderEndpoint[] = [
  {
    name: 'gemini-free',
    tier: 1,
    model: 'gemini-2.5-flash',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    apiKeyEnv: 'GOOGLE_API_KEY',
    costPerMInput: 0,
    costPerMOutput: 0,
  },
  {
    name: 'deepseek',
    tier: 2,
    model: 'deepseek-chat',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    costPerMInput: 0.14,
    costPerMOutput: 0.28,
  },
  {
    name: 'ollama-local',
    tier: 3,
    model: 'qwen2.5-coder:3b',
    apiUrl: 'http://localhost:11434/api/generate',
    costPerMInput: 0,
    costPerMOutput: 0,
  },
];

export class TomRouter {
  private tomClient: TomClient;
  private costTracker: CostTracker;

  constructor(tomClient?: TomClient, costTracker?: CostTracker) {
    this.tomClient = tomClient ?? new TomClient();
    this.costTracker = costTracker ?? new CostTracker();
  }

  /** Route a prompt to the appropriate model based on task category */
  async route(prompt: string, category: TaskCategory): Promise<RoutingResult> {
    // First-time code gen and complex tasks → Claude directly
    if (category === 'first_gen' || category === 'complex') {
      return {
        provider: 'claude-max',
        model: 'sonnet',
        compressed: false,
        prompt,
      };
    }

    // Iterations → compress, then Claude
    if (category === 'iteration') {
      const compressed = await this.compress(prompt);
      return {
        provider: 'claude-max',
        model: 'sonnet',
        compressed: compressed.compressed,
        compressionRatio: compressed.ratio,
        prompt: compressed.text,
      };
    }

    // Auxiliary → compress + route to cheapest available
    const compressed = await this.compress(prompt);
    const provider = await this.findCheapestProvider();

    return {
      provider: provider.name,
      model: provider.model,
      compressed: compressed.compressed,
      compressionRatio: compressed.ratio,
      prompt: compressed.text,
    };
  }

  /** Call a routed provider and return the response */
  async execute(routing: RoutingResult): Promise<string> {
    // Claude Max → handled by Claude provider (not here)
    if (routing.provider === 'claude-max') {
      return routing.prompt; // Caller should use ClaudeProvider
    }

    const provider = PROVIDERS.find(p => p.name === routing.provider);
    if (!provider) {
      log.warn('Unknown provider, falling back to local', { provider: routing.provider });
      return this.callOllama(routing.prompt);
    }

    try {
      if (provider.name === 'ollama-local') {
        return this.callOllama(routing.prompt);
      }
      if (provider.name === 'gemini-free') {
        return this.callGemini(routing.prompt, provider);
      }
      if (provider.name === 'deepseek') {
        return this.callOpenAICompatible(routing.prompt, provider);
      }
      return this.callOllama(routing.prompt); // Ultimate fallback
    } catch (error) {
      log.warn('Provider call failed, falling back to local', {
        provider: provider.name,
        error: String(error),
      });
      return this.callOllama(routing.prompt);
    }
  }

  /** Compress a prompt via TOM sidecar */
  private async compress(prompt: string): Promise<{ text: string; compressed: boolean; ratio: number }> {
    try {
      const result = await this.tomClient.compress(prompt);
      return { text: result.text, compressed: true, ratio: result.ratio };
    } catch {
      // TOM sidecar not running — return uncompressed
      return { text: prompt, compressed: false, ratio: 0 };
    }
  }

  /** Find the cheapest available provider within budget */
  private async findCheapestProvider(): Promise<ProviderEndpoint> {
    if (!this.costTracker.isWithinBudget()) {
      log.info('Budget exceeded, routing to local Ollama');
      return PROVIDERS.find(p => p.name === 'ollama-local')!;
    }

    // Try providers in tier order
    for (const provider of PROVIDERS) {
      if (provider.name === 'ollama-local') continue; // Ollama is last resort

      const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
      if (provider.apiKeyEnv && !apiKey) continue; // No API key configured

      if (await this.checkAvailability(provider)) {
        return provider;
      }
    }

    return PROVIDERS.find(p => p.name === 'ollama-local')!;
  }

  /** Check if a provider is reachable */
  private async checkAvailability(provider: ProviderEndpoint): Promise<boolean> {
    if (provider.name === 'ollama-local') {
      try {
        const resp = await fetch('http://localhost:11434/api/tags');
        return resp.ok;
      } catch { return false; }
    }
    return true; // Assume cloud providers are available
  }

  /** Call local Ollama */
  private async callOllama(prompt: string): Promise<string> {
    try {
      const resp = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'qwen2.5-coder:3b', prompt, stream: false }),
      });
      const data = await resp.json() as { response: string };
      return data.response;
    } catch (error) {
      log.error('Ollama call failed', { error: String(error) });
      return `[ERROR: Ollama not available] ${prompt.slice(0, 100)}`;
    }
  }

  /** Call Gemini Free API */
  private async callGemini(prompt: string, provider: ProviderEndpoint): Promise<string> {
    const apiKey = process.env[provider.apiKeyEnv!];
    const resp = await fetch(`${provider.apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });
    const data = await resp.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    this.costTracker.record({
      provider: provider.name,
      model: provider.model,
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      costUsd: 0,
    });

    return text;
  }

  /** Call OpenAI-compatible API (DeepSeek, etc.) */
  private async callOpenAICompatible(prompt: string, provider: ProviderEndpoint): Promise<string> {
    const apiKey = process.env[provider.apiKeyEnv!];
    const resp = await fetch(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await resp.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens: number; completion_tokens: number } };
    const text = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage;

    const inputTokens = usage?.prompt_tokens ?? Math.ceil(prompt.length / 4);
    const outputTokens = usage?.completion_tokens ?? Math.ceil(text.length / 4);
    const costUsd = (inputTokens * provider.costPerMInput + outputTokens * provider.costPerMOutput) / 1_000_000;

    this.costTracker.record({
      provider: provider.name,
      model: provider.model,
      inputTokens,
      outputTokens,
      costUsd,
    });

    return text;
  }
}
