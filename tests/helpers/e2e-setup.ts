/**
 * E2E Test Shared Setup
 *
 * Provides real (non-mocked) Ollama client, tool contexts, and helpers
 * for end-to-end tests against a running Ollama server.
 */

import { OllamaClient } from '../../src/ollama/client.js';
import { FIFOQueue } from '../../src/queue/fifo-queue.js';
import { CostCalculator } from '../../src/cost/calculator.js';
import { DEFAULT_PRICING } from '../../src/cost/pricing.js';
import { ExecutionTracker } from '../../src/model-selector/execution-tracker.js';
import { detectTier } from '../../src/tiering/detector.js';
import { appConfigSchema } from '../../src/config/schema.js';
import type { AppConfig } from '../../src/config/schema.js';
import type { TierConfig } from '../../src/tiering/config.js';
import type { OllamaChatResponse } from '../../src/ollama/client.js';
import type { OllamaTaskPayload } from '../../src/tools/offload-work.js';
import type { ToolHandlerContext } from '../../src/tools/offload-work.js';
import type { Logger } from 'pino';

// ── Constants ──────────────────────────────────────────────────

export const TEST_MODEL = 'qwen2.5-coder:1.5b';
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

// ── Ollama Availability Check ──────────────────────────────────

/**
 * Check if Ollama is reachable with a 3-second timeout.
 * Used with `describe.runIf(await isOllamaAvailable())`.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/`, {
      signal: controller.signal,
    });
    const text = await response.text();
    return text.includes('Ollama is running');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── Factory Functions ──────────────────────────────────────────

/**
 * Create a real OllamaClient (no mocks).
 */
export function createE2EClient(overrides?: {
  requestTimeout?: number;
  heartbeatTimeout?: number;
  firstTokenTimeout?: number;
}): OllamaClient {
  const tierConfig = detectTier(64);
  return new OllamaClient({
    baseUrl: OLLAMA_BASE_URL,
    requestTimeout: overrides?.requestTimeout ?? tierConfig.timeout.requestTimeout,
    heartbeatTimeout: overrides?.heartbeatTimeout ?? tierConfig.timeout.heartbeatTimeout,
    firstTokenTimeout: overrides?.firstTokenTimeout ?? tierConfig.timeout.firstTokenTimeout,
  });
}

/**
 * Create a real AppConfig with defaults.
 */
export function createE2EConfig(): AppConfig {
  return appConfigSchema.parse({});
}

/**
 * Create a silent pino-compatible logger for tests.
 */
function createSilentLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    trace: () => {},
    child: () => createSilentLogger(),
    level: 'silent',
  } as unknown as Logger;
}

/**
 * Create a full ToolHandlerContext with real dependencies (no mocks).
 * Includes FIFOQueue, CostCalculator, ExecutionTracker, and TierConfig for 64GB RAM.
 */
export function createE2EToolContext(client?: OllamaClient): ToolHandlerContext {
  const ollamaClient = client ?? createE2EClient();
  const tierConfig: TierConfig = detectTier(64);
  const config = createE2EConfig();
  const costCalculator = new CostCalculator(DEFAULT_PRICING, 'claude-sonnet-4-5');
  const executionTracker = new ExecutionTracker();

  const queue = new FIFOQueue<OllamaTaskPayload, OllamaChatResponse>(
    {
      maxQueueLength: config.queue.maxQueueLength,
      maxRequestSizeBytes: config.queue.maxRequestSizeBytes,
      queueTimeoutMs: config.queue.queueTimeoutMs,
    },
    async (payload) => ollamaClient.chat(payload.request),
  );

  return {
    ollamaClient,
    queue,
    tierConfig,
    costCalculator,
    logger: createSilentLogger(),
    ollamaHealthy: true,
    maxRequestSizeBytes: config.queue.maxRequestSizeBytes,
    config,
    executionTracker,
  };
}
