import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionTracker } from '../../src/model-selector/execution-tracker.js';
import type { TaskCategory } from '../../src/model-selector/types.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

function makeRecord(
  overrides: Partial<{
    modelId: string;
    taskCategory: TaskCategory;
    executionTimeMs: number;
    success: boolean;
    inputTokens: number;
    outputTokens: number;
  }> = {},
) {
  return {
    modelId: overrides.modelId ?? 'qwen3:8b',
    taskCategory: overrides.taskCategory ?? 'coding',
    executionTimeMs: overrides.executionTimeMs ?? 1000,
    success: overrides.success ?? true,
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
  };
}

describe('ExecutionTracker (DMS-029)', () => {
  let tracker: ExecutionTracker;

  beforeEach(() => {
    tracker = new ExecutionTracker();
  });

  it('recordExecution adds record with timestamp', () => {
    tracker.recordExecution(makeRecord());
    expect(tracker.getRecordCount()).toBe(1);

    // Verify timestamp was added (check via metrics)
    const metrics = tracker.getPerformanceMetrics('coding');
    expect(metrics.length).toBe(1);
    expect(metrics[0]!.usageCount).toBe(1);
  });

  it('getRecordCount returns correct count', () => {
    expect(tracker.getRecordCount()).toBe(0);
    tracker.recordExecution(makeRecord());
    expect(tracker.getRecordCount()).toBe(1);
    tracker.recordExecution(makeRecord());
    expect(tracker.getRecordCount()).toBe(2);
  });

  it('circular buffer: oldest record removed when maxRecords exceeded', () => {
    const smallTracker = new ExecutionTracker(3);

    smallTracker.recordExecution(makeRecord({ modelId: 'model-1' }));
    smallTracker.recordExecution(makeRecord({ modelId: 'model-2' }));
    smallTracker.recordExecution(makeRecord({ modelId: 'model-3' }));
    expect(smallTracker.getRecordCount()).toBe(3);

    // Adding 4th should remove model-1
    smallTracker.recordExecution(makeRecord({ modelId: 'model-4' }));
    expect(smallTracker.getRecordCount()).toBe(3);

    // model-1 should be gone, model-4 should exist
    const metrics = smallTracker.getPerformanceMetrics('coding');
    const modelIds = metrics.map((m) => m.modelId);
    expect(modelIds).not.toContain('model-1');
    expect(modelIds).toContain('model-4');
  });

  it('getPerformanceMetrics returns empty array for unknown category', () => {
    tracker.recordExecution(makeRecord({ taskCategory: 'coding' }));
    const metrics = tracker.getPerformanceMetrics('japanese-text');
    expect(metrics).toEqual([]);
  });

  it('getPerformanceMetrics aggregates correctly for single model', () => {
    tracker.recordExecution(makeRecord({ executionTimeMs: 1000, success: true }));
    tracker.recordExecution(makeRecord({ executionTimeMs: 2000, success: false }));

    const metrics = tracker.getPerformanceMetrics('coding');
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.modelId).toBe('qwen3:8b');
    expect(metrics[0]!.avgExecutionTimeMs).toBe(1500);
    expect(metrics[0]!.successRate).toBe(0.5);
    expect(metrics[0]!.usageCount).toBe(2);
  });

  it('getPerformanceMetrics aggregates correctly for multiple models', () => {
    tracker.recordExecution(
      makeRecord({ modelId: 'model-a', executionTimeMs: 500, success: true }),
    );
    tracker.recordExecution(
      makeRecord({ modelId: 'model-b', executionTimeMs: 1500, success: true }),
    );
    tracker.recordExecution(
      makeRecord({ modelId: 'model-b', executionTimeMs: 2500, success: false }),
    );

    const metrics = tracker.getPerformanceMetrics('coding');
    expect(metrics).toHaveLength(2);

    const modelA = metrics.find((m) => m.modelId === 'model-a')!;
    expect(modelA.avgExecutionTimeMs).toBe(500);
    expect(modelA.successRate).toBe(1);
    expect(modelA.usageCount).toBe(1);

    const modelB = metrics.find((m) => m.modelId === 'model-b')!;
    expect(modelB.avgExecutionTimeMs).toBe(2000);
    expect(modelB.successRate).toBe(0.5);
    expect(modelB.usageCount).toBe(2);
  });

  it('getPerformanceMetrics sorts by successRate descending', () => {
    // model-a: 100% success
    tracker.recordExecution(makeRecord({ modelId: 'model-a', success: true }));
    // model-b: 0% success
    tracker.recordExecution(makeRecord({ modelId: 'model-b', success: false }));
    // model-c: 50% success
    tracker.recordExecution(makeRecord({ modelId: 'model-c', success: true }));
    tracker.recordExecution(makeRecord({ modelId: 'model-c', success: false }));

    const metrics = tracker.getPerformanceMetrics('coding');
    expect(metrics[0]!.modelId).toBe('model-a');
    expect(metrics[0]!.successRate).toBe(1);
    expect(metrics[1]!.modelId).toBe('model-c');
    expect(metrics[1]!.successRate).toBe(0.5);
    expect(metrics[2]!.modelId).toBe('model-b');
    expect(metrics[2]!.successRate).toBe(0);
  });

  it('getRecommendationBoost returns 0 for unknown model', () => {
    tracker.recordExecution(makeRecord({ modelId: 'known-model' }));
    expect(tracker.getRecommendationBoost('unknown-model', 'coding')).toBe(0);
  });

  it('getRecommendationBoost returns 0 for empty records', () => {
    expect(tracker.getRecommendationBoost('any-model', 'coding')).toBe(0);
  });

  it('getRecommendationBoost returns value between 0 and 1 for known model', () => {
    tracker.recordExecution(
      makeRecord({ modelId: 'test-model', executionTimeMs: 1000, success: true }),
    );
    tracker.recordExecution(
      makeRecord({ modelId: 'other-model', executionTimeMs: 2000, success: true }),
    );

    const boost = tracker.getRecommendationBoost('test-model', 'coding');
    expect(boost).toBeGreaterThanOrEqual(0);
    expect(boost).toBeLessThanOrEqual(1);
  });

  it('getRecommendationBoost: fastest model with 100% success gets boost close to 1.0', () => {
    // fast model: 500ms, 100% success
    tracker.recordExecution(
      makeRecord({ modelId: 'fast-model', executionTimeMs: 500, success: true }),
    );
    // slow model: 2000ms, 100% success
    tracker.recordExecution(
      makeRecord({ modelId: 'slow-model', executionTimeMs: 2000, success: true }),
    );

    const boost = tracker.getRecommendationBoost('fast-model', 'coding');
    // fast model is 4x faster than slow model: successRate(1.0) * (slowestAvg/modelAvg) = 1.0 * (2000/500) = 4.0, capped at 1.0
    expect(boost).toBe(1);
  });

  it('clear removes all records', () => {
    tracker.recordExecution(makeRecord());
    tracker.recordExecution(makeRecord());
    expect(tracker.getRecordCount()).toBe(2);

    tracker.clear();
    expect(tracker.getRecordCount()).toBe(0);
    expect(tracker.getPerformanceMetrics('coding')).toEqual([]);
  });

  it('maxRecords enforces minimum of 1', () => {
    const smallTracker = new ExecutionTracker(0);
    smallTracker.recordExecution(makeRecord());
    expect(smallTracker.getRecordCount()).toBe(1);
    // Adding another should keep only 1
    smallTracker.recordExecution(makeRecord({ modelId: 'model-b' }));
    expect(smallTracker.getRecordCount()).toBe(1);
  });

  // ── File I/O tests ──

  it('loadFromFile loads records from JSON array', async () => {
    const { readFile } = await import('node:fs/promises');
    const records = [
      {
        modelId: 'model-a',
        taskCategory: 'coding',
        executionTimeMs: 1000,
        success: true,
        inputTokens: 100,
        outputTokens: 50,
        timestamp: Date.now(),
      },
      {
        modelId: 'model-b',
        taskCategory: 'coding',
        executionTimeMs: 2000,
        success: false,
        inputTokens: 200,
        outputTokens: 100,
        timestamp: Date.now(),
      },
    ];
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(records));

    await tracker.loadFromFile('/tmp/records.json');

    expect(tracker.getRecordCount()).toBe(2);
    const metrics = tracker.getPerformanceMetrics('coding');
    expect(metrics).toHaveLength(2);
  });

  it('loadFromFile throws on non-array JSON', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ not: 'array' }));

    await expect(tracker.loadFromFile('/tmp/bad.json')).rejects.toThrow('Expected JSON array');
  });

  it('loadFromFile enforces maxRecords by keeping newest', async () => {
    const smallTracker = new ExecutionTracker(2);
    const { readFile } = await import('node:fs/promises');
    const records = [
      {
        modelId: 'old',
        taskCategory: 'coding',
        executionTimeMs: 1000,
        success: true,
        inputTokens: 100,
        outputTokens: 50,
        timestamp: 1,
      },
      {
        modelId: 'mid',
        taskCategory: 'coding',
        executionTimeMs: 1000,
        success: true,
        inputTokens: 100,
        outputTokens: 50,
        timestamp: 2,
      },
      {
        modelId: 'new',
        taskCategory: 'coding',
        executionTimeMs: 1000,
        success: true,
        inputTokens: 100,
        outputTokens: 50,
        timestamp: 3,
      },
    ];
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(records));

    await smallTracker.loadFromFile('/tmp/records.json');

    expect(smallTracker.getRecordCount()).toBe(2);
    // Should have mid and new, not old
    const metrics = smallTracker.getPerformanceMetrics('coding');
    const modelIds = metrics.map((m) => m.modelId);
    expect(modelIds).toContain('new');
    expect(modelIds).toContain('mid');
    expect(modelIds).not.toContain('old');
  });

  it('saveToFile writes records as JSON array', async () => {
    const { writeFile } = await import('node:fs/promises');
    vi.mocked(writeFile).mockResolvedValue(undefined);

    tracker.recordExecution(makeRecord());
    tracker.recordExecution(makeRecord({ modelId: 'model-b' }));

    await tracker.saveToFile('/tmp/records.json');

    expect(writeFile).toHaveBeenCalledWith('/tmp/records.json', expect.any(String), 'utf-8');

    const writtenData = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string);
    expect(Array.isArray(writtenData)).toBe(true);
    expect(writtenData).toHaveLength(2);
  });

  it('getRecommendationBoost returns 0 when slowest avgTime is 0', () => {
    // All records with 0ms execution time
    tracker.recordExecution(makeRecord({ executionTimeMs: 0 }));
    const boost = tracker.getRecommendationBoost('qwen3:8b', 'coding');
    expect(boost).toBe(0);
  });

  it('getRecommendationBoost returns 0 when target model has 0ms but others are non-zero', () => {
    // Target model with 0ms, another model with positive time
    // This triggers normalizedTime <= 0 branch
    tracker.recordExecution(makeRecord({ modelId: 'qwen3:8b', executionTimeMs: 0 }));
    tracker.recordExecution(makeRecord({ modelId: 'phi4:latest', executionTimeMs: 500 }));
    const boost = tracker.getRecommendationBoost('qwen3:8b', 'coding');
    expect(boost).toBe(0);
  });
});
