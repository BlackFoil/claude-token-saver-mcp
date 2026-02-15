import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Must import after any mocks if needed
import { loadConfig, loadCostHistory, saveCostHistory } from '../../src/config/index.js';
import type { CumulativeCost } from '../../src/cost/calculator.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean env overrides
    delete process.env['OLLAMA_BASE_URL'];
    delete process.env['TIER_OVERRIDE'];
    delete process.env['MODEL_OVERRIDE'];
    delete process.env['QUEUE_MAX_SIZE'];
    delete process.env['QUEUE_TIMEOUT_MS'];
    delete process.env['OLLAMA_TIMEOUT_MS'];
    delete process.env['CLOUD_INPUT_PRICE_PER_MTOKEN'];
    delete process.env['CLOUD_OUTPUT_PRICE_PER_MTOKEN'];
    delete process.env['LOG_LEVEL'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads defaults when no config file exists', () => {
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config).toBeDefined();
  });

  it('loads and parses a valid config file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-test-'));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      ollama: { baseUrl: 'http://localhost:12345' },
    }));

    const config = loadConfig(configPath);
    expect(config.ollama.baseUrl).toBe('http://localhost:12345');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deep merges nested objects from config file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-test-'));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      ollama: { baseUrl: 'http://localhost:12345' },
      queue: { maxQueueLength: 20 },
    }));

    const config = loadConfig(configPath);
    expect(config.ollama.baseUrl).toBe('http://localhost:12345');
    expect(config.queue?.maxQueueLength).toBe(20);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to defaults on malformed JSON', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-test-'));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, '{ broken json');

    // Should not throw, should warn and use defaults
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const config = loadConfig(configPath);
    expect(config).toBeDefined();
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('applies OLLAMA_BASE_URL env override', () => {
    process.env['OLLAMA_BASE_URL'] = 'http://remote:11434';
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.ollama.baseUrl).toBe('http://remote:11434');
  });

  it('applies TIER_OVERRIDE env', () => {
    process.env['TIER_OVERRIDE'] = '2';
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.tier?.forceLevel).toBe(2);
  });

  it('ignores invalid TIER_OVERRIDE values', () => {
    process.env['TIER_OVERRIDE'] = '99';
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.tier?.forceLevel).toBeUndefined();
  });

  it('applies MODEL_OVERRIDE env', () => {
    process.env['MODEL_OVERRIDE'] = 'llama3:8b';
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.tier?.primaryModel).toBe('llama3:8b');
  });

  it('applies QUEUE_MAX_SIZE env', () => {
    process.env['QUEUE_MAX_SIZE'] = '50';
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.queue?.maxQueueLength).toBe(50);
  });

  it('applies QUEUE_TIMEOUT_MS env', () => {
    process.env['QUEUE_TIMEOUT_MS'] = '5000';
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.queue?.queueTimeoutMs).toBe(5000);
  });

  it('applies OLLAMA_TIMEOUT_MS env', () => {
    process.env['OLLAMA_TIMEOUT_MS'] = '120000';
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.timeout?.requestTimeout).toBe(120000);
  });

  it('applies CLOUD_INPUT_PRICE and CLOUD_OUTPUT_PRICE env', () => {
    process.env['CLOUD_INPUT_PRICE_PER_MTOKEN'] = '5.0';
    process.env['CLOUD_OUTPUT_PRICE_PER_MTOKEN'] = '20.0';
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.cost?.pricing?.['claude-sonnet-4-5']?.inputPer1MTokens).toBe(5.0);
    expect(config.cost?.pricing?.['claude-sonnet-4-5']?.outputPer1MTokens).toBe(20.0);
  });

  it('applies LOG_LEVEL env', () => {
    process.env['LOG_LEVEL'] = 'debug';
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.logLevel).toBe('debug');
  });

  it('rejects invalid config via Zod schema', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-test-'));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      ollama: { baseUrl: 'not-a-url' },
    }));

    expect(() => loadConfig(configPath)).toThrow();

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('loadCostHistory', () => {
  it('returns null when file does not exist', () => {
    const result = loadCostHistory('/nonexistent/dir');
    expect(result).toBeNull();
  });

  it('loads valid cost history', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-cost-'));
    const data: CumulativeCost = {
      totalSavingsUsd: 1.5,
      totalRequests: 10,
      totalInputTokens: 5000,
      totalOutputTokens: 3000,
      byTool: {
        offload_work: { requests: 7, savings: 1.0 },
        compress_context: { requests: 3, savings: 0.5 },
      },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    writeFileSync(join(tmpDir, 'cost-history.json'), JSON.stringify(data));

    const result = loadCostHistory(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.totalSavingsUsd).toBe(1.5);
    expect(result!.totalRequests).toBe(10);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for invalid data (negative savings)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-cost-'));
    writeFileSync(join(tmpDir, 'cost-history.json'), JSON.stringify({
      totalSavingsUsd: -1,
      totalRequests: 1,
    }));

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = loadCostHistory(tmpDir);
    expect(result).toBeNull();
    stderrSpy.mockRestore();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for malformed JSON', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-cost-'));
    writeFileSync(join(tmpDir, 'cost-history.json'), '{ broken }');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = loadCostHistory(tmpDir);
    expect(result).toBeNull();
    stderrSpy.mockRestore();

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('saveCostHistory', () => {
  it('saves cost history to file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-save-'));
    const data: CumulativeCost = {
      totalSavingsUsd: 2.0,
      totalRequests: 5,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      byTool: {
        offload_work: { requests: 3, savings: 1.5 },
        compress_context: { requests: 2, savings: 0.5 },
      },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };

    saveCostHistory(data, tmpDir);
    const result = loadCostHistory(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.totalSavingsUsd).toBe(2.0);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not throw on write failure', () => {
    // Try to save to a path that can't be written to (file as dir)
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-save-'));
    const blockerPath = join(tmpDir, 'blocker');
    writeFileSync(blockerPath, 'I am a file not a dir');

    const data: CumulativeCost = {
      totalSavingsUsd: 1.0,
      totalRequests: 1,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      byTool: {
        offload_work: { requests: 1, savings: 1.0 },
        compress_context: { requests: 0, savings: 0 },
      },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // blocker/cost-history.json will fail because blocker is a file, not a dir
    expect(() => saveCostHistory(data, join(blockerPath, 'nested'))).not.toThrow();
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates directory if it does not exist', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cts-save-'));
    const nestedDir = join(tmpDir, 'nested', 'dir');

    const data: CumulativeCost = {
      totalSavingsUsd: 0.1,
      totalRequests: 1,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      byTool: {
        offload_work: { requests: 1, savings: 0.1 },
        compress_context: { requests: 0, savings: 0 },
      },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };

    saveCostHistory(data, nestedDir);
    const result = loadCostHistory(nestedDir);
    expect(result).not.toBeNull();
    expect(result!.totalSavingsUsd).toBe(0.1);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
