/**
 * KB Vector Store — Qdrant integration for semantic search
 * Embeds KB entries using Ollama (Nomic Embed Text V2)
 * Stores vectors in Qdrant for fast semantic retrieval
 */
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('kb-vector');

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const COLLECTION_NAME = 'nanoprym-kb';
const VECTOR_SIZE = 768; // Nomic Embed Text V2 dimension
const DEDUP_THRESHOLD = 0.92;

interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export class KBVectorStore {
  private collectionReady = false;

  /** Ensure the Qdrant collection exists */
  async ensureCollection(): Promise<void> {
    try {
      const resp = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
      if (resp.ok) {
        this.collectionReady = true;
        return;
      }

      // Create collection
      await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
        }),
      });

      this.collectionReady = true;
      log.info('Qdrant collection created', { collection: COLLECTION_NAME });
    } catch (error) {
      log.warn('Qdrant not available', { error: String(error) });
      this.collectionReady = false;
    }
  }

  /** Embed text using Ollama */
  async embed(text: string): Promise<number[] | null> {
    try {
      const resp = await fetch('http://localhost:11434/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', input: text }),
      });

      if (!resp.ok) {
        log.warn('Ollama embedding failed', { status: resp.status });
        return null;
      }

      const data = await resp.json() as { embeddings: number[][] };
      return data.embeddings?.[0] ?? null;
    } catch (error) {
      log.warn('Ollama not available for embeddings', { error: String(error) });
      return null;
    }
  }

  /** Upsert a KB entry into Qdrant */
  async upsert(id: string, text: string, metadata: Record<string, unknown>): Promise<boolean> {
    if (!this.collectionReady) await this.ensureCollection();
    if (!this.collectionReady) return false;

    const vector = await this.embed(text);
    if (!vector) return false;

    try {
      await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: [{ id, vector, payload: { ...metadata, text: text.slice(0, 1000) } }],
        }),
      });

      log.debug('Vector upserted', { id });
      return true;
    } catch (error) {
      log.warn('Qdrant upsert failed', { id, error: String(error) });
      return false;
    }
  }

  /** Semantic search — find similar KB entries */
  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    if (!this.collectionReady) await this.ensureCollection();
    if (!this.collectionReady) return [];

    const vector = await this.embed(query);
    if (!vector) return [];

    try {
      const resp = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vector,
          limit,
          with_payload: true,
        }),
      });

      if (!resp.ok) return [];

      const data = await resp.json() as { result: Array<{ id: string | number; score: number; payload: Record<string, unknown> }> };
      return (data.result ?? []).map(r => ({
        id: String(r.id),
        score: r.score,
        payload: r.payload,
      }));
    } catch (error) {
      log.warn('Qdrant search failed', { error: String(error) });
      return [];
    }
  }

  /** Check if a similar entry already exists (semantic dedup) */
  async isDuplicate(text: string): Promise<{ duplicate: boolean; similarId?: string; score?: number }> {
    const results = await this.search(text, 1);
    if (results.length > 0 && results[0].score >= DEDUP_THRESHOLD) {
      return { duplicate: true, similarId: results[0].id, score: results[0].score };
    }
    return { duplicate: false };
  }

  /** Check if Qdrant is reachable */
  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${QDRANT_URL}/healthz`);
      return resp.ok;
    } catch {
      return false;
    }
  }
}
