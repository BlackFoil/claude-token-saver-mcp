import { describe, it, expect } from 'vitest';
import { getRecommendations, getFullRegistry } from '../../src/model-selector/registry.js';
import { calculateVramCapacity, canLoadModel } from '../../src/model-selector/vram-calculator.js';
import { recommendModels, formatRecommendationMarkdown } from '../../src/model-selector/recommender.js';
import { TASK_CATEGORIES } from '../../src/model-selector/types.js';
import type { TierLevel } from '../../src/tiering/config.js';

// ── DMS-006: Registry Tests ──────────────────────────────────

describe('Model Registry (DMS-006)', () => {
  it('has recommendations for all categories × all tiers', () => {
    const tiers: TierLevel[] = [1, 2, 3];
    for (const category of TASK_CATEGORIES) {
      for (const tier of tiers) {
        const recs = getRecommendations(category, tier);
        expect(recs.length).toBeGreaterThanOrEqual(1,
          `No recommendations for ${category} tier ${tier}`);
      }
    }
  });

  it('returns recommendations sorted by priority', () => {
    const recs = getRecommendations('coding', 2);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i]!.priority).toBeGreaterThanOrEqual(recs[i - 1]!.priority);
    }
  });

  it('all models have valid license types', () => {
    const validLicenses = new Set(['Apache-2.0', 'MIT', 'NVIDIA-Open', 'Meta-Community', 'PLaMo-Community', 'Other']);
    for (const rec of getFullRegistry()) {
      expect(validLicenses.has(rec.license)).toBe(true,
        `Invalid license ${rec.license} for ${rec.modelId}`);
    }
  });

  it('all models have positive vramRequired', () => {
    for (const rec of getFullRegistry()) {
      expect(rec.vramRequired).toBeGreaterThan(0,
        `vramRequired must be > 0 for ${rec.modelId}`);
    }
  });

  it('all models have at least one benchmark score', () => {
    for (const rec of getFullRegistry()) {
      const hasBenchmark =
        rec.benchmarks.humanEval !== undefined ||
        rec.benchmarks.sweBench !== undefined ||
        rec.benchmarks.japaneseMTBench !== undefined;
      expect(hasBenchmark).toBe(true,
        `No benchmark for ${rec.modelId} in ${rec.category}`);
    }
  });

  it('coding tier 3 first recommendation is qwen2.5-coder:32b', () => {
    const recs = getRecommendations('coding', 3);
    expect(recs[0]!.modelId).toBe('qwen2.5-coder:32b');
  });

  it('japanese-text tier 1 first recommendation is qwen3:8b', () => {
    const recs = getRecommendations('japanese-text', 1);
    expect(recs[0]!.modelId).toBe('qwen3:8b');
  });

  it('general has exactly 1 recommendation per tier', () => {
    for (const tier of [1, 2, 3] as TierLevel[]) {
      const recs = getRecommendations('general', tier);
      expect(recs).toHaveLength(1);
    }
  });
});

// ── DMS-007: VRAM Calculator Tests ───────────────────────────

describe('VRAM Calculator (DMS-007)', () => {
  it('returns 1 model for < 16GB RAM', () => {
    const result = calculateVramCapacity(8);
    expect(result.maxSimultaneousModels).toBe(1);
    expect(result.tier).toBe(1);
    expect(result.estimatedVramGB).toBe(6);
  });

  it('returns 2 models for 16-32GB RAM', () => {
    const result = calculateVramCapacity(24);
    expect(result.maxSimultaneousModels).toBe(2);
    expect(result.tier).toBe(2);
  });

  it('returns 2 models for 32-48GB RAM', () => {
    const result = calculateVramCapacity(40);
    expect(result.maxSimultaneousModels).toBe(2);
    expect(result.tier).toBe(2);
  });

  it('returns 3 models for 48-64GB RAM', () => {
    const result = calculateVramCapacity(56);
    expect(result.maxSimultaneousModels).toBe(3);
    expect(result.tier).toBe(3);
  });

  it('returns 4 models for >= 64GB RAM', () => {
    const result = calculateVramCapacity(96);
    expect(result.maxSimultaneousModels).toBe(4);
    expect(result.tier).toBe(3);
  });

  it('respects maxModelsOverride (numeric)', () => {
    const result = calculateVramCapacity(96, 2);
    expect(result.maxSimultaneousModels).toBe(2);
  });

  it('uses auto when override is "auto"', () => {
    const result = calculateVramCapacity(96, 'auto');
    expect(result.maxSimultaneousModels).toBe(4);
  });

  it('boundary: exactly 16GB returns tier 2', () => {
    const result = calculateVramCapacity(16);
    expect(result.tier).toBe(2);
    expect(result.maxSimultaneousModels).toBe(2);
  });

  it('boundary: exactly 48GB returns tier 3', () => {
    const result = calculateVramCapacity(48);
    expect(result.tier).toBe(3);
    expect(result.maxSimultaneousModels).toBe(3);
  });

  it('canLoadModel returns true when within VRAM budget', () => {
    expect(canLoadModel(5, 5, 32)).toBe(true); // 10 < 24
  });

  it('canLoadModel returns false when exceeding VRAM', () => {
    expect(canLoadModel(20, 15, 32)).toBe(false); // 35 > 24
  });
});

// ── DMS-008: Recommender Engine Tests ────────────────────────

describe('Recommender Engine (DMS-008)', () => {
  it('returns recommendations for coding tier 3', () => {
    const result = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: ['qwen2.5-coder:32b', 'qwen2.5-coder:7b'],
    });

    expect(result.tier).toBe(3);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeLessThanOrEqual(4);
    expect(result.vramFallback).toBe(false);
  });

  it('installed models appear before non-installed', () => {
    const result = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: ['devstral:24b'],
    });

    const installedIdx = result.recommendations.findIndex((r) => r.installed);
    const notInstalledIdx = result.recommendations.findIndex((r) => !r.installed);

    if (installedIdx >= 0 && notInstalledIdx >= 0) {
      expect(installedIdx).toBeLessThan(notInstalledIdx);
    }
  });

  it('preferQuality=true sorts larger models first', () => {
    const result = recommendModels({
      category: 'coding',
      preferQuality: true,
      totalRamGB: 64,
      installedModels: [],
    });

    // Among non-installed, VRAM should be descending
    const vrams = result.recommendations.map((r) => r.recommendation.vramRequired);
    for (let i = 1; i < vrams.length; i++) {
      expect(vrams[i]!).toBeLessThanOrEqual(vrams[i - 1]!);
    }
  });

  it('preferQuality=false keeps priority order (speed-optimized)', () => {
    const result = recommendModels({
      category: 'coding',
      preferQuality: false,
      totalRamGB: 64,
      installedModels: [],
    });

    // All non-installed, so original priority order
    const priorities = result.recommendations.map((r) => r.recommendation.priority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]!).toBeGreaterThanOrEqual(priorities[i - 1]!);
    }
  });

  it('VRAM fallback: single model limit redirects to general', () => {
    const result = recommendModels({
      category: 'coding',
      totalRamGB: 8, // < 16GB = 1 model only
      installedModels: [],
    });

    expect(result.vramFallback).toBe(true);
    // Should recommend general models instead of coding-specific
    expect(result.recommendations[0]!.recommendation.category).toBe('general');
  });

  it('no VRAM fallback for general category even with low RAM', () => {
    const result = recommendModels({
      category: 'general',
      totalRamGB: 8,
      installedModels: [],
    });

    expect(result.vramFallback).toBe(false);
  });

  it('blocked models are excluded', () => {
    const result = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: [],
      blockedModels: ['qwen2.5-coder'],
    });

    for (const r of result.recommendations) {
      expect(r.recommendation.modelId).not.toContain('qwen2.5-coder');
    }
  });

  it('license filter restricts to specified licenses', () => {
    const result = recommendModels({
      category: 'japanese-text',
      totalRamGB: 32,
      installedModels: [],
      licenseFilter: ['Apache-2.0'],
    });

    for (const r of result.recommendations) {
      expect(r.recommendation.license).toBe('Apache-2.0');
    }
  });

  it('returns max 4 recommendations', () => {
    const result = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: [],
    });

    expect(result.recommendations.length).toBeLessThanOrEqual(4);
  });

  it('loaded models appear before installed-but-not-loaded', () => {
    const result = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: ['qwen2.5-coder:32b', 'qwen3-coder:30b'],
      loadedModels: ['qwen3-coder:30b'],
    });

    const loadedIdx = result.recommendations.findIndex((r) => r.loaded);
    const installedNotLoadedIdx = result.recommendations.findIndex(
      (r) => r.installed && !r.loaded,
    );

    if (loadedIdx >= 0 && installedNotLoadedIdx >= 0) {
      expect(loadedIdx).toBeLessThan(installedNotLoadedIdx);
    }
  });

  it('works for all categories', () => {
    for (const category of TASK_CATEGORIES) {
      const result = recommendModels({
        category,
        totalRamGB: 32,
        installedModels: [],
      });
      expect(result.recommendations.length).toBeGreaterThan(0,
        `No results for category ${category}`);
    }
  });

  it('maxSimultaneousModels override is reflected in output', () => {
    const result = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: [],
      maxSimultaneousModels: 2,
    });

    expect(result.maxSimultaneousModels).toBe(2);
  });
});

// ── Markdown Formatter Tests ─────────────────────────────────

describe('formatRecommendationMarkdown', () => {
  it('includes category, tier, and VRAM info', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: ['qwen2.5-coder:32b'],
    });

    const md = formatRecommendationMarkdown(output, 'coding', 64);

    expect(md).toContain('## Model Recommendation');
    expect(md).toContain('coding');
    expect(md).toContain('Tier 3');
    expect(md).toContain('Ultra');
    expect(md).toContain('64GB RAM');
  });

  it('shows ✅ for installed and 📥 for non-installed', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: ['qwen2.5-coder:32b'],
    });

    const md = formatRecommendationMarkdown(output, 'coding', 64);

    expect(md).toContain('✅');
    expect(md).toContain('📥');
  });

  it('shows VRAM fallback note when applicable', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 8,
      installedModels: [],
    });

    const md = formatRecommendationMarkdown(output, 'coding', 8);

    expect(md).toContain('VRAM constraints');
  });

  it('includes license information', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: [],
    });

    const md = formatRecommendationMarkdown(output, 'coding', 64);

    expect(md).toContain('License: Apache-2.0');
  });

  it('shows "No models found" when all are filtered out', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: [],
      blockedModels: ['qwen2.5-coder', 'qwen3-coder', 'devstral'],
      licenseFilter: ['Other'],
    });

    const md = formatRecommendationMarkdown(output, 'coding', 64);
    expect(md).toContain('No models found matching the criteria');
  });

  it('shows [LOADED] for loaded models in markdown', () => {
    const output = recommendModels({
      category: 'coding',
      totalRamGB: 64,
      installedModels: ['qwen2.5-coder:32b'],
      loadedModels: ['qwen2.5-coder:32b'],
    });

    const md = formatRecommendationMarkdown(output, 'coding', 64);
    expect(md).toContain('[LOADED]');
  });

  it('formatBenchmarks shows N/A when no benchmarks available', () => {
    // Build a custom recommendation output where recommendations have no benchmarks
    const output: import('../../src/model-selector/recommender.js').RecommendOutput = {
      recommendations: [{
        recommendation: {
          modelId: 'custom-model',
          displayName: 'Custom Model',
          category: 'coding',
          tier: 3 as TierLevel,
          minRamGB: 0,
          parameterSize: 'unknown',
          quantization: 'Q4_K_M',
          vramRequired: 10,
          license: 'Apache-2.0',
          benchmarks: {},
          ollamaAvailable: true,
          priority: 1,
        },
        installed: false,
        loaded: false,
      }],
      tier: 3 as TierLevel,
      vramFallback: false,
      maxSimultaneousModels: 2,
    };

    const md = formatRecommendationMarkdown(output, 'coding', 64);
    expect(md).toContain('N/A');
  });
});
