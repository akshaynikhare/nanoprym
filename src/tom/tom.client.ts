/**
 * TOM Client — Node.js client for the Python TOM sidecar
 * Communicates via Unix socket
 */
import net from 'node:net';
import { TOM_SOCKET_PATH } from '../_shared/constants.js';
import { createChildLogger } from '../_shared/logger.js';

const log = createChildLogger('tom-client');

interface CompressResult {
  ok: boolean;
  text: string;
  original_chars: number;
  compressed_chars: number;
  ratio: number;
  layers: string[];
  cache_hit: boolean;
}

export class TomClient {
  private socketPath: string;

  constructor(socketPath: string = TOM_SOCKET_PATH) {
    this.socketPath = socketPath;
  }

  async compress(text: string, layers?: string[]): Promise<CompressResult> {
    return this.send({ action: 'compress', text, layers });
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.send({ action: 'ping' });
      return result.ok === true;
    } catch {
      return false;
    }
  }

  private send(request: Record<string, unknown>): Promise<CompressResult> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ path: this.socketPath }, () => {
        client.write(JSON.stringify(request) + '\n');
      });

      let data = '';
      client.on('data', (chunk) => {
        data += chunk.toString();
        // Server sends newline-delimited JSON — resolve on first complete line
        const newlineIdx = data.indexOf('\n');
        if (newlineIdx !== -1) {
          try {
            resolve(JSON.parse(data.slice(0, newlineIdx)));
          } catch (err) {
            reject(new Error(`TOM parse error: ${err}`));
          }
          client.destroy();
        }
      });
      client.on('error', (err) => {
        log.warn('TOM sidecar unavailable', { error: err.message });
        reject(err);
      });

      client.setTimeout(5000, () => {
        client.destroy();
        reject(new Error('TOM timeout'));
      });
    });
  }
}
