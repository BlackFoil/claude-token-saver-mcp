// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * P1 Integration Tests (R-07)
 *
 * Tests the three P1 integrations:
 * - DMS-029: ExecutionTracker in offload_work / compress_context
 * - DMS-028: BenchmarkStore enrichment in recommendModels
 * - DMS-031: selectQuantization in recommendModels
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOffloadWork } from '../../src/tools/offload-work.js';
import type { ToolHandlerContext } from '../../src/tools/offload-work.js';
import { handleCompressContext } from '../../src/tools/compress-context.js';
import {
  recommendModels,
  formatRecommendationMarkdown,
} from '../../src/model-selector/recommender.js';
import { BenchmarkStore } from '../../src/model-selector/benchmark-db.js';
import type { TierConfig } from '../../src/tiering/config.js';
import type { ExecutionTracker } from '../../src/model-selector/execution-tracker.js';

// ── Shared Fixtures ──────────────────────────────────────────

const TIER_CONFIG: TierConfig = {
  level: 2,
  name: 'Standard',
  primaryModel: 'qwen2.5-coder:7b',
  fallbackModel: null,
  contextLimit: 12_000,
  ramRange: { min: 16, max: 48 },
  timeout: {
    requestTimeout: 90_000,
    heartbeatTimeout: 30_000,
    firstTokenTimeout: 120_000,
  },
};

function createMockExecutionTracker(): ExecutionTracker {
  return {
    recordExecution: vi.fn(),
    getPerformanceMetrics: vi.fn().mockReturnValue([]),
    getRecommendationBoost: vi.fn().mockReturnValue(0),
    getRecordCount: vi.fn().mockReturnValue(0),
    clear: vi.fn(),
    loadFromFile: vi.fn(),
    saveToFile: vi.fn(),
  } as unknown as ExecutionTracker;
}

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
        text: 'mock response text',
        inputTokens: 100,
        outputTokens: 50,
        totalDurationMs: 500,
        loadDurationMs: 100,
        model: 'qwen2.5-coder:7b',
      }),
      getStatus: vi.fn(),
    } as unknown as ToolHandlerContext['queue'],
    tierConfig: TIER_CONFIG,
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
    ...overrides,
  };
}

// ── Group 1: ExecutionTracker integration ────────────────────

describe('ExecutionTracker integration (DMS-029)', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('offload_work success records execution with success:true', async () => {
    const tracker = createMockExecutionTracker();
    const ctx = createMockContext({ executionTracker: tracker });

    await handleOffloadWork({ task: 'write hello world' }, ctx);

    expect(tracker.recordExecution).toHaveBeenCalledTimes(1);
    const call = (tracker.recordExecution as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.success).toBe(true);
    expect(call.modelId).toBe('qwen2.5-coder:7b');
    expect(call.inputTokens).toBe(100);
    expect(call.outputTokens).toBe(50);
    expect(call.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('offload_work failure records execution with success:false', async () => {
    const tracker = createMockExecutionTracker();
    const ctx = createMockContext({
      executionTracker: tracker,
      queue: {
        enqueue: vi.fn().mockRejectedValue(new TypeError('unexpected error')),
        getStatus: vi.fn(),
      } as unknown as ToolHandlerContext['queue'],
    });

    await handleOffloadWork({ task: 'test' }, ctx);

    expect(tracker.recordExecution).toHaveBeenCalledTimes(1);
    const call = (tracker.recordExecution as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.success).toBe(false);
    expect(call.inputTokens).toBe(0);
    expect(call.outputTokens).toBe(0);
  });

  it('compress_context success records execution with taskCategory=summarization', async () => {
    const tracker = createMockExecutionTracker();
    const ctx = createMockContext({ executionTracker: tracker });

    await handleCompressContext(
      { content: 'Some long text to compress for testing purposes here' },
      ctx,
    );

    expect(tracker.recordExecution).toHaveBeenCalledTimes(1);
    const call = (tracker.recordExecution as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.success).toBe(true);
    expect(call.taskCategory).toBe('summarization');
    expect(call.modelId).toBe('qwen2.5-coder:7b');
  });

  it('executionTracker undefined does not break offload_work (backward compat)', async () => {
    const ctx = createMockContext({ executionTracker: undefined });

    const result = await handleOffloadWork({ task: 'write hello world' }, ctx);

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('mock response text');
  });
});

// ── Group 2: BenchmarkStore integration ─────────────────────

describe('BenchmarkStore integration (DMS-028)', () => {
  it('benchmarkStore provided: candidate benchmarks are enriched from store', () => {
    const store = new BenchmarkStore();
    store.updateBenchmarks('qwen2.5-coder:7b', { humanEval: 99.9, sweBench: 55.5 });

    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: [],
      loadedModels: [],
      benchmarkStore: store,
    });

    const qwen7b = output.recommendations.find(
      (r) => r.recommendation.modelId === 'qwen2.5-coder:7b',
    );
    expect(qwen7b).toBeDefined();
    // The store's benchmarks should have been merged in
    expect(qwen7b!.recommendation.benchmarks.humanEval).toBe(99.9);
    expect(qwen7b!.recommendation.benchmarks.sweBench).toBe(55.5);
  });

  it('benchmarkStore not provided: existing behavior (backward compat)', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: [],
      loadedModels: [],
    });

    expect(output.recommendations.length).toBeGreaterThan(0);
    // Registry default for qwen2.5-coder:7b is humanEval: 88.4
    const qwen7b = output.recommendations.find(
      (r) => r.recommendation.modelId === 'qwen2.5-coder:7b',
    );
    expect(qwen7b).toBeDefined();
    expect(qwen7b!.recommendation.benchmarks.humanEval).toBe(88.4);
  });

  it('benchmarkStore has partial data: only matching models get enriched', () => {
    const store = new BenchmarkStore();
    store.updateBenchmarks('nonexistent-model:99b', { humanEval: 100 });

    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: [],
      loadedModels: [],
      benchmarkStore: store,
    });

    // None of the real models should be enriched with nonexistent data
    for (const r of output.recommendations) {
      expect(r.recommendation.benchmarks.humanEval).not.toBe(100);
    }
  });
});

// ── Group 3: Quantization integration ───────────────────────

describe('Quantization integration (DMS-031)', () => {
  it('model with variants gets recommendedQuantization in result', () => {
    // qwen2.5-coder:7b at tier 2 has variants
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: [],
      loadedModels: [],
      availableVramGB: 10,
    });

    const qwen7b = output.recommendations.find(
      (r) => r.recommendation.modelId === 'qwen2.5-coder:7b',
    );
    expect(qwen7b).toBeDefined();
    expect(qwen7b!.recommendedQuantization).toBeDefined();
    expect(typeof qwen7b!.recommendedQuantization).toBe('string');
  });

  it('model without variants has no recommendedQuantization', () => {
    // deepseek-coder-v2:16b has no variants in the registry
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: [],
      loadedModels: [],
      availableVramGB: 20,
    });

    const deepseek = output.recommendations.find(
      (r) => r.recommendation.modelId === 'deepseek-coder-v2:16b',
    );
    expect(deepseek).toBeDefined();
    expect(deepseek!.recommendedQuantization).toBeUndefined();
  });

  it('preferQuality=true selects quality variant', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: [],
      loadedModels: [],
      preferQuality: true,
      availableVramGB: 40, // enough for Q8_0
    });

    const qwen7b = output.recommendations.find(
      (r) => r.recommendation.modelId === 'qwen2.5-coder:7b',
    );
    expect(qwen7b).toBeDefined();
    // Q8_0 has qualityRank=1, should be selected with large VRAM
    expect(qwen7b!.recommendedQuantization).toBe('Q8_0');
  });

  it('preferQuality=false selects speed variant', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: [],
      loadedModels: [],
      preferQuality: false,
      availableVramGB: 40, // enough for all variants
    });

    const qwen7b = output.recommendations.find(
      (r) => r.recommendation.modelId === 'qwen2.5-coder:7b',
    );
    expect(qwen7b).toBeDefined();
    // Q4_K_M has speedRank=1, should be selected
    expect(qwen7b!.recommendedQuantization).toBe('Q4_K_M');
  });

  it('availableVramGB constrains variant selection', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: [],
      loadedModels: [],
      preferQuality: true,
      availableVramGB: 6.0, // fits Q4_K_M (4.5) and Q5_K_M (5.5), not Q8_0 (8.0)
    });

    const qwen7b = output.recommendations.find(
      (r) => r.recommendation.modelId === 'qwen2.5-coder:7b',
    );
    expect(qwen7b).toBeDefined();
    // Q5_K_M has qualityRank=2 and fits within 6GB, Q8_0 (qualityRank=1) does not fit
    expect(qwen7b!.recommendedQuantization).toBe('Q5_K_M');
  });
});

// ── Group 4: Markdown output ────────────────────────────────

describe('formatRecommendationMarkdown quantization display', () => {
  it('recommendedQuantization different from base shows arrow notation in output', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: ['qwen2.5-coder:7b'],
      loadedModels: [],
      preferQuality: true,
      availableVramGB: 40,
    });

    const md = formatRecommendationMarkdown(output, 'coding', 32);

    // qwen2.5-coder:7b base quantization is Q4_K_M, recommended is Q8_0
    // Format: "Q4_K_M → Q8_0"
    expect(md).toContain('Q4_K_M');
    expect(md).toContain('\u2192'); // → character
    expect(md).toContain('Q8_0');
  });

  it('recommendedQuantization same as base does not add arrow notation', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 32,
      installedModels: ['qwen2.5-coder:7b'],
      loadedModels: [],
      preferQuality: false,
      availableVramGB: 40,
    });

    const md = formatRecommendationMarkdown(output, 'coding', 32);

    // With preferQuality=false and plenty of VRAM, Q4_K_M (speedRank=1) is selected
    // which is the same as the base quantization, so no arrow
    expect(md).toContain('Q4_K_M');
    expect(md).not.toContain('\u2192');
  });
});
