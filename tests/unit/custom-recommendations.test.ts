import { describe, it, expect } from 'vitest';
import { recommendModels } from '../../src/model-selector/recommender.js';
import type { RecommendInput } from '../../src/model-selector/recommender.js';

const baseInput: RecommendInput = {
  category: 'coding',
  totalRamGB: 32, // Tier 2
  installedModels: [],
  loadedModels: [],
  blockedModels: [],
  licenseFilter: [],
};

describe('Custom Recommendations (DMS-030)', () => {
  it('custom recommendations override registry when matching category+tier', () => {
    const result = recommendModels({
      ...baseInput,
      customRecommendations: {
        coding: { '2': ['my-custom-model:7b'] },
      },
    });

    // Custom model should appear in results
    const customModel = result.recommendations.find(
      (r) => r.recommendation.modelId === 'my-custom-model:7b',
    );
    expect(customModel).toBeDefined();
  });

  it('custom models appear before registry models in results', () => {
    const result = recommendModels({
      ...baseInput,
      customRecommendations: {
        coding: { '2': ['my-custom-model:7b'] },
      },
    });

    // All models not installed, so order is: custom first, then registry
    // (since none are installed/loaded, the sort by installed status preserves insertion order)
    const firstModel = result.recommendations[0]!;
    expect(firstModel.recommendation.modelId).toBe('my-custom-model:7b');
  });

  it('custom model with known registry entry gets registry benchmarks/license', () => {
    // Use a model that exists in the registry
    const result = recommendModels({
      ...baseInput,
      customRecommendations: {
        coding: { '2': ['qwen2.5-coder:7b'] },
      },
    });

    const customModel = result.recommendations.find(
      (r) => r.recommendation.modelId === 'qwen2.5-coder:7b',
    );
    expect(customModel).toBeDefined();
    expect(customModel!.recommendation.license).toBe('Apache-2.0');
    expect(customModel!.recommendation.benchmarks.humanEval).toBeDefined();
  });

  it('custom model not in registry gets default values', () => {
    const result = recommendModels({
      ...baseInput,
      customRecommendations: {
        coding: { '2': ['totally-unknown-model:3b'] },
      },
    });

    const unknownModel = result.recommendations.find(
      (r) => r.recommendation.modelId === 'totally-unknown-model:3b',
    );
    expect(unknownModel).toBeDefined();
    expect(unknownModel!.recommendation.license).toBe('Other');
    expect(unknownModel!.recommendation.benchmarks).toEqual({});
  });

  it('blocked model filter applies to custom models too', () => {
    const result = recommendModels({
      ...baseInput,
      blockedModels: ['custom-blocked-model'],
      customRecommendations: {
        coding: { '2': ['custom-blocked-model'] },
      },
    });

    const blockedModel = result.recommendations.find(
      (r) => r.recommendation.modelId === 'custom-blocked-model',
    );
    expect(blockedModel).toBeUndefined();
  });

  it('license filter applies to custom models too', () => {
    const result = recommendModels({
      ...baseInput,
      licenseFilter: ['Apache-2.0'],
      customRecommendations: {
        coding: { '2': ['unknown-model-with-other-license:7b'] },
      },
    });

    // Unknown model gets license 'Other', which doesn't match 'Apache-2.0'
    const customModel = result.recommendations.find(
      (r) => r.recommendation.modelId === 'unknown-model-with-other-license:7b',
    );
    expect(customModel).toBeUndefined();
  });

  it('partial override: only specified category+tier uses custom, others use registry', () => {
    // Custom only for coding tier 2
    const codingResult = recommendModels({
      ...baseInput,
      category: 'coding',
      customRecommendations: {
        coding: { '2': ['my-custom-coder:7b'] },
      },
    });
    const hasCustom = codingResult.recommendations.some(
      (r) => r.recommendation.modelId === 'my-custom-coder:7b',
    );
    expect(hasCustom).toBe(true);

    // japanese-text should use only registry models (no custom for this category)
    const japaneseResult = recommendModels({
      ...baseInput,
      category: 'japanese-text',
      customRecommendations: {
        coding: { '2': ['my-custom-coder:7b'] },
      },
    });
    const hasCustomInJapanese = japaneseResult.recommendations.some(
      (r) => r.recommendation.modelId === 'my-custom-coder:7b',
    );
    expect(hasCustomInJapanese).toBe(false);
    expect(japaneseResult.recommendations.length).toBeGreaterThan(0);
  });

  it('empty customRecommendations = existing behavior (backward compatible)', () => {
    const withEmpty = recommendModels({
      ...baseInput,
      customRecommendations: {},
    });
    const withoutCustom = recommendModels({
      ...baseInput,
    });

    // Same results since no custom overrides
    expect(withEmpty.recommendations.map((r) => r.recommendation.modelId)).toEqual(
      withoutCustom.recommendations.map((r) => r.recommendation.modelId),
    );
  });
});
