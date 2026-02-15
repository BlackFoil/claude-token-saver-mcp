import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appConfigSchema } from '../../src/config/schema.js';

describe('appConfigSchema', () => {
  it('CS-01: validates with all defaults', () => {
    const result = appConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ollama.baseUrl).toBe('http://127.0.0.1:11434');
      expect(result.data.queue.maxQueueLength).toBe(10);
      expect(result.data.logLevel).toBe('info');
    }
  });

  it('CS-02: rejects invalid URL', () => {
    const result = appConfigSchema.safeParse({
      ollama: { baseUrl: 'not-a-url' },
    });
    expect(result.success).toBe(false);
  });

  it('CS-03: rejects invalid tier number', () => {
    const result = appConfigSchema.safeParse({
      tier: { forceLevel: 4 },
    });
    expect(result.success).toBe(false);
  });

  it('CS-04: rejects timeout below minimum', () => {
    const result = appConfigSchema.safeParse({
      timeout: { requestTimeout: 1000 },
    });
    expect(result.success).toBe(false);
  });

  it('CS-05: rejects pricing above limit', () => {
    const result = appConfigSchema.safeParse({
      cost: {
        pricing: {
          'test-model': { inputPer1MTokens: 2000, outputPer1MTokens: 10 },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid full config', () => {
    const result = appConfigSchema.safeParse({
      ollama: { baseUrl: 'http://localhost:11434' },
      tier: { forceLevel: 2, primaryModel: 'custom:7b' },
      timeout: { requestTimeout: 30000 },
      queue: { maxQueueLength: 5, maxRequestSizeBytes: 100000, queueTimeoutMs: 30000 },
      cost: { comparisonModel: 'claude-sonnet-4-5' },
      security: { enableInputSanitization: true },
      logLevel: 'debug',
    });
    expect(result.success).toBe(true);
  });
});
