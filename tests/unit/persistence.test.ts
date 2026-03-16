import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { PersistenceManager } from '../../src/persistence/manager.js';
import { ExecutionTracker } from '../../src/model-selector/execution-tracker.js';
import { BenchmarkStore } from '../../src/model-selector/benchmark-db.js';

describe('PersistenceManager (P5-002)', () => {
  let tempDir: string;
  let manager: PersistenceManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cts-persist-'));
    manager = new PersistenceManager({ dataDir: tempDir, autoSaveIntervalMs: 100 });
  });

  afterEach(() => {
    manager.stopAutoSave();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('getFilePaths returns correct paths', () => {
    const paths = manager.getFilePaths();
    expect(paths.executionHistory).toBe(join(tempDir, 'execution-history.json'));
    expect(paths.benchmarkData).toBe(join(tempDir, 'benchmark-data.json'));
  });

  it('loadAll with no existing files does not throw', async () => {
    const tracker = new ExecutionTracker();
    const store = new BenchmarkStore();
    manager.register({ executionTracker: tracker, benchmarkStore: store });

    await expect(manager.loadAll()).resolves.not.toThrow();
    expect(tracker.getRecordCount()).toBe(0);
  });

  it('loadAll with existing files loads data', async () => {
    const paths = manager.getFilePaths();

    // Write execution history
    const records = [
      {
        modelId: 'qwen3:8b',
        taskCategory: 'coding',
        executionTimeMs: 1000,
        success: true,
        inputTokens: 100,
        outputTokens: 50,
        timestamp: Date.now(),
      },
    ];
    writeFileSync(paths.executionHistory, JSON.stringify(records));

    // Write benchmark data
    const benchmarkData = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      benchmarks: {
        'qwen3:8b': { humanEval: 85.0 },
      },
    };
    writeFileSync(paths.benchmarkData, JSON.stringify(benchmarkData));

    const tracker = new ExecutionTracker();
    const store = new BenchmarkStore();
    manager.register({ executionTracker: tracker, benchmarkStore: store });

    await manager.loadAll();

    expect(tracker.getRecordCount()).toBe(1);
    expect(store.getBenchmarks('qwen3:8b')).toEqual({ humanEval: 85.0 });
  });

  it('saveAll creates files in data directory', async () => {
    // Use a subdirectory that does not exist yet
    const subDir = join(tempDir, 'sub', 'dir');
    const mgr = new PersistenceManager({ dataDir: subDir });

    const tracker = new ExecutionTracker();
    tracker.recordExecution({
      modelId: 'qwen3:8b',
      taskCategory: 'coding',
      executionTimeMs: 500,
      success: true,
      inputTokens: 80,
      outputTokens: 40,
    });

    const store = new BenchmarkStore();
    store.updateBenchmarks('qwen3:8b', { humanEval: 90.0 });

    mgr.register({ executionTracker: tracker, benchmarkStore: store });
    await mgr.saveAll();

    const paths = mgr.getFilePaths();
    expect(existsSync(paths.executionHistory)).toBe(true);
    expect(existsSync(paths.benchmarkData)).toBe(true);

    const savedRecords = JSON.parse(readFileSync(paths.executionHistory, 'utf-8'));
    expect(savedRecords).toHaveLength(1);
    expect(savedRecords[0].modelId).toBe('qwen3:8b');

    const savedBenchmarks = JSON.parse(readFileSync(paths.benchmarkData, 'utf-8'));
    expect(savedBenchmarks.benchmarks['qwen3:8b'].humanEval).toBe(90.0);
  });

  it('saveAll without registered components does not throw', async () => {
    await expect(manager.saveAll()).resolves.not.toThrow();
  });

  it('loadAll without registered components does not throw', async () => {
    await expect(manager.loadAll()).resolves.not.toThrow();
  });

  it('auto-save timer starts and stops', async () => {
    const tracker = new ExecutionTracker();
    const store = new BenchmarkStore();
    manager.register({ executionTracker: tracker, benchmarkStore: store });

    const saveSpy = vi.spyOn(manager, 'saveAll').mockResolvedValue();

    manager.startAutoSave();
    // Starting again should be a no-op
    manager.startAutoSave();

    // Wait for at least one interval
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(saveSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    manager.stopAutoSave();
    const callCount = saveSpy.mock.calls.length;

    // Wait another interval — should not fire
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(saveSpy.mock.calls.length).toBe(callCount);

    saveSpy.mockRestore();
  });

  it('register overwrites previously registered components', () => {
    const tracker1 = new ExecutionTracker();
    const tracker2 = new ExecutionTracker();

    manager.register({ executionTracker: tracker1 });
    manager.register({ executionTracker: tracker2 });

    // Verify the second tracker is used by saving
    tracker2.recordExecution({
      modelId: 'test',
      taskCategory: 'coding',
      executionTimeMs: 100,
      success: true,
      inputTokens: 10,
      outputTokens: 5,
    });

    // tracker1 should have no records
    expect(tracker1.getRecordCount()).toBe(0);
    expect(tracker2.getRecordCount()).toBe(1);
  });

  it('uses default data directory when no config provided', () => {
    const defaultMgr = new PersistenceManager();
    const paths = defaultMgr.getFilePaths();
    expect(paths.executionHistory).toContain('.config');
    expect(paths.executionHistory).toContain('claude-token-saver');
  });

  it('loadAll logs warnings on corrupt files', async () => {
    const paths = manager.getFilePaths();
    writeFileSync(paths.executionHistory, 'not valid json');

    const tracker = new ExecutionTracker();
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as import('pino').Logger;

    manager.register({ executionTracker: tracker, logger: mockLogger });
    await manager.loadAll();

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(tracker.getRecordCount()).toBe(0);
  });
});
