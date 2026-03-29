/**
 * Integration tests for Dynamic Model Selector (DMS-024)
 * Tests the full pipeline: recommend → pull → preload → offload_work(model=xxx)
 * Ollama API is mocked at the fetch level.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleRecommendModel,
  type RecommendModelContext,
} from '../../src/tools/recommend-model.js';
import { handlePullModel, type PullModelContext } from '../../src/tools/pull-model.js';
import { handlePreloadModel, type PreloadModelContext } from '../../src/tools/preload-model.js';
import {
  handleListLoadedModels,
  type ListLoadedModelsContext,
} from '../../src/tools/list-loaded-models.js';
import {
  handleOffloadWork,
  type ToolHandlerContext,
  type OllamaTaskPayload,
} from '../../src/tools/offload-work.js';
import { OllamaClient, type OllamaChatResponse } from '../../src/ollama/client.js';
import { FIFOQueue } from '../../src/queue/fifo-queue.js';
import { CostCalculator } from '../../src/cost/calculator.js';
import { DEFAULT_PRICING, DEFAULT_COMPARISON_MODEL } from '../../src/cost/pricing.js';
import { detectTier } from '../../src/tiering/detector.js';
import {
  parseClaudeMdRoles,
  extractUniqueCategories,
} from '../../src/model-selector/claude-md-parser.js';
import type { AppConfig } from '../../src/config/schema.js';
import pino from 'pino';

// ── Helpers ──────────────────────────────────────────────────

const silentLogger = pino({ level: 'silent' });

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

function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.map((l) => l + '\n').join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });
}

function createOllamaStreamResponse(text: string, model: string): string[] {
  const words = text.split(' ');
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const content = i === 0 ? words[i]! : ' ' + words[i]!;
    chunks.push(
      JSON.stringify({
        model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content },
        done: false,
      }),
    );
  }
  chunks.push(
    JSON.stringify({
      model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: '' },
      done: true,
      total_duration: 500_000_000,
      load_duration: 50_000_000,
      prompt_eval_count: 10,
      prompt_eval_duration: 200_000_000,
      eval_count: words.length,
      eval_duration: 100_000_000,
    }),
  );
  return chunks;
}

// ── Integration: Full Model Selector Pipeline ───────────────

describe('Integration: Model Selector Pipeline (DMS-024)', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    stderrSpy?.mockRestore();
  });

  it('I-MS-01: recommend → pull → preload → offload_work(model) pipeline', async () => {
    const tierConfig = detectTier(64); // Tier 3
    const config = makeConfig();
    const ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      requestTimeout: 10_000,
      heartbeatTimeout: 5_000,
      firstTokenTimeout: 10_000,
    });

    // Step 1: recommend_model for coding
    const recCtx: RecommendModelContext = {
      ollamaClient,
      tierConfig,
      config,
      logger: silentLogger,
      ollamaHealthy: false,
    };
    const recResult = await handleRecommendModel({ category: 'coding' }, recCtx);
    expect(recResult.isError).toBeUndefined();
    const recText = (recResult.content[0] as { type: 'text'; text: string }).text;
    expect(recText).toContain('## Model Recommendation');
    expect(recText).toContain('coding');
    expect(recText).toContain('Tier 3');

    // Step 2: pull_model (mock success)
    const pullCtx: PullModelContext = {
      ollamaClient,
      logger: silentLogger,
      ollamaHealthy: true,
    };
    vi.spyOn(ollamaClient, 'pullModel').mockResolvedValueOnce({
      modelName: 'qwen2.5-coder:32b',
      sizeBytes: 18_500_000_000,
      durationMs: 120_000,
      alreadyUpToDate: false,
    });
    const pullResult = await handlePullModel({ model: 'qwen2.5-coder:32b' }, pullCtx);
    expect(pullResult.isError).toBeUndefined();
    expect((pullResult.content[0] as { type: 'text'; text: string }).text).toContain(
      'pulled successfully',
    );

    // Step 3: preload_model (mock VRAM load)
    const preloadCtx: PreloadModelContext = {
      ollamaClient,
      tierConfig,
      config,
      logger: silentLogger,
      ollamaHealthy: true,
    };
    vi.spyOn(ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [
        {
          name: 'qwen2.5-coder:32b',
          size: 18_500_000_000,
          digest: 'abc',
          modified_at: '2026-01-01',
        },
      ],
    });
    vi.spyOn(ollamaClient, 'listRunning').mockResolvedValueOnce({ models: [] });
    vi.spyOn(ollamaClient, 'chat').mockResolvedValueOnce({
      text: '',
      model: 'qwen2.5-coder:32b',
      inputTokens: 0,
      outputTokens: 1,
      totalDurationMs: 2000,
      loadDurationMs: 1500,
    });
    vi.spyOn(ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [
        {
          name: 'qwen2.5-coder:32b',
          model: 'qwen2.5-coder:32b',
          size: 18_500_000_000,
          size_vram: 17_000_000_000,
          digest: 'abc',
          expires_at: '9999-12-31T00:00:00Z',
          details: {},
        },
      ],
    });
    const preloadResult = await handlePreloadModel({ model: 'qwen2.5-coder:32b' }, preloadCtx);
    expect(preloadResult.isError).toBeUndefined();
    expect((preloadResult.content[0] as { type: 'text'; text: string }).text).toContain(
      'preloaded successfully',
    );

    // Step 4: offload_work with model override
    const responseText = 'function sort(arr) { return arr.sort(); }';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(createOllamaStreamResponse(responseText, 'qwen2.5-coder:32b')), {
        status: 200,
      }),
    );

    const queue = new FIFOQueue<OllamaTaskPayload, OllamaChatResponse>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 30_000 },
      async (payload) => ollamaClient.chat(payload.request),
    );
    const costCalculator = new CostCalculator(DEFAULT_PRICING, DEFAULT_COMPARISON_MODEL);
    const toolCtx: ToolHandlerContext = {
      ollamaClient,
      queue,
      tierConfig,
      costCalculator,
      logger: silentLogger,
      ollamaHealthy: true,
      maxRequestSizeBytes: 200 * 1024,
      config,
    };

    const offloadResult = await handleOffloadWork(
      { task: 'Sort an array', model: 'qwen2.5-coder:32b' },
      toolCtx,
    );
    expect(offloadResult.isError).toBeUndefined();
    const offloadText = (offloadResult.content[0] as { type: 'text'; text: string }).text;
    expect(offloadText).toContain('sort');
    expect(offloadText).toContain('Model: qwen2.5-coder:32b');
    expect(offloadText).toContain('Savings:');

    fetchSpy.mockRestore();
  });

  it('I-MS-02: list_loaded_models shows preloaded model', async () => {
    const tierConfig = detectTier(64);
    const config = makeConfig();
    const ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      requestTimeout: 10_000,
      heartbeatTimeout: 5_000,
      firstTokenTimeout: 10_000,
    });

    const listCtx: ListLoadedModelsContext = {
      ollamaClient,
      tierConfig,
      config,
      logger: silentLogger,
      ollamaHealthy: true,
    };
    vi.spyOn(ollamaClient, 'listRunning').mockResolvedValueOnce({
      models: [
        {
          name: 'qwen2.5-coder:32b',
          model: 'qwen2.5-coder:32b',
          size: 18_500_000_000,
          size_vram: 17_000_000_000,
          digest: 'abc',
          expires_at: '9999-12-31T00:00:00Z',
          details: {},
        },
      ],
    });

    const result = await handleListLoadedModels({}, listCtx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('## Loaded Models');
    expect(text).toContain('qwen2.5-coder:32b');
    expect(text).toContain('permanent');
    expect(text).toContain('1/');
  });

  it('I-MS-03: VRAM fallback — Tier 1 redirects coding to general', async () => {
    const tierConfig = detectTier(8); // Tier 1 = 1 model only
    const config = makeConfig();
    const ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      requestTimeout: 10_000,
      heartbeatTimeout: 5_000,
      firstTokenTimeout: 10_000,
    });

    const recCtx: RecommendModelContext = {
      ollamaClient,
      tierConfig,
      config,
      logger: silentLogger,
      ollamaHealthy: false,
    };

    const result = await handleRecommendModel({ category: 'coding' }, recCtx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('VRAM constraints');
  });

  it('I-MS-04: offload_work with category uses recommender for model selection', async () => {
    const tierConfig = detectTier(64);
    const config = makeConfig();
    const ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      requestTimeout: 10_000,
      heartbeatTimeout: 5_000,
      firstTokenTimeout: 10_000,
    });

    // Mock installed models
    vi.spyOn(ollamaClient, 'listModelsFull').mockResolvedValueOnce({
      models: [
        {
          name: 'qwen2.5-coder:32b',
          size: 18_500_000_000,
          digest: 'abc',
          modified_at: '2026-01-01',
        },
      ],
    });
    vi.spyOn(ollamaClient, 'listRunning').mockResolvedValueOnce({ models: [] });

    const responseText = 'result code';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(createOllamaStreamResponse(responseText, 'qwen2.5-coder:32b')), {
        status: 200,
      }),
    );

    const queue = new FIFOQueue<OllamaTaskPayload, OllamaChatResponse>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 30_000 },
      async (payload) => ollamaClient.chat(payload.request),
    );
    const costCalculator = new CostCalculator(DEFAULT_PRICING, DEFAULT_COMPARISON_MODEL);
    const toolCtx: ToolHandlerContext = {
      ollamaClient,
      queue,
      tierConfig,
      costCalculator,
      logger: silentLogger,
      ollamaHealthy: true,
      maxRequestSizeBytes: 200 * 1024,
      config,
    };

    const result = await handleOffloadWork({ task: 'test task', category: 'coding' }, toolCtx);
    expect(result.isError).toBeUndefined();
    // The recommender should have selected qwen2.5-coder:32b (installed, tier 3 coding)
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Model: qwen2.5-coder:32b');

    fetchSpy.mockRestore();
  });

  it('I-MS-05: pull_model handles already-installed model', async () => {
    const ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      requestTimeout: 10_000,
      heartbeatTimeout: 5_000,
      firstTokenTimeout: 10_000,
    });
    const pullCtx: PullModelContext = {
      ollamaClient,
      logger: silentLogger,
      ollamaHealthy: true,
    };

    vi.spyOn(ollamaClient, 'pullModel').mockResolvedValueOnce({
      modelName: 'phi4:latest',
      sizeBytes: 0,
      durationMs: 200,
      alreadyUpToDate: true,
    });

    const result = await handlePullModel({ model: 'phi4:latest' }, pullCtx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('already up to date');
  });

  it('I-MS-06: CLAUDE.md parser → recommend_model pipeline', async () => {
    const claudeMdContent = `
| 役割 | 担当 | LLM用途 |
|:---|:---|:---|
| PM | Claude Code | Cloud API |
| Coder | Local LLM | coding |
| Writer | Local LLM | japanese-text |
| Researcher | Claude Code | Cloud API |
`;
    // Step 1: Parse CLAUDE.md
    const mappings = parseClaudeMdRoles(claudeMdContent);
    expect(mappings).toHaveLength(2);
    const categories = extractUniqueCategories(mappings);
    expect(categories).toContain('coding');
    expect(categories).toContain('japanese-text');

    // Step 2: recommend_model for each category
    const tierConfig = detectTier(32);
    const config = makeConfig();
    const ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      requestTimeout: 10_000,
      heartbeatTimeout: 5_000,
      firstTokenTimeout: 10_000,
    });
    const recCtx: RecommendModelContext = {
      ollamaClient,
      tierConfig,
      config,
      logger: silentLogger,
      ollamaHealthy: false,
    };

    for (const category of categories) {
      const result = await handleRecommendModel({ category }, recCtx);
      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('## Model Recommendation');
      expect(text).toContain(category);
    }
  });

  it('I-MS-07: all existing v0.1.0 tools still work (regression)', async () => {
    const tierConfig = detectTier(32);
    const ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      requestTimeout: 10_000,
      heartbeatTimeout: 5_000,
      firstTokenTimeout: 10_000,
    });

    const responseText = 'hello world';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(createOllamaStreamResponse(responseText, 'qwen2.5-coder:7b')), {
        status: 200,
      }),
    );

    const queue = new FIFOQueue<OllamaTaskPayload, OllamaChatResponse>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 30_000 },
      async (payload) => ollamaClient.chat(payload.request),
    );
    const costCalculator = new CostCalculator(DEFAULT_PRICING, DEFAULT_COMPARISON_MODEL);
    const toolCtx: ToolHandlerContext = {
      ollamaClient,
      queue,
      tierConfig,
      costCalculator,
      logger: silentLogger,
      ollamaHealthy: true,
      maxRequestSizeBytes: 200 * 1024,
    };

    // offload_work without model/category (v0.1.0 behavior)
    const result = await handleOffloadWork({ task: 'write hello world' }, toolCtx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('hello world');
    expect(text).toContain('Model: qwen2.5-coder:7b');

    fetchSpy.mockRestore();
  });
});
