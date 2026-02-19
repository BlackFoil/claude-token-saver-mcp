import { describe, it, expect } from 'vitest';
import { detectTier, applyConfigOverrides } from '../../src/tiering/detector.js';
import { TIER_DEFINITIONS } from '../../src/tiering/config.js';

describe('detectTier', () => {
  it('T-01: < 16GB -> Tier 1 (Light)', () => {
    const tier = detectTier(8);
    expect(tier.level).toBe(1);
    expect(tier.name).toBe('Light');
    expect(tier.primaryModel).toBe('phi4:latest');
  });

  it('T-02: 16GB -> Tier 2 (Standard)', () => {
    const tier = detectTier(16);
    expect(tier.level).toBe(2);
    expect(tier.name).toBe('Standard');
    expect(tier.primaryModel).toBe('qwen2.5-coder:7b');
  });

  it('T-03: 32GB -> Tier 2', () => {
    const tier = detectTier(32);
    expect(tier.level).toBe(2);
  });

  it('T-04: 48GB -> Tier 3 (Ultra)', () => {
    const tier = detectTier(48);
    expect(tier.level).toBe(3);
    expect(tier.name).toBe('Ultra');
    expect(tier.primaryModel).toBe('qwen2.5-coder:32b');
  });

  it('T-05: 128GB -> Tier 3', () => {
    const tier = detectTier(128);
    expect(tier.level).toBe(3);
  });

  it('T-06: boundary 15.99 -> Tier 1', () => {
    const tier = detectTier(15.99);
    expect(tier.level).toBe(1);
  });

  it('T-07: boundary 47.99 -> Tier 2', () => {
    const tier = detectTier(47.99);
    expect(tier.level).toBe(2);
  });

  it('T-08: throws on NaN', () => {
    expect(() => detectTier(NaN)).toThrow();
  });

  it('T-09: throws on 0', () => {
    expect(() => detectTier(0)).toThrow();
  });

  it('T-10: Tier 1 has fallback model', () => {
    const tier = detectTier(8);
    expect(tier.fallbackModel).toBe('phi4-mini:latest');
  });

  it('T-11: Tier 2 has no fallback', () => {
    const tier = detectTier(32);
    expect(tier.fallbackModel).toBeNull();
  });
});

describe('applyConfigOverrides', () => {
  it('returns base tier when overrides null', () => {
    const base = detectTier(32);
    const result = applyConfigOverrides(base, null);
    expect(result).toEqual(base);
  });

  it('T-10: overrides primaryModel', () => {
    const base = detectTier(32);
    const result = applyConfigOverrides(base, {
      primaryModel: 'custom-model:7b',
      fallbackModel: null,
      contextLimit: 8000,
      timeout: {},
    });
    expect(result.primaryModel).toBe('custom-model:7b');
    expect(result.contextLimit).toBe(8000);
    expect(result.level).toBe(2); // level unchanged
  });

  it('partial overrides keep remaining defaults', () => {
    const base = detectTier(32);
    const result = applyConfigOverrides(base, {
      primaryModel: 'custom:7b',
    });
    expect(result.primaryModel).toBe('custom:7b');
    expect(result.fallbackModel).toBe(base.fallbackModel);
    expect(result.contextLimit).toBe(base.contextLimit);
  });

  it('overrides timeout partially', () => {
    const base = detectTier(32);
    const result = applyConfigOverrides(base, {
      timeout: { requestTimeout: 999 },
    });
    expect(result.timeout.requestTimeout).toBe(999);
    expect(result.timeout.heartbeatTimeout).toBe(base.timeout.heartbeatTimeout);
  });

  it('throws on negative RAM', () => {
    expect(() => detectTier(-1)).toThrow();
  });

  it('applies fallbackModel undefined override correctly', () => {
    const base = detectTier(8); // Tier 1, has fallbackModel
    expect(base.fallbackModel).toBe('phi4-mini:latest');

    const result = applyConfigOverrides(base, {
      fallbackModel: undefined,
    });
    // fallbackModel !== undefined check fails, so keeps base value
    expect(result.fallbackModel).toBe('phi4-mini:latest');
  });

  it('explicitly sets fallbackModel to null via override', () => {
    const base = detectTier(8); // Tier 1, has fallbackModel
    const result = applyConfigOverrides(base, {
      fallbackModel: null,
    });
    expect(result.fallbackModel).toBeNull();
  });
});

describe('TIER_DEFINITIONS', () => {
  it('has 3 tiers', () => {
    expect(TIER_DEFINITIONS).toHaveLength(3);
  });

  it('tiers are sorted by level', () => {
    expect(TIER_DEFINITIONS[0].level).toBe(1);
    expect(TIER_DEFINITIONS[1].level).toBe(2);
    expect(TIER_DEFINITIONS[2].level).toBe(3);
  });
});
