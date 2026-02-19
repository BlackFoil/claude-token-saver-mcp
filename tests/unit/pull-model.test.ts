import { describe, it, expect, vi } from 'vitest';
import { handlePullModel, type PullModelContext } from '../../src/tools/pull-model.js';
import { OllamaClient } from '../../src/ollama/client.js';
import { ModelNotFoundError, OllamaNotRunningError } from '../../src/errors.js';
import pino from 'pino';

// ── Test Helpers ─────────────────────────────────────────────

const silentLogger = pino({ level: 'silent' });

function makeContext(ollamaHealthy = true): PullModelContext {
  const client = new OllamaClient({
    baseUrl: 'http://localhost:11434',
    requestTimeout: 10_000,
    heartbeatTimeout: 5_000,
    firstTokenTimeout: 10_000,
  });
  return {
    ollamaClient: client,
    logger: silentLogger,
    ollamaHealthy,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('handlePullModel (DMS-020)', () => {
  it('returns error when model param is missing', async () => {
    const ctx = makeContext();
    const result = await handlePullModel({}, ctx);
    expect(result.isError).toBe(true);
  });

  it('returns error when model param is empty string', async () => {
    const ctx = makeContext();
    const result = await handlePullModel({ model: '  ' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('returns error when model param is not a string', async () => {
    const ctx = makeContext();
    const result = await handlePullModel({ model: 42 }, ctx);
    expect(result.isError).toBe(true);
  });

  it('returns error when Ollama is not available', async () => {
    const ctx = makeContext(false);
    vi.spyOn(ctx.ollamaClient, 'healthCheck').mockResolvedValueOnce(false);

    const result = await handlePullModel({ model: 'qwen3:8b' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('CTS-1001');
  });

  it('recovers when Ollama becomes healthy on recheck', async () => {
    const ctx = makeContext(false);
    vi.spyOn(ctx.ollamaClient, 'healthCheck').mockResolvedValueOnce(true);
    vi.spyOn(ctx.ollamaClient, 'pullModel').mockResolvedValueOnce({
      modelName: 'qwen3:8b',
      sizeBytes: 5_000_000_000,
      durationMs: 30_000,
      alreadyUpToDate: false,
    });

    const result = await handlePullModel({ model: 'qwen3:8b' }, ctx);
    expect(result.isError).toBeUndefined();
    expect(ctx.ollamaHealthy).toBe(true);
  });

  it('pulls model successfully and returns size/duration', async () => {
    const ctx = makeContext();
    vi.spyOn(ctx.ollamaClient, 'pullModel').mockResolvedValueOnce({
      modelName: 'qwen3:14b',
      sizeBytes: 8_500_000_000,
      durationMs: 45_000,
      alreadyUpToDate: false,
    });

    const result = await handlePullModel({ model: 'qwen3:14b' }, ctx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('pulled successfully');
    expect(text).toContain('qwen3:14b');
    expect(text).toContain('7.9 GB'); // 8.5B / 1024^3
    expect(text).toContain('45.0s');
    expect(text).toContain('preload_model');
  });

  it('reports already up to date when model is installed', async () => {
    const ctx = makeContext();
    vi.spyOn(ctx.ollamaClient, 'pullModel').mockResolvedValueOnce({
      modelName: 'qwen2.5-coder:7b',
      sizeBytes: 0,
      durationMs: 500,
      alreadyUpToDate: true,
    });

    const result = await handlePullModel({ model: 'qwen2.5-coder:7b' }, ctx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('already up to date');
    expect(text).toContain('no download needed');
  });

  it('returns CTS error when model is not found (404)', async () => {
    const ctx = makeContext();
    vi.spyOn(ctx.ollamaClient, 'pullModel').mockRejectedValueOnce(
      new ModelNotFoundError('Model "nonexistent:latest" not found in registry'),
    );

    const result = await handlePullModel({ model: 'nonexistent:latest' }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('CTS-3001');
    expect(text).toContain('not found');
  });

  it('returns CTS error when Ollama connection fails during pull', async () => {
    const ctx = makeContext();
    vi.spyOn(ctx.ollamaClient, 'pullModel').mockRejectedValueOnce(
      new OllamaNotRunningError('ECONNREFUSED'),
    );

    const result = await handlePullModel({ model: 'qwen3:8b' }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('CTS-1001');
  });

  it('handles unexpected errors gracefully (CTS-0000)', async () => {
    const ctx = makeContext();
    vi.spyOn(ctx.ollamaClient, 'pullModel').mockRejectedValueOnce(
      new TypeError('unexpected error'),
    );

    const result = await handlePullModel({ model: 'qwen3:8b' }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('CTS-0000');
  });
});
