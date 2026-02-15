/**
 * OllamaClient - Ollama API client with NDJSON streaming support.
 * IMP-006
 */

import {
  OllamaNotRunningError,
  OllamaConnectionError,
  OllamaVersionError,
  ModelLoadTimeoutError,
  GenerationTimeoutError,
  ModelNotFoundError,
} from '../errors.js';

export {
  OllamaNotRunningError,
  OllamaConnectionError,
  OllamaVersionError,
  ModelLoadTimeoutError,
  GenerationTimeoutError,
  ModelNotFoundError,
};

// ── Types ──────────────────────────────────────────────────────

export interface OllamaClientConfig {
  baseUrl: string;
  requestTimeout: number;
  heartbeatTimeout: number;
  firstTokenTimeout: number;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: true;
  options?: {
    num_ctx?: number;
    temperature?: number;
    top_p?: number;
    num_predict?: number;
  };
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalDurationMs: number;
  loadDurationMs: number;
  model: string;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

interface OllamaChatStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
  };
  done: false;
}

interface OllamaChatStreamFinal {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
  };
  done: true;
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}

type OllamaStreamChunk = OllamaChatStreamChunk | OllamaChatStreamFinal;

// ── Constants ──────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a specialized code/text processing worker.
RETURN ONLY the requested result.
NO conversational filler (e.g., 'Sure', 'Here is the code').
NO explanations unless explicitly asked.
Use raw text or raw code blocks without extra commentary.` as const;

const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const MINIMUM_OLLAMA_VERSION = '0.1.34';
const PULL_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes
const PULL_PROGRESS_STALL_MS = 5 * 60 * 1_000; // 5 minutes without progress

// ── Helpers ────────────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

// ── OllamaClient ──────────────────────────────────────────────

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly config: OllamaClientConfig;

  constructor(config: OllamaClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.config = config;
  }

  /**
   * Send a streaming chat request to /api/chat.
   * NDJSON streaming with heartbeat / first-token / request timeout.
   */
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const abortController = new AbortController();
    let timeoutReason: Error | undefined;

    // ── Timeout timers ──

    // [4] Request-level timeout
    const requestTimer = setTimeout(() => {
      timeoutReason = new GenerationTimeoutError(
        `Request timed out after ${this.config.requestTimeout}ms`,
        this.config.requestTimeout,
      );
      abortController.abort(timeoutReason);
    }, this.config.requestTimeout);

    // [2] First-token timeout
    let firstTokenReceived = false;
    const firstTokenTimer = setTimeout(() => {
      if (!firstTokenReceived) {
        timeoutReason = new ModelLoadTimeoutError(
          `First token not received within ${this.config.firstTokenTimeout}ms`,
          this.config.firstTokenTimeout,
        );
        abortController.abort(timeoutReason);
      }
    }, this.config.firstTokenTimeout);

    // [3] Heartbeat timeout (started after first token)
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

    const resetHeartbeat = (): void => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        timeoutReason = new GenerationTimeoutError(
          `No data received for ${this.config.heartbeatTimeout}ms (heartbeat timeout)`,
          this.config.heartbeatTimeout,
        );
        abortController.abort(timeoutReason);
      }, this.config.heartbeatTimeout);
    };

    const cleanup = (): void => {
      clearTimeout(requestTimer);
      clearTimeout(firstTokenTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
    };

    try {
      // ── Fetch ──
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: abortController.signal,
        });
      } catch (err: unknown) {
        if (timeoutReason) throw timeoutReason;
        if (err instanceof Error && err.name === 'AbortError') {
          throw timeoutReason ?? err;
        }
        throw new OllamaNotRunningError(
          `Cannot connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new OllamaConnectionError(
          `Ollama returned HTTP ${response.status}: ${body}`,
        );
      }

      // ── NDJSON streaming parse ──
      if (!response.body) {
        throw new OllamaConnectionError('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let finalChunk: OllamaChatStreamFinal | null = null;

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Reset heartbeat on every chunk arrival
          if (firstTokenReceived) {
            resetHeartbeat();
          }

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;

            let chunk: OllamaStreamChunk;
            try {
              chunk = JSON.parse(line) as OllamaStreamChunk;
            } catch {
              throw new OllamaConnectionError(
                `Failed to parse NDJSON line: ${line.substring(0, 200)}`,
              );
            }

            if (chunk.done) {
              finalChunk = chunk;
            } else {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                clearTimeout(firstTokenTimer);
                resetHeartbeat();
              }
              fullText += chunk.message.content;
            }
          }
        }
      } catch (err: unknown) {
        if (timeoutReason) throw timeoutReason;
        if (err instanceof Error && err.name === 'AbortError') {
          throw timeoutReason ?? err;
        }
        throw err;
      }

      // Handle remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer) as OllamaStreamChunk;
          if (chunk.done) {
            finalChunk = chunk;
          } else {
            fullText += chunk.message.content;
          }
        } catch {
          throw new OllamaConnectionError(
            `Failed to parse final NDJSON buffer: ${buffer.substring(0, 200)}`,
          );
        }
      }

      if (!finalChunk) {
        throw new OllamaConnectionError('Stream ended without final chunk');
      }

      return {
        text: fullText,
        inputTokens: finalChunk.prompt_eval_count,
        outputTokens: finalChunk.eval_count,
        totalDurationMs: finalChunk.total_duration / 1_000_000,
        loadDurationMs: finalChunk.load_duration / 1_000_000,
        model: finalChunk.model,
      };
    } finally {
      cleanup();
    }
  }

  /**
   * Health check: GET / with 5s timeout.
   * Returns true if Ollama responds with "Ollama is running".
   */
  async healthCheck(): Promise<boolean> {
    const abortController = new AbortController();
    const timer = setTimeout(() => {
      abortController.abort();
    }, HEALTH_CHECK_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/`, {
        signal: abortController.signal,
      });
      const text = await response.text();
      return text.includes('Ollama is running');
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Get Ollama version and validate >= 0.1.34.
   */
  async getVersion(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/version`);
    } catch (err: unknown) {
      throw new OllamaNotRunningError(
        `Cannot connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new OllamaNotRunningError(
        `Ollama version endpoint returned HTTP ${response.status}`,
      );
    }

    const data = (await response.json()) as { version: string };
    const version = data.version;

    if (compareVersions(version, MINIMUM_OLLAMA_VERSION) < 0) {
      throw new OllamaVersionError(
        `Ollama version ${version} is below minimum required ${MINIMUM_OLLAMA_VERSION}`,
      );
    }

    return version;
  }

  /**
   * List locally installed models via GET /api/tags.
   */
  async listModels(): Promise<OllamaModelInfo[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/tags`);
    } catch (err: unknown) {
      throw new OllamaNotRunningError(
        `Cannot connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new OllamaNotRunningError(
        `Ollama tags endpoint returned HTTP ${response.status}`,
      );
    }

    const data = (await response.json()) as { models: OllamaModelInfo[] };
    return data.models ?? [];
  }

  /**
   * Pull (download) a model via POST /api/pull with streaming progress.
   * Logs progress to stderr.
   */
  async pullModel(name: string): Promise<void> {
    const abortController = new AbortController();
    let lastProgressTime = Date.now();

    const pullTimer = setTimeout(() => {
      abortController.abort();
    }, PULL_TIMEOUT_MS);

    // Stall detection: abort if no progress for 5 minutes
    const stallChecker = setInterval(() => {
      if (Date.now() - lastProgressTime > PULL_PROGRESS_STALL_MS) {
        clearInterval(stallChecker);
        abortController.abort();
      }
    }, 10_000);

    try {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, stream: true }),
          signal: abortController.signal,
        });
      } catch (err: unknown) {
        throw new OllamaNotRunningError(
          `Cannot connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status === 404 || body.includes('not found')) {
          throw new ModelNotFoundError(`Model "${name}" not found: ${body}`);
        }
        throw new OllamaConnectionError(
          `Ollama pull returned HTTP ${response.status}: ${body}`,
        );
      }

      if (!response.body) {
        throw new OllamaConnectionError('Pull response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastPct = -1;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lastProgressTime = Date.now();
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          let chunk: { status: string; completed?: number; total?: number; error?: string };
          try {
            chunk = JSON.parse(line) as { status: string; completed?: number; total?: number; error?: string };
          } catch {
            continue; // skip malformed lines during pull
          }

          if (chunk.error) {
            throw new ModelNotFoundError(`Pull error for "${name}": ${chunk.error}`);
          }

          if (chunk.status === 'success') {
            process.stderr.write(`[INFO] Model "${name}" pulled successfully.\n`);
            return;
          }

          // Log progress
          if (chunk.total && chunk.completed !== undefined) {
            const pct = Math.floor((chunk.completed / chunk.total) * 100);
            if (pct !== lastPct && pct % 10 === 0) {
              lastPct = pct;
              process.stderr.write(`[INFO] Pulling model "${name}"... ${pct}%\n`);
            }
          } else if (chunk.status) {
            process.stderr.write(`[INFO] Pulling model "${name}": ${chunk.status}\n`);
          }
        }
      }

      // If stream ends without "success"
      throw new OllamaConnectionError(
        `Pull stream ended without success status for model "${name}"`,
      );
    } finally {
      clearTimeout(pullTimer);
      clearInterval(stallChecker);
    }
  }
}
