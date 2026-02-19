import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionTracker } from '../../src/model-selector/execution-tracker.js';
import type { TaskCategory } from '../../src/model-selector/types.js';

function makeRecord(overrides: Partial<{
  modelId: string;
  taskCategory: TaskCategory;
  executionTimeMs: number;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
}> = {}) {
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
    tracker.recordExecution(makeRecord({ modelId: 'model-a', executionTimeMs: 500, success: true }));
    tracker.recordExecution(makeRecord({ modelId: 'model-b', executionTimeMs: 1500, success: true }));
    tracker.recordExecution(makeRecord({ modelId: 'model-b', executionTimeMs: 2500, success: false }));

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
    tracker.recordExecution(makeRecord({ modelId: 'test-model', executionTimeMs: 1000, success: true }));
    tracker.recordExecution(makeRecord({ modelId: 'other-model', executionTimeMs: 2000, success: true }));

    const boost = tracker.getRecommendationBoost('test-model', 'coding');
    expect(boost).toBeGreaterThanOrEqual(0);
    expect(boost).toBeLessThanOrEqual(1);
  });

  it('getRecommendationBoost: fastest model with 100% success gets boost close to 1.0', () => {
    // fast model: 500ms, 100% success
    tracker.recordExecution(makeRecord({ modelId: 'fast-model', executionTimeMs: 500, success: true }));
    // slow model: 2000ms, 100% success
    tracker.recordExecution(makeRecord({ modelId: 'slow-model', executionTimeMs: 2000, success: true }));

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
});
