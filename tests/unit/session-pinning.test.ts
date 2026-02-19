import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePreloadModel, type PreloadModelContext } from '../../src/tools/preload-model.js';
import { handleListLoadedModels, type ListLoadedModelsContext } from '../../src/tools/list-loaded-models.js';
import { handleOffloadWork } from '../../src/tools/offload-work.js';
import { handleCompressContext } from '../../src/tools/compress-context.js';
import type { ToolHandlerContext } from '../../src/tools/offload-work.js';
import { OllamaClient } from '../../src/ollama/client.js';
import type { AppConfig } from '../../src/config/schema.js';
import type { TierConfig } from '../../src/tiering/config.js';
import pino from 'pino';

// ── Shared Helpers ──────────────────────────────────────────

function makeConfig(overrides?: Partial<AppConfig['modelSelector']>): AppConfig {
  return {
    ollama: { baseUrl: 'http://localhost:11434' },
    tier: null,
    timeout: null,
    queue: { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 60_000 },
    cost: { comparisonModel: 'claude-sonnet-4-5' },
    security: { enableInputSanitization: true },
    logLevel: 'info',
    modelSelector: {
      enabled: true,
      preferQuality: false,
      preloadKeepAlive: '-1',
      maxSimultaneousModels: 'auto' as const,
      customRecommendations: {},
      blockedModels: [],
      licenseFilter: ['Apache-2.0', 'MIT', 'NVIDIA-Open'],
      ...overrides,
    },
  };
}

function makeTierConfig(tier: 1 | 2 | 3): TierConfig {
  const configs: Record<number, TierConfig> = {
    1: {
      level: 1, name: 'Light', primaryModel: 'phi4:latest', fallbackModel: null,
      contextLimit: 4_000, ramRange: { min: 0, max: 16 },
      timeout: { requestTimeout: 60_000, heartbeatTimeout: 30_000, firstTokenTimeout: 120_000 },
    },
    2: {
      level: 2, name: 'Standard', primaryModel: 'qwen2.5-coder:7b', fallbackModel: null,
      contextLimit: 12_000, ramRange: { min: 16, max: 48 },
      timeout: { requestTimeout: 90_000, heartbeatTimeout: 30_000, firstTokenTimeout: 120_000 },
    },
    3: {
      level: 3, name: 'Ultra', primaryModel: 'qwen2.5-coder:32b', fallbackModel: null,
      contextLimit: 32_000, ramRange: { min: 48, max: Infinity },
      timeout: { requestTimeout: 180_000, heartbeatTimeout: 45_000, firstTokenTimeout: 180_000 },
    },
  };
  return configs[tier]!;
}

const silentLogger = pino({ level: 'silent' });

// ── DMS-014: preload_model Tests ────────────────────────────

describe('handlePreloadModel (DMS-014)', () => {
  function makePreloadContext(
    tier: 1 | 2 | 3 = 3,
    ollamaHealthy = true,
  ): PreloadModelContext {
    const client = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      requestTimeout: 10_000,
      heartbeatTimeout: 5_000,
      firstTokenTimeout: 10_000,
    });
    return {
      ollamaClient: client,
      tierConfig: makeTierConfig(tier),
      config: makeConfig(),
      logger: silentLogger,
      ollamaHealthy,
    };
  }

  it('returns error when Ollama is not available', async () => {
    const ctx = makePreloadContext(3, false);
    vi.spyOn(ctx.ollamaClient, 'healthCheck').mockResolvedValueOnce(false);

    const result = await handlePreloadModel({ model: 'qwen2.5-coder:32b' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('CTS-1001');
  });

  it('recovers when Ollama becomes healthy on recheck', async () => {
    const ctx = makePreloadContext(3, false);
    vi.spyOn(ctx.ollamaClient, 'healthCheck').mockResolvedValueOnce(true);
    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [{ name: 'qwen2.5-coder:32b', size: 18_500_000_000, digest: 'abc', modified_at: '2026-01-01' }],
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({ models: [] });
    vi.spyOn(ctx.ollamaClient, 'chat').mockResolvedValueOnce({
      text: '', model: 'qwen2.5-coder:32b', inputTokens: 0, outputTokens: 0,
      totalDurationMs: 100, loadDurationMs: 50,
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{ name: 'qwen2.5-coder:32b', model: 'qwen2.5-coder:32b', size: 18_500_000_000, size_vram: 17_000_000_000, digest: 'abc', expires_at: '9999-12-31T00:00:00Z', details: {} }],
    });

    const result = await handlePreloadModel({ model: 'qwen2.5-coder:32b' }, ctx);
    expect(result.isError).toBeUndefined();
    expect(ctx.ollamaHealthy).toBe(true);
  });

  it('returns error for missing model name', async () => {
    const ctx = makePreloadContext(3);
    const result = await handlePreloadModel({}, ctx);
    expect(result.isError).toBe(true);
  });

  it('returns error for empty model name', async () => {
    const ctx = makePreloadContext(3);
    const result = await handlePreloadModel({ model: '  ' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('returns error when model is not installed', async () => {
    const ctx = makePreloadContext(3);
    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [{ name: 'phi4:latest', size: 5_000_000_000, digest: 'xyz', modified_at: '2026-01-01' }],
    });

    const result = await handlePreloadModel({ model: 'nonexistent:latest' }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('not installed');
  });

  it('returns error when VRAM slots are full', async () => {
    const ctx = makePreloadContext(1); // Tier 1 = 1 slot max
    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [
        { name: 'phi4:latest', size: 5_000_000_000, digest: 'a', modified_at: '2026-01-01' },
        { name: 'qwen3:8b', size: 5_000_000_000, digest: 'b', modified_at: '2026-01-01' },
      ],
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{ name: 'phi4:latest', model: 'phi4:latest', size: 5_000_000_000, size_vram: 4_500_000_000, digest: 'a', expires_at: '9999-12-31T00:00:00Z', details: {} }],
    });

    const result = await handlePreloadModel({ model: 'qwen3:8b' }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('CTS-4001');
    expect(text).toContain('model slots used');
  });

  it('skips slot check when model is already loaded', async () => {
    const ctx = makePreloadContext(1); // Tier 1 = 1 slot max
    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [{ name: 'phi4:latest', size: 5_000_000_000, digest: 'a', modified_at: '2026-01-01' }],
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{ name: 'phi4:latest', model: 'phi4:latest', size: 5_000_000_000, size_vram: 4_500_000_000, digest: 'a', expires_at: '9999-12-31T00:00:00Z', details: {} }],
    });
    vi.spyOn(ctx.ollamaClient, 'chat').mockResolvedValueOnce({
      text: '', model: 'phi4:latest', inputTokens: 0, outputTokens: 0,
      totalDurationMs: 50, loadDurationMs: 10,
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{ name: 'phi4:latest', model: 'phi4:latest', size: 5_000_000_000, size_vram: 4_500_000_000, digest: 'a', expires_at: '9999-12-31T00:00:00Z', details: {} }],
    });

    const result = await handlePreloadModel({ model: 'phi4:latest' }, ctx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('preloaded successfully');
  });

  it('preloads model successfully with VRAM info', async () => {
    const ctx = makePreloadContext(3);
    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [{ name: 'qwen2.5-coder:32b', size: 18_500_000_000, digest: 'abc', modified_at: '2026-01-01' }],
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({ models: [] });
    vi.spyOn(ctx.ollamaClient, 'chat').mockResolvedValueOnce({
      text: '', model: 'qwen2.5-coder:32b', inputTokens: 0, outputTokens: 1,
      totalDurationMs: 2000, loadDurationMs: 1500,
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{
        name: 'qwen2.5-coder:32b', model: 'qwen2.5-coder:32b',
        size: 18_500_000_000, size_vram: 17_000_000_000,
        digest: 'abc', expires_at: '9999-12-31T00:00:00Z', details: {},
      }],
    });

    const result = await handlePreloadModel({ model: 'qwen2.5-coder:32b' }, ctx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('preloaded successfully');
    expect(text).toContain('qwen2.5-coder:32b');
    expect(text).toContain('VRAM Usage');
    expect(text).toContain('ready for inference');
  });

  it('uses custom keep_alive when provided', async () => {
    const ctx = makePreloadContext(3);
    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [{ name: 'qwen2.5-coder:32b', size: 18_500_000_000, digest: 'abc', modified_at: '2026-01-01' }],
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({ models: [] });
    vi.spyOn(ctx.ollamaClient, 'chat').mockResolvedValueOnce({
      text: '', model: 'qwen2.5-coder:32b', inputTokens: 0, outputTokens: 0,
      totalDurationMs: 100, loadDurationMs: 50,
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{ name: 'qwen2.5-coder:32b', model: 'qwen2.5-coder:32b', size: 18_500_000_000, size_vram: 17_000_000_000, digest: 'abc', expires_at: '2026-01-01T01:00:00Z', details: {} }],
    });

    const result = await handlePreloadModel({ model: 'qwen2.5-coder:32b', keep_alive: '1h' }, ctx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('1h');
  });

  it('shows permanent for default keep_alive (-1)', async () => {
    const ctx = makePreloadContext(3);
    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [{ name: 'qwen2.5-coder:32b', size: 18_500_000_000, digest: 'abc', modified_at: '2026-01-01' }],
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({ models: [] });
    vi.spyOn(ctx.ollamaClient, 'chat').mockResolvedValueOnce({
      text: '', model: 'qwen2.5-coder:32b', inputTokens: 0, outputTokens: 0,
      totalDurationMs: 100, loadDurationMs: 50,
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{ name: 'qwen2.5-coder:32b', model: 'qwen2.5-coder:32b', size: 18_500_000_000, size_vram: 17_000_000_000, digest: 'abc', expires_at: '9999-12-31T00:00:00Z', details: {} }],
    });

    const result = await handlePreloadModel({ model: 'qwen2.5-coder:32b' }, ctx);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('permanent');
  });

  it('returns CTS-0000 for non-CTSError in catch', async () => {
    const ctx = makePreloadContext(3);
    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [{ name: 'qwen2.5-coder:32b', size: 18_500_000_000, digest: 'abc', modified_at: '2026-01-01T00:00:00Z' }],
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({ models: [] });
    // Make chat throw a non-CTSError
    vi.spyOn(ctx.ollamaClient, 'chat').mockRejectedValueOnce(new TypeError('unexpected crash'));

    const result = await handlePreloadModel({ model: 'qwen2.5-coder:32b' }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('CTS-0000');
  });
});

// ── DMS-015: list_loaded_models Tests ───────────────────────

describe('handleListLoadedModels (DMS-015)', () => {
  function makeListContext(
    tier: 1 | 2 | 3 = 3,
    ollamaHealthy = true,
  ): ListLoadedModelsContext {
    const client = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      requestTimeout: 10_000,
      heartbeatTimeout: 5_000,
      firstTokenTimeout: 10_000,
    });
    return {
      ollamaClient: client,
      tierConfig: makeTierConfig(tier),
      config: makeConfig(),
      logger: silentLogger,
      ollamaHealthy,
    };
  }

  it('returns error when Ollama is not available', async () => {
    const ctx = makeListContext(3, false);
    vi.spyOn(ctx.ollamaClient, 'healthCheck').mockResolvedValueOnce(false);

    const result = await handleListLoadedModels({}, ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('CTS-1001');
  });

  it('shows empty state when no models are loaded', async () => {
    const ctx = makeListContext(3);
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({ models: [] });

    const result = await handleListLoadedModels({}, ctx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No models currently loaded');
    expect(text).toContain('0/');
  });

  it('shows loaded models in table format', async () => {
    const ctx = makeListContext(3);
    const futureDate = new Date(Date.now() + 30 * 60_000).toISOString(); // 30 min from now
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [
        {
          name: 'qwen2.5-coder:32b', model: 'qwen2.5-coder:32b',
          size: 18_500_000_000, size_vram: 17_000_000_000,
          digest: 'abc', expires_at: futureDate, details: {},
        },
        {
          name: 'phi4:latest', model: 'phi4:latest',
          size: 5_000_000_000, size_vram: 4_500_000_000,
          digest: 'def', expires_at: '9999-12-31T00:00:00Z', details: {},
        },
      ],
    });

    const result = await handleListLoadedModels({}, ctx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('## Loaded Models');
    expect(text).toContain('qwen2.5-coder:32b');
    expect(text).toContain('phi4:latest');
    expect(text).toContain('permanent');
    expect(text).toContain('VRAM Total');
    expect(text).toContain('Slots:');
    expect(text).toContain('2/');
  });

  it('shows expired status for past expiry times', async () => {
    const ctx = makeListContext(3);
    const pastDate = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{
        name: 'phi4:latest', model: 'phi4:latest',
        size: 5_000_000_000, size_vram: 4_500_000_000,
        digest: 'def', expires_at: pastDate, details: {},
      }],
    });

    const result = await handleListLoadedModels({}, ctx);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('expired');
  });

  it('shows minutes remaining for near-future expiry', async () => {
    const ctx = makeListContext(3);
    const futureDate = new Date(Date.now() + 15 * 60_000).toISOString(); // 15 min from now
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{
        name: 'phi4:latest', model: 'phi4:latest',
        size: 5_000_000_000, size_vram: 4_500_000_000,
        digest: 'def', expires_at: futureDate, details: {},
      }],
    });

    const result = await handleListLoadedModels({}, ctx);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toMatch(/\d+m/);
  });

  it('shows hours for far-future expiry', async () => {
    const ctx = makeListContext(3);
    const futureDate = new Date(Date.now() + 3 * 60 * 60_000).toISOString(); // 3 hours from now
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{
        name: 'phi4:latest', model: 'phi4:latest',
        size: 5_000_000_000, size_vram: 4_500_000_000,
        digest: 'def', expires_at: futureDate, details: {},
      }],
    });

    const result = await handleListLoadedModels({}, ctx);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toMatch(/\d+h/);
  });

  it('handles invalid expiry date gracefully', async () => {
    const ctx = makeListContext(3);
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [{
        name: 'phi4:latest', model: 'phi4:latest',
        size: 5_000_000_000, size_vram: 4_500_000_000,
        digest: 'def', expires_at: 'not-a-date', details: {},
      }],
    });

    const result = await handleListLoadedModels({}, ctx);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    // Should handle gracefully without throwing
    expect(text).toContain('phi4:latest');
  });

  it('recovers when Ollama becomes healthy on recheck', async () => {
    const ctx = makeListContext(3, false);
    vi.spyOn(ctx.ollamaClient, 'healthCheck').mockResolvedValueOnce(true);
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({ models: [] });

    const result = await handleListLoadedModels({}, ctx);
    expect(result.isError).toBeUndefined();
    expect(ctx.ollamaHealthy).toBe(true);
  });
});

// ── DMS-016: offload_work model/category override Tests ─────

describe('offload_work model/category override (DMS-016)', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  function createMockContext(overrides?: Partial<ToolHandlerContext>): ToolHandlerContext {
    return {
      ollamaClient: {
        healthCheck: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        getVersion: vi.fn(),
        listModels: vi.fn(),
        pullModel: vi.fn(),
        listModelsFull: vi.fn().mockResolvedValue({
          models: [
            { name: 'qwen2.5-coder:32b', size: 18_500_000_000, digest: 'abc', modified_at: '2026-01-01' },
            { name: 'devstral:24b', size: 14_000_000_000, digest: 'def', modified_at: '2026-01-01' },
          ],
        }),
        listRunning: vi.fn().mockResolvedValue({
          models: [{ name: 'qwen2.5-coder:32b', model: 'qwen2.5-coder:32b', size: 18_500_000_000, size_vram: 17_000_000_000, digest: 'abc', expires_at: '9999-12-31T00:00:00Z', details: {} }],
        }),
      } as unknown as ToolHandlerContext['ollamaClient'],
      queue: {
        enqueue: vi.fn().mockResolvedValue({
          text: 'result',
          inputTokens: 100,
          outputTokens: 50,
          totalDurationMs: 500,
          loadDurationMs: 100,
          model: 'custom-model',
        }),
        getStatus: vi.fn(),
      } as unknown as ToolHandlerContext['queue'],
      tierConfig: makeTierConfig(3),
      costCalculator: {
        calculateSavings: vi.fn().mockReturnValue({
          savingsUsd: 0.0015,
          cumulativeSavingsUsd: 0.01,
          inputTokens: 100,
          outputTokens: 50,
          comparisonModel: 'claude-sonnet-4-5',
        }),
        getCumulativeSavings: vi.fn(),
        reset: vi.fn(),
        restoreFromHistory: vi.fn(),
      } as unknown as ToolHandlerContext['costCalculator'],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as unknown as ToolHandlerContext['logger'],
      ollamaHealthy: true,
      maxRequestSizeBytes: 200 * 1024,
      config: makeConfig(),
      ...overrides,
    };
  }

  it('uses explicit model override when provided', async () => {
    const ctx = createMockContext();
    await handleOffloadWork(
      { task: 'write a test', model: 'devstral:24b' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('devstral:24b');
  });

  it('uses default model when no override is specified', async () => {
    const ctx = createMockContext();
    await handleOffloadWork({ task: 'write a test' }, ctx);

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('qwen2.5-coder:32b'); // tierConfig.primaryModel
  });

  it('model takes precedence over category', async () => {
    const ctx = createMockContext();
    await handleOffloadWork(
      { task: 'test', model: 'devstral:24b', category: 'coding' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('devstral:24b');
  });

  it('category selects model via recommender', async () => {
    const ctx = createMockContext();
    await handleOffloadWork(
      { task: 'test', category: 'coding' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // Should be the recommender's top pick for coding + tier 3 + installed models
    // qwen2.5-coder:32b is installed and is the top coding recommendation for tier 3
    expect(enqueuedPayload.request.model).toBe('qwen2.5-coder:32b');
  });

  it('ignores category when modelSelector is disabled', async () => {
    const ctx = createMockContext({
      config: makeConfig({ enabled: false }),
    });
    await handleOffloadWork(
      { task: 'test', category: 'coding' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('qwen2.5-coder:32b'); // falls back to tierConfig.primaryModel
  });

  it('ignores invalid category and uses default model', async () => {
    const ctx = createMockContext();
    await handleOffloadWork(
      { task: 'test', category: 'invalid-category' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('qwen2.5-coder:32b'); // tierConfig.primaryModel
  });

  it('falls back to default when recommender fails', async () => {
    const ctx = createMockContext({
      ollamaClient: {
        healthCheck: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        getVersion: vi.fn(),
        listModels: vi.fn(),
        pullModel: vi.fn(),
        listModelsFull: vi.fn().mockRejectedValue(new Error('connection failed')),
        listRunning: vi.fn().mockRejectedValue(new Error('connection failed')),
      } as unknown as ToolHandlerContext['ollamaClient'],
    });
    await handleOffloadWork(
      { task: 'test', category: 'coding' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // Should still succeed, using a recommendation (without installed models info)
    expect(typeof enqueuedPayload.request.model).toBe('string');
    expect(enqueuedPayload.request.model.length).toBeGreaterThan(0);
  });

  it('works without config (backward compat)', async () => {
    const ctx = createMockContext();
    delete (ctx as Partial<ToolHandlerContext>).config;
    await handleOffloadWork(
      { task: 'test', category: 'coding' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('qwen2.5-coder:32b'); // tierConfig.primaryModel
  });
});

// ── DMS-017: compress_context model override Tests ──────────

describe('compress_context model override (DMS-017)', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  function createMockContext(overrides?: Partial<ToolHandlerContext>): ToolHandlerContext {
    return {
      ollamaClient: {
        healthCheck: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        getVersion: vi.fn(),
        listModels: vi.fn(),
        pullModel: vi.fn(),
      } as unknown as ToolHandlerContext['ollamaClient'],
      queue: {
        enqueue: vi.fn().mockResolvedValue({
          text: 'compressed output',
          inputTokens: 500,
          outputTokens: 100,
          totalDurationMs: 800,
          loadDurationMs: 50,
          model: 'override-model',
        }),
        getStatus: vi.fn(),
      } as unknown as ToolHandlerContext['queue'],
      tierConfig: makeTierConfig(3),
      costCalculator: {
        calculateSavings: vi.fn().mockReturnValue({
          savingsUsd: 0.003,
          cumulativeSavingsUsd: 0.05,
          inputTokens: 500,
          outputTokens: 100,
          comparisonModel: 'claude-sonnet-4-5',
        }),
        getCumulativeSavings: vi.fn(),
        reset: vi.fn(),
        restoreFromHistory: vi.fn(),
      } as unknown as ToolHandlerContext['costCalculator'],
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as unknown as ToolHandlerContext['logger'],
      ollamaHealthy: true,
      maxRequestSizeBytes: 200 * 1024,
      ...overrides,
    };
  }

  it('uses explicit model override when provided', async () => {
    const ctx = createMockContext();
    await handleCompressContext(
      { content: 'some long text to compress', model: 'qwen3:8b' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('qwen3:8b');
  });

  it('uses default model when no override is specified', async () => {
    const ctx = createMockContext();
    await handleCompressContext(
      { content: 'some text' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('qwen2.5-coder:32b'); // tierConfig.primaryModel
  });

  it('ignores empty model string', async () => {
    const ctx = createMockContext();
    await handleCompressContext(
      { content: 'some text', model: '   ' },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('qwen2.5-coder:32b'); // tierConfig.primaryModel
  });

  it('ignores non-string model value', async () => {
    const ctx = createMockContext();
    await handleCompressContext(
      { content: 'some text', model: 42 },
      ctx,
    );

    const enqueuedPayload = (ctx.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(enqueuedPayload.request.model).toBe('qwen2.5-coder:32b'); // tierConfig.primaryModel
  });
});
