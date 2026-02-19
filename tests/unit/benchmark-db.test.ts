import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BenchmarkStore } from '../../src/model-selector/benchmark-db.js';
import { getFullRegistry } from '../../src/model-selector/registry.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

describe('BenchmarkStore (DMS-028)', () => {
  let store: BenchmarkStore;

  beforeEach(() => {
    store = new BenchmarkStore();
    vi.restoreAllMocks();
  });

  it('getBenchmarks returns undefined for unknown model', () => {
    expect(store.getBenchmarks('nonexistent-model')).toBeUndefined();
  });

  it('getBenchmarks returns benchmarks for known model', () => {
    store.updateBenchmarks('test-model', { humanEval: 85.0 });
    const result = store.getBenchmarks('test-model');
    expect(result).toEqual({ humanEval: 85.0 });
  });

  it('updateBenchmarks creates new entry', () => {
    store.updateBenchmarks('new-model', { humanEval: 90.0, sweBench: 50.0 });
    expect(store.getBenchmarks('new-model')).toEqual({ humanEval: 90.0, sweBench: 50.0 });
  });

  it('updateBenchmarks merges with existing entry (partial update)', () => {
    store.updateBenchmarks('merge-model', { humanEval: 80.0 });
    store.updateBenchmarks('merge-model', { sweBench: 60.0 });
    expect(store.getBenchmarks('merge-model')).toEqual({ humanEval: 80.0, sweBench: 60.0 });
  });

  it('getAllBenchmarks returns copy of all entries', () => {
    store.updateBenchmarks('model-a', { humanEval: 70.0 });
    store.updateBenchmarks('model-b', { sweBench: 40.0 });

    const all = store.getAllBenchmarks();
    expect(all.size).toBe(2);
    expect(all.get('model-a')).toEqual({ humanEval: 70.0 });
    expect(all.get('model-b')).toEqual({ sweBench: 40.0 });

    // Verify it's a copy (modifying it doesn't affect the store)
    all.delete('model-a');
    expect(store.getBenchmarks('model-a')).toEqual({ humanEval: 70.0 });
  });

  it('getLastUpdated returns undefined before any updates', () => {
    expect(store.getLastUpdated()).toBeUndefined();
  });

  it('getLastUpdated returns Date after update', () => {
    store.updateBenchmarks('model-x', { humanEval: 50.0 });
    const lastUpdated = store.getLastUpdated();
    expect(lastUpdated).toBeInstanceOf(Date);
  });

  it('createFromRegistry creates store from ModelRecommendation array', () => {
    const registry = getFullRegistry();
    const fromRegistry = BenchmarkStore.createFromRegistry([...registry]);
    const all = fromRegistry.getAllBenchmarks();

    // Should have entries for unique model IDs
    expect(all.size).toBeGreaterThan(0);

    // Verify a known model has its benchmarks
    const qwenCoder32b = all.get('qwen2.5-coder:32b');
    expect(qwenCoder32b).toBeDefined();
    expect(qwenCoder32b!.humanEval).toBe(92.7);
  });

  it('loadFromFile silently returns if file does not exist', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(store.loadFromFile('/nonexistent/file.json')).resolves.toBeUndefined();
    expect(store.getAllBenchmarks().size).toBe(0);
  });

  it('loadFromFile logs warning for invalid JSON', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('not valid json{{{');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await store.loadFromFile('/path/to/bad.json');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid JSON'),
    );
    warnSpy.mockRestore();
  });

  it('saveToFile writes correct JSON format', async () => {
    const { writeFile } = await import('node:fs/promises');
    vi.mocked(writeFile).mockResolvedValue(undefined);

    store.updateBenchmarks('save-model', { humanEval: 95.0 });
    await store.saveToFile('/tmp/benchmarks.json');

    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/benchmarks.json',
      expect.any(String),
      'utf-8',
    );

    const writtenData = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string);
    expect(writtenData.version).toBe(1);
    expect(writtenData.lastUpdated).toBeDefined();
    expect(writtenData.benchmarks['save-model']).toEqual({ humanEval: 95.0 });
  });
});
