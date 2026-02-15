import { describe, it, expect } from 'vitest';
import { CostCalculator } from '../../src/cost/calculator.js';
import { loadPricing, DEFAULT_PRICING, DEFAULT_COMPARISON_MODEL } from '../../src/cost/pricing.js';

describe('CostCalculator', () => {
  const pricing = DEFAULT_PRICING;

  it('C-01: throws on invalid comparison model', () => {
    expect(() => new CostCalculator(pricing, 'nonexistent')).toThrow();
  });

  it('C-02: calculates savings for Sonnet', () => {
    const calc = new CostCalculator(pricing, 'claude-sonnet-4-5');
    const result = calc.calculateSavings({
      inputTokens: 1000,
      outputTokens: 500,
      tool: 'offload_work',
    });
    // (1000/1M * 3.0) + (500/1M * 15.0) = 0.003 + 0.0075 = 0.0105
    expect(result.savingsUsd).toBeCloseTo(0.0105, 4);
  });

  it('C-03: calculates savings for Opus', () => {
    const calc = new CostCalculator(pricing, 'claude-opus-4');
    const result = calc.calculateSavings({
      inputTokens: 1000,
      outputTokens: 500,
      tool: 'offload_work',
    });
    // (1000/1M * 15.0) + (500/1M * 75.0) = 0.015 + 0.0375 = 0.0525
    expect(result.savingsUsd).toBeCloseTo(0.0525, 4);
  });

  it('C-04: handles zero tokens', () => {
    const calc = new CostCalculator(pricing, 'claude-sonnet-4-5');
    const result = calc.calculateSavings({
      inputTokens: 0,
      outputTokens: 0,
      tool: 'offload_work',
    });
    expect(result.savingsUsd).toBe(0);
  });

  it('C-05: throws on negative tokens', () => {
    const calc = new CostCalculator(pricing, 'claude-sonnet-4-5');
    expect(() =>
      calc.calculateSavings({
        inputTokens: -1,
        outputTokens: 0,
        tool: 'offload_work',
      }),
    ).toThrow();
  });

  it('C-06: accumulates savings', () => {
    const calc = new CostCalculator(pricing, 'claude-sonnet-4-5');
    calc.calculateSavings({ inputTokens: 1000, outputTokens: 500, tool: 'offload_work' });
    calc.calculateSavings({ inputTokens: 2000, outputTokens: 1000, tool: 'compress_context' });
    const cum = calc.getCumulativeSavings();
    expect(cum.totalRequests).toBe(2);
    expect(cum.totalSavingsUsd).toBeGreaterThan(0);
    expect(cum.byTool.offload_work.requests).toBe(1);
    expect(cum.byTool.compress_context.requests).toBe(1);
  });

  it('C-07: reset clears counters', () => {
    const calc = new CostCalculator(pricing, 'claude-sonnet-4-5');
    calc.calculateSavings({ inputTokens: 1000, outputTokens: 500, tool: 'offload_work' });
    calc.reset();
    const cum = calc.getCumulativeSavings();
    expect(cum.totalRequests).toBe(0);
    expect(cum.totalSavingsUsd).toBe(0);
  });

  it('C-08: restores from history', () => {
    const calc = new CostCalculator(pricing, 'claude-sonnet-4-5');
    calc.restoreFromHistory({
      totalSavingsUsd: 5.0,
      totalRequests: 100,
      totalInputTokens: 500000,
      totalOutputTokens: 250000,
      byTool: {
        offload_work: { requests: 60, savings: 3.0 },
        compress_context: { requests: 40, savings: 2.0 },
      },
      lastUpdated: '2026-01-01T00:00:00Z',
    });
    const cum = calc.getCumulativeSavings();
    expect(cum.totalSavingsUsd).toBe(5.0);
    expect(cum.totalRequests).toBe(100);
  });
});

describe('loadPricing', () => {
  it('P-01: default pricing has positive values', () => {
    for (const model of Object.keys(DEFAULT_PRICING)) {
      expect(DEFAULT_PRICING[model]!.inputPer1MTokens).toBeGreaterThan(0);
      expect(DEFAULT_PRICING[model]!.outputPer1MTokens).toBeGreaterThan(0);
    }
  });

  it('P-02: default model exists in pricing', () => {
    expect(DEFAULT_PRICING[DEFAULT_COMPARISON_MODEL]).toBeDefined();
  });

  it('P-03: returns default when no overrides', () => {
    const result = loadPricing();
    expect(result).toEqual(DEFAULT_PRICING);
  });

  it('P-04: overrides existing model', () => {
    const result = loadPricing({
      'claude-sonnet-4-5': { inputPer1MTokens: 5.0, outputPer1MTokens: 20.0 },
    });
    expect(result['claude-sonnet-4-5']!.inputPer1MTokens).toBe(5.0);
  });

  it('P-05: adds new model', () => {
    const result = loadPricing({
      'gpt-4o': { inputPer1MTokens: 2.5, outputPer1MTokens: 10.0 },
    });
    expect(result['gpt-4o']).toBeDefined();
    expect(result['claude-sonnet-4-5']).toBeDefined(); // preserved
  });

  it('P-06: skips invalid pricing', () => {
    const result = loadPricing({
      'bad-model': { inputPer1MTokens: -1, outputPer1MTokens: 10.0 },
    });
    expect(result['bad-model']).toBeUndefined();
  });
});
