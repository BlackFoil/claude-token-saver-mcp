/**
 * E2E Tests — Real Ollama Server Integration
 *
 * Requires a running Ollama server (v0.1.34+).
 * Tests are auto-skipped when Ollama is unreachable.
 *
 * Run: npm run test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  isOllamaAvailable,
  createE2EClient,
  createE2EToolContext,
  createE2EConfig,
  TEST_MODEL,
} from '../helpers/e2e-setup.js';
import { handleOffloadWork } from '../../src/tools/offload-work.js';
import { handleCompressContext } from '../../src/tools/compress-context.js';
import { handlePreloadModel } from '../../src/tools/preload-model.js';
import { handleListLoadedModels } from '../../src/tools/list-loaded-models.js';
import { handleRecommendModel } from '../../src/tools/recommend-model.js';
import { handleCostDashboard } from '../../src/tools/cost-dashboard.js';
import { detectTier } from '../../src/tiering/detector.js';

const ollamaReady = await isOllamaAvailable();

describe.runIf(ollamaReady)('E2E: Ollama Integration', () => {
  const client = createE2EClient();

  // ── beforeAll: ensure test model is pulled ──

  beforeAll(async () => {
    const models = await client.listModels();
    const installed = models.some((m) => m.name.startsWith('qwen2.5-coder:1.5b'));
    if (!installed) {
      // Pull with 300s timeout (hookTimeout covers this)
      await client.pullModel(TEST_MODEL);
    }
  });

  // ── E2E-01: healthCheck ──

  it('E2E-01: healthCheck — real connection succeeds', async () => {
    const result = await client.healthCheck();
    expect(result).toBe(true);
  });

  // ── E2E-02: getVersion ──

  it('E2E-02: getVersion — returns valid semver >= 0.1.34', async () => {
    const version = await client.getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);

    // Verify >= 0.1.34
    const [major, minor, patch] = version.split('.').map(Number);
    const versionNum = major! * 10000 + minor! * 100 + patch!;
    expect(versionNum).toBeGreaterThanOrEqual(134);
  });

  // ── E2E-03: listModels ──

  it('E2E-03: listModels — pulled model appears in list', async () => {
    const models = await client.listModels();
    expect(models.length).toBeGreaterThan(0);

    const found = models.find((m) => m.name.startsWith('qwen2.5-coder:1.5b'));
    expect(found).toBeDefined();
    expect(found!.size).toBeGreaterThan(0);
    expect(found!.digest).toBeTruthy();
  });

  // ── E2E-04: pullModel ──

  it('E2E-04: pullModel — re-pull returns valid response', async () => {
    const result = await client.pullModel(TEST_MODEL);
    expect(result.modelName).toBe(TEST_MODEL);
    expect(typeof result.alreadyUpToDate).toBe('boolean');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  // ── E2E-05: chat ──

  it('E2E-05: chat — real inference returns non-empty text', async () => {
    const response = await client.chat({
      model: TEST_MODEL,
      messages: [
        { role: 'user', content: 'Return the number 42.' },
      ],
      stream: true,
      options: {
        num_predict: 10,
        temperature: 0,
      },
    });

    expect(response.text.length).toBeGreaterThan(0);
    expect(response.inputTokens).toBeGreaterThan(0);
    expect(response.outputTokens).toBeGreaterThan(0);
    expect(response.totalDurationMs).toBeGreaterThan(0);
    expect(response.model).toContain('qwen2.5-coder');
  });

  // ── E2E-06: offload_work — full pipeline ──

  it('E2E-06: offload_work — full pipeline (validate → PI → queue → Ollama → cost)', async () => {
    const ctx = createE2EToolContext(client);
    const result = await handleOffloadWork(
      { task: 'Return only the word hello', model: TEST_MODEL },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);

    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('Model:');
    expect(text).toContain('Savings:');
  });

  // ── E2E-07: compress_context — real summarization ──

  it('E2E-07: compress_context — compression ratio is positive', async () => {
    const longContent = 'TypeScript is a typed superset of JavaScript. '.repeat(20);
    const ctx = createE2EToolContext(client);
    const result = await handleCompressContext(
      { content: longContent, model: TEST_MODEL },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);

    // Verify compression metadata is present
    expect(text).toContain('Compression:');
    expect(text).toContain('reduced');
  });

  // ── E2E-08: preload + list — VRAM verification ──

  it('E2E-08: preload_model → list_loaded_models — VRAM confirmed', async () => {
    const tierConfig = detectTier(64);
    const config = createE2EConfig();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as import('pino').Logger;

    const preloadCtx = {
      ollamaClient: client,
      tierConfig,
      config,
      logger,
      ollamaHealthy: true,
    };

    // Preload the model
    const preloadResult = await handlePreloadModel(
      { model: TEST_MODEL },
      preloadCtx,
    );
    expect(preloadResult.isError).toBeUndefined();

    const preloadText = (preloadResult.content[0] as { text: string }).text;
    expect(preloadText).toContain('preloaded successfully');
    expect(preloadText).toContain('VRAM Usage');

    // List loaded models
    const listResult = await handleListLoadedModels({}, preloadCtx);
    expect(listResult.isError).toBeUndefined();

    const listText = (listResult.content[0] as { text: string }).text;
    expect(listText).toContain('Loaded Models');
    expect(listText).toContain('qwen2.5-coder');
  });

  // ── E2E-09: recommend_model ──

  it('E2E-09: recommend_model — returns recommendations for coding category', async () => {
    const tierConfig = detectTier(64);
    const config = createE2EConfig();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as import('pino').Logger;

    const ctx = {
      ollamaClient: client,
      tierConfig,
      config,
      logger,
      ollamaHealthy: true,
    };

    const result = await handleRecommendModel(
      { category: 'coding' },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
    // The recommendation output should contain model suggestions
    expect(text).toContain('coding');
  });

  // ── E2E-10: cost_dashboard — after real calls ──

  it('E2E-10: cost_dashboard — shows cumulative savings after real calls', async () => {
    // First, make a real offload_work call to accumulate savings
    const ctx = createE2EToolContext(client);
    await handleOffloadWork(
      { task: 'Return the number 1', model: TEST_MODEL },
      ctx,
    );

    // Now check the dashboard
    const dashResult = await handleCostDashboard(
      {},
      {
        costCalculator: ctx.costCalculator,
        executionTracker: ctx.executionTracker,
        logger: ctx.logger,
      },
    );

    expect(dashResult.isError).toBeUndefined();
    const text = (dashResult.content[0] as { text: string }).text;
    expect(text).toContain('Cost Savings Dashboard');
    expect(text).toContain('Total Savings:');
    expect(text).toContain('Total Requests:');

    // Should have at least 1 request
    expect(text).not.toContain('Total Requests: 0');
  });
});
