/**
 * E2E Tests — AbortController 3-Layer Timeout Verification
 *
 * Tests the three timeout layers in OllamaClient.chat():
 *   1. firstTokenTimeout  → ModelLoadTimeoutError
 *   2. requestTimeout     → GenerationTimeoutError
 *   3. heartbeatTimeout   → GenerationTimeoutError
 *
 * Uses extremely short timeouts against a real Ollama server
 * to force each timeout path to trigger.
 *
 * Run: npm run test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  isOllamaAvailable,
  createE2EClient,
  TEST_MODEL,
} from '../helpers/e2e-setup.js';
import { ModelLoadTimeoutError, GenerationTimeoutError } from '../../src/ollama/client.js';

const ollamaReady = await isOllamaAvailable();

describe.runIf(ollamaReady)('E2E: Timeout Layer Verification', () => {
  // Ensure model is available before testing timeouts
  beforeAll(async () => {
    const client = createE2EClient();
    const models = await client.listModels();
    const installed = models.some((m) => m.name.startsWith('qwen2.5-coder:1.5b'));
    if (!installed) {
      await client.pullModel(TEST_MODEL);
    }
  });

  // ── T-01: firstTokenTimeout ──

  it('T-01: firstTokenTimeout — triggers ModelLoadTimeoutError', async () => {
    const client = createE2EClient({
      firstTokenTimeout: 50,
      requestTimeout: 300_000,
      heartbeatTimeout: 300_000,
    });

    await expect(
      client.chat({
        model: TEST_MODEL,
        messages: [
          { role: 'user', content: 'Write a detailed essay about the history of computing from 1940 to 2020.' },
        ],
        stream: true,
        options: {
          num_predict: 500,
          temperature: 0,
        },
      }),
    ).rejects.toThrow(ModelLoadTimeoutError);
  });

  // ── T-02: requestTimeout ──

  it('T-02: requestTimeout — triggers GenerationTimeoutError', async () => {
    const client = createE2EClient({
      firstTokenTimeout: 300_000,
      requestTimeout: 50,
      heartbeatTimeout: 300_000,
    });

    await expect(
      client.chat({
        model: TEST_MODEL,
        messages: [
          { role: 'user', content: 'Write a detailed essay about the history of computing from 1940 to 2020.' },
        ],
        stream: true,
        options: {
          num_predict: 500,
          temperature: 0,
        },
      }),
    ).rejects.toThrow(GenerationTimeoutError);
  });

  // ── T-03: heartbeatTimeout ──

  it('T-03: heartbeatTimeout — triggers GenerationTimeoutError on chunk gap', async () => {
    const client = createE2EClient({
      firstTokenTimeout: 300_000,
      requestTimeout: 300_000,
      heartbeatTimeout: 1,
    });

    await expect(
      client.chat({
        model: TEST_MODEL,
        messages: [
          { role: 'user', content: 'Write a detailed essay about the history of computing from 1940 to 2020.' },
        ],
        stream: true,
        options: {
          num_predict: 500,
          temperature: 0,
        },
      }),
    ).rejects.toThrow(GenerationTimeoutError);
  });
});
