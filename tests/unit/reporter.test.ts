import { describe, it, expect, vi } from 'vitest';
import { reportCost } from '../../src/cost/reporter.js';
import type { CostResult } from '../../src/cost/calculator.js';

describe('reportCost', () => {
  it('writes formatted cost line to stderr', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result: CostResult = {
      savingsUsd: 0.0123,
      cumulativeSavingsUsd: 1.2345,
      inputTokens: 500,
      outputTokens: 200,
      comparisonModel: 'claude-sonnet-4-5',
    };

    reportCost(result, 'offload_work');

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain('[CTS Cost]');
    expect(output).toContain('offload_work');
    expect(output).toContain('$0.0123');
    expect(output).toContain('$1.2345');
    expect(output).toContain('500->200');

    spy.mockRestore();
  });

  it('does not throw on stderr write failure', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {
      throw new Error('I/O error');
    });

    const result: CostResult = {
      savingsUsd: 0,
      cumulativeSavingsUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      comparisonModel: 'claude-sonnet-4-5',
    };

    expect(() => reportCost(result, 'test')).not.toThrow();

    spy.mockRestore();
  });
});
