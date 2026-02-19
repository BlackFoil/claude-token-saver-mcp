import { describe, it, expect, vi } from 'vitest';
import { handleRecommendModel, type RecommendModelContext } from '../../src/tools/recommend-model.js';
import { OllamaClient } from '../../src/ollama/client.js';
import type { AppConfig } from '../../src/config/schema.js';
import type { TierConfig } from '../../src/tiering/config.js';
import pino from 'pino';

// ── Test Helpers ─────────────────────────────────────────────

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
      blockedModels: ['codestral'],
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

function makeContext(
  tier: 1 | 2 | 3 = 3,
  configOverrides?: Partial<AppConfig['modelSelector']>,
  ollamaHealthy = false,
): RecommendModelContext {
  const client = new OllamaClient({
    baseUrl: 'http://localhost:11434',
    requestTimeout: 10_000,
    heartbeatTimeout: 5_000,
    firstTokenTimeout: 10_000,
  });

  return {
    ollamaClient: client,
    tierConfig: makeTierConfig(tier),
    config: makeConfig(configOverrides),
    logger: pino({ level: 'silent' }),
    ollamaHealthy,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('handleRecommendModel (DMS-010/013)', () => {
  it('returns recommendations for coding category', async () => {
    const ctx = makeContext(3);
    const result = await handleRecommendModel({ category: 'coding' }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('## Model Recommendation');
    expect(text).toContain('coding');
    expect(text).toContain('Tier 3');
  });

  it('returns recommendations for japanese-text category', async () => {
    const ctx = makeContext(2);
    const result = await handleRecommendModel({ category: 'japanese-text' }, ctx);

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('japanese-text');
    expect(text).toContain('Tier 2');
  });

  it('returns error for invalid category', async () => {
    const ctx = makeContext(3);
    const result = await handleRecommendModel({ category: 'invalid' }, ctx);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('CTS-6001');
  });

  it('returns error when modelSelector is disabled', async () => {
    const ctx = makeContext(3, { enabled: false });
    const result = await handleRecommendModel({ category: 'coding' }, ctx);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('CTS-6001');
    expect(text).toContain('disabled');
  });

  it('returns error when category is missing', async () => {
    const ctx = makeContext(3);
    const result = await handleRecommendModel({}, ctx);

    expect(result.isError).toBe(true);
  });

  it('respects prefer_quality parameter', async () => {
    const ctx = makeContext(3);
    const result = await handleRecommendModel(
      { category: 'coding', prefer_quality: true },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('## Model Recommendation');
  });

  it('shows installed models when Ollama is healthy', async () => {
    const ctx = makeContext(3, undefined, true);

    // Mock listModelsFull and listRunning
    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [
        { name: 'qwen2.5-coder:32b', size: 18_500_000_000, digest: 'abc', modified_at: '2026-01-01T00:00:00Z' },
      ],
    });
    vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [],
    });

    const result = await handleRecommendModel({ category: 'coding' }, ctx);
    const text = (result.content[0] as { type: 'text'; text: string }).text;

    expect(text).toContain('✅');
    expect(text).toContain('qwen2.5-coder:32b');
  });

  it('handles Ollama connection failure gracefully', async () => {
    const ctx = makeContext(3, undefined, true);

    vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const result = await handleRecommendModel({ category: 'coding' }, ctx);

    // Should not error, just proceed without install status
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('## Model Recommendation');
  });

  it('works for all valid categories', async () => {
    const ctx = makeContext(2);
    const categories = [
      'coding', 'coding-agent', 'japanese-text',
      'japanese-coding', 'translation', 'summarization', 'general',
    ];

    for (const category of categories) {
      const result = await handleRecommendModel({ category }, ctx);
      expect(result.isError).toBeUndefined();
    }
  });

  it('tier 1 shows VRAM fallback for non-general categories', async () => {
    const ctx = makeContext(1);
    const result = await handleRecommendModel({ category: 'coding' }, ctx);

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('VRAM constraints');
  });

  it('respects blocked models from config', async () => {
    const ctx = makeContext(3, { blockedModels: ['qwen2.5-coder'] });
    const result = await handleRecommendModel({ category: 'coding' }, ctx);

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).not.toContain('qwen2.5-coder');
  });

  it('includes license information in output', async () => {
    const ctx = makeContext(3);
    const result = await handleRecommendModel({ category: 'coding' }, ctx);

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('License:');
  });
});
