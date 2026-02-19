import { describe, it, expect, vi } from 'vitest';
import { handleCostDashboard } from '../../src/tools/cost-dashboard.js';
import type { CostDashboardContext } from '../../src/tools/cost-dashboard.js';
import type { CumulativeCost } from '../../src/cost/calculator.js';

function makeSavings(overrides?: Partial<CumulativeCost>): CumulativeCost {
  return {
    totalSavingsUsd: overrides?.totalSavingsUsd ?? 1.2345,
    totalRequests: overrides?.totalRequests ?? 42,
    totalInputTokens: overrides?.totalInputTokens ?? 50000,
    totalOutputTokens: overrides?.totalOutputTokens ?? 10000,
    byTool: overrides?.byTool ?? {
      offload_work: { requests: 30, savings: 0.9 },
      compress_context: { requests: 12, savings: 0.3345 },
    },
    lastUpdated: overrides?.lastUpdated ?? new Date().toISOString(),
  };
}

function createCtx(
  savings: CumulativeCost,
  executionTracker?: CostDashboardContext['executionTracker'],
): CostDashboardContext {
  return {
    costCalculator: {
      getCumulativeSavings: vi.fn().mockReturnValue(savings),
      calculateSavings: vi.fn(),
    } as unknown as CostDashboardContext['costCalculator'],
    executionTracker,
    logger: { debug: vi.fn(), info: vi.fn() } as unknown as CostDashboardContext['logger'],
  };
}

describe('handleCostDashboard (F-08)', () => {
  it('returns savings summary with formatted values', async () => {
    const ctx = createCtx(makeSavings({ totalSavingsUsd: 2.5 }));
    const result = await handleCostDashboard({}, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain('Cost Savings Dashboard');
    expect(text).toContain('$2.5000');
    expect(text).toContain('42');
  });

  it('returns zero stats when no requests', async () => {
    const ctx = createCtx(makeSavings({
      totalSavingsUsd: 0,
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    }));
    const result = await handleCostDashboard({}, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('$0.0000');
    expect(text).toContain('Total Requests:** 0');
  });

  it('shows model usage table when executionTracker has data', async () => {
    const tracker = {
      getPerformanceMetrics: vi.fn().mockImplementation((category: string) => {
        if (category === 'coding') {
          return [
            { modelId: 'qwen3:8b', avgExecutionTimeMs: 1500, successRate: 0.95, usageCount: 20 },
          ];
        }
        return [];
      }),
    } as unknown as CostDashboardContext['executionTracker'];

    const ctx = createCtx(makeSavings(), tracker);
    const result = await handleCostDashboard({}, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('Model Usage Statistics');
    expect(text).toContain('qwen3:8b');
    expect(text).toContain('coding');
    expect(text).toContain('1.5s');
    expect(text).toContain('95.0%');
  });

  it('shows "No execution history" without executionTracker', async () => {
    const ctx = createCtx(makeSavings());
    const result = await handleCostDashboard({}, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('No execution history');
  });

  it('shows "No execution history" when tracker returns no metrics', async () => {
    const tracker = {
      getPerformanceMetrics: vi.fn().mockReturnValue([]),
    } as unknown as CostDashboardContext['executionTracker'];

    const ctx = createCtx(makeSavings(), tracker);
    const result = await handleCostDashboard({}, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('No execution history');
  });

  it('includes table headers with correct columns', async () => {
    const tracker = {
      getPerformanceMetrics: vi.fn().mockImplementation((category: string) => {
        if (category === 'coding') {
          return [{ modelId: 'test', avgExecutionTimeMs: 100, successRate: 1, usageCount: 1 }];
        }
        return [];
      }),
    } as unknown as CostDashboardContext['executionTracker'];

    const ctx = createCtx(makeSavings(), tracker);
    const result = await handleCostDashboard({}, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('| Model | Category | Requests | Avg Time | Success Rate |');
  });

  it('aggregates metrics from multiple categories', async () => {
    const tracker = {
      getPerformanceMetrics: vi.fn().mockImplementation((category: string) => {
        if (category === 'coding') {
          return [{ modelId: 'model-a', avgExecutionTimeMs: 500, successRate: 1, usageCount: 5 }];
        }
        if (category === 'summarization') {
          return [{ modelId: 'model-b', avgExecutionTimeMs: 800, successRate: 0.8, usageCount: 3 }];
        }
        return [];
      }),
    } as unknown as CostDashboardContext['executionTracker'];

    const ctx = createCtx(makeSavings(), tracker);
    const result = await handleCostDashboard({}, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('model-a');
    expect(text).toContain('model-b');
    expect(text).toContain('coding');
    expect(text).toContain('summarization');
  });

  it('includes input/output token counts in summary', async () => {
    const ctx = createCtx(makeSavings({
      totalInputTokens: 99999,
      totalOutputTokens: 12345,
    }));
    const result = await handleCostDashboard({}, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('99999 input');
    expect(text).toContain('12345 output');
  });
});
