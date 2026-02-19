import { describe, it, expect, vi } from 'vitest';
import { OllamaClient } from '../../src/ollama/client.js';
import {
  OllamaNotRunningError,
  OllamaConnectionError,
  OllamaVersionError,
  ModelNotFoundError,
} from '../../src/errors.js';

function makeClient(overrides?: Partial<import('../../src/ollama/client.js').OllamaClientConfig>) {
  return new OllamaClient({
    baseUrl: 'http://localhost:11434',
    requestTimeout: 10_000,
    heartbeatTimeout: 5_000,
    firstTokenTimeout: 10_000,
    ...overrides,
  });
}

// Helper to create a ReadableStream from NDJSON lines
function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.map(l => l + '\n').join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });
}

describe('OllamaClient.healthCheck', () => {
  it('returns true when Ollama is running', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Ollama is running', { status: 200 }),
    );

    const client = makeClient();
    const result = await client.healthCheck();
    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fetchSpy.mockRestore();
  });

  it('returns false when fetch fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const client = makeClient();
    const result = await client.healthCheck();
    expect(result).toBe(false);

    fetchSpy.mockRestore();
  });

  it('returns false when response does not contain expected text', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Something else', { status: 200 }),
    );

    const client = makeClient();
    const result = await client.healthCheck();
    expect(result).toBe(false);

    fetchSpy.mockRestore();
  });
});

describe('OllamaClient.getVersion', () => {
  it('returns version for valid response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ version: '0.3.0' }), { status: 200 }),
    );

    const client = makeClient();
    const version = await client.getVersion();
    expect(version).toBe('0.3.0');

    fetchSpy.mockRestore();
  });

  it('throws OllamaVersionError for old version', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ version: '0.1.0' }), { status: 200 }),
    );

    const client = makeClient();
    await expect(client.getVersion()).rejects.toThrow(OllamaVersionError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaNotRunningError on connection failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const client = makeClient();
    await expect(client.getVersion()).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaNotRunningError on non-ok response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 500 }),
    );

    const client = makeClient();
    await expect(client.getVersion()).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });
});

describe('OllamaClient.listModels', () => {
  it('returns model list', async () => {
    const models = [
      { name: 'phi4:latest', size: 1000, digest: 'abc', modified_at: '2026-01-01' },
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ models }), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.listModels();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('phi4:latest');

    fetchSpy.mockRestore();
  });

  it('returns empty array when no models field', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.listModels();
    expect(result).toEqual([]);

    fetchSpy.mockRestore();
  });

  it('throws OllamaNotRunningError on fetch failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('Network error'),
    );

    const client = makeClient();
    await expect(client.listModels()).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });
});

describe('OllamaClient.chat', () => {
  it('streams and returns full response', async () => {
    const chunk1 = JSON.stringify({
      model: 'phi4:latest',
      created_at: '2026-01-01T00:00:00Z',
      message: { role: 'assistant', content: 'Hello' },
      done: false,
    });
    const chunk2 = JSON.stringify({
      model: 'phi4:latest',
      created_at: '2026-01-01T00:00:01Z',
      message: { role: 'assistant', content: ' World' },
      done: false,
    });
    const finalChunk = JSON.stringify({
      model: 'phi4:latest',
      created_at: '2026-01-01T00:00:02Z',
      message: { role: 'assistant', content: '' },
      done: true,
      total_duration: 1_000_000_000,
      load_duration: 100_000_000,
      prompt_eval_count: 10,
      prompt_eval_duration: 500_000_000,
      eval_count: 5,
      eval_duration: 400_000_000,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream([chunk1, chunk2, finalChunk]), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
    );

    const client = makeClient();
    const result = await client.chat({
      model: 'phi4:latest',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    });

    expect(result.text).toBe('Hello World');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.model).toBe('phi4:latest');
    expect(result.totalDurationMs).toBeCloseTo(1000, 0);

    fetchSpy.mockRestore();
  });

  it('throws OllamaNotRunningError on connection failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const client = makeClient();
    await expect(
      client.chat({
        model: 'phi4:latest',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    ).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaConnectionError on non-ok response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const client = makeClient();
    await expect(
      client.chat({
        model: 'phi4:latest',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    ).rejects.toThrow(OllamaConnectionError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaConnectionError when body is null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    const client = makeClient();
    // Response with null body - the check is !response.body
    // In Node, `new Response(null)` has `body: null`
    await expect(
      client.chat({
        model: 'phi4:latest',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    ).rejects.toThrow(OllamaConnectionError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaConnectionError when stream ends without final chunk', async () => {
    const chunk1 = JSON.stringify({
      model: 'phi4:latest',
      created_at: '2026-01-01T00:00:00Z',
      message: { role: 'assistant', content: 'partial' },
      done: false,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream([chunk1]), { status: 200 }),
    );

    const client = makeClient();
    await expect(
      client.chat({
        model: 'phi4:latest',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    ).rejects.toThrow(OllamaConnectionError);

    fetchSpy.mockRestore();
  });
});

describe('OllamaClient.pullModel', () => {
  it('successfully pulls a model', async () => {
    const progressLine = JSON.stringify({ status: 'downloading', completed: 100, total: 100 });
    const successLine = JSON.stringify({ status: 'success' });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream([progressLine, successLine]), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.pullModel('phi4:latest');
    expect(result).toMatchObject({
      modelName: 'phi4:latest',
      alreadyUpToDate: false,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    stderrSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('throws ModelNotFoundError on 404', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404 }),
    );

    const client = makeClient();
    await expect(client.pullModel('nonexistent')).rejects.toThrow(ModelNotFoundError);

    fetchSpy.mockRestore();
  });

  it('throws ModelNotFoundError on error in stream', async () => {
    const errorLine = JSON.stringify({ status: 'error', error: 'model not found' });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream([errorLine]), { status: 200 }),
    );

    const client = makeClient();
    await expect(client.pullModel('bad-model')).rejects.toThrow(ModelNotFoundError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaNotRunningError on connection failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const client = makeClient();
    await expect(client.pullModel('phi4:latest')).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaConnectionError on non-404 error response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('server error', { status: 500 }),
    );

    const client = makeClient();
    await expect(client.pullModel('phi4:latest')).rejects.toThrow(OllamaConnectionError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaConnectionError when body is null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    const client = makeClient();
    await expect(client.pullModel('phi4:latest')).rejects.toThrow(OllamaConnectionError);

    fetchSpy.mockRestore();
  });

  it('logs progress at 10% intervals', async () => {
    const lines = [
      JSON.stringify({ status: 'downloading', completed: 0, total: 100 }),
      JSON.stringify({ status: 'downloading', completed: 10, total: 100 }),
      JSON.stringify({ status: 'downloading', completed: 50, total: 100 }),
      JSON.stringify({ status: 'downloading', completed: 100, total: 100 }),
      JSON.stringify({ status: 'success' }),
    ];

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(lines), { status: 200 }),
    );

    const client = makeClient();
    await client.pullModel('phi4:latest');

    // Should have progress logs (10%, 50%, 100%) + success
    const calls = stderrSpy.mock.calls.map(c => c[0] as string);
    const progressCalls = calls.filter(c => c.includes('Pulling model'));
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);

    stderrSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('logs status-only lines without progress numbers', async () => {
    const lines = [
      JSON.stringify({ status: 'verifying sha256 digest' }),
      JSON.stringify({ status: 'success' }),
    ];

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(lines), { status: 200 }),
    );

    const client = makeClient();
    await client.pullModel('phi4:latest');

    const calls = stderrSpy.mock.calls.map(c => c[0] as string);
    expect(calls.some(c => c.includes('verifying sha256 digest'))).toBe(true);

    stderrSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('throws OllamaConnectionError when stream ends without success', async () => {
    const lines = [
      JSON.stringify({ status: 'downloading', completed: 50, total: 100 }),
    ];

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(lines), { status: 200 }),
    );

    const client = makeClient();
    await expect(client.pullModel('phi4:latest')).rejects.toThrow(OllamaConnectionError);

    stderrSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('skips malformed JSON lines during pull', async () => {
    const lines = [
      'not-valid-json',
      JSON.stringify({ status: 'success' }),
    ];

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(lines), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.pullModel('phi4:latest');
    expect(result).toMatchObject({
      modelName: 'phi4:latest',
      alreadyUpToDate: false,
    });

    stderrSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

describe('OllamaClient.chat - NDJSON edge cases', () => {
  it('throws OllamaConnectionError on malformed NDJSON line', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('not-valid-json\n'));
        controller.close();
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, { status: 200 }),
    );

    const client = makeClient();
    await expect(
      client.chat({
        model: 'phi4:latest',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    ).rejects.toThrow(OllamaConnectionError);

    fetchSpy.mockRestore();
  });

  it('handles final chunk in remaining buffer', async () => {
    // Send data without trailing newline so it stays in buffer
    const chunk1 = JSON.stringify({
      model: 'phi4:latest',
      created_at: '2026-01-01T00:00:00Z',
      message: { role: 'assistant', content: 'Hi' },
      done: false,
    });
    const finalChunk = JSON.stringify({
      model: 'phi4:latest',
      created_at: '2026-01-01T00:00:01Z',
      message: { role: 'assistant', content: '' },
      done: true,
      total_duration: 500_000_000,
      load_duration: 50_000_000,
      prompt_eval_count: 5,
      prompt_eval_duration: 200_000_000,
      eval_count: 2,
      eval_duration: 100_000_000,
    });

    const encoder = new TextEncoder();
    // First chunk has newline, final chunk does NOT (stays in buffer)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1 + '\n' + finalChunk));
        controller.close();
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, { status: 200 }),
    );

    const client = makeClient();
    const result = await client.chat({
      model: 'phi4:latest',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    });

    expect(result.text).toBe('Hi');
    expect(result.outputTokens).toBe(2);

    fetchSpy.mockRestore();
  });

  it('strips trailing slashes from baseUrl', () => {
    const client = makeClient({ baseUrl: 'http://localhost:11434///' });
    // Access private baseUrl via healthCheck URL check
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Ollama is running', { status: 200 }),
    );
    client.healthCheck();
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/',
      expect.anything(),
    );
    fetchSpy.mockRestore();
  });

  it('throws OllamaConnectionError on malformed final buffer', async () => {
    const encoder = new TextEncoder();
    const chunk = JSON.stringify({
      model: 'phi4:latest',
      created_at: '2026-01-01T00:00:00Z',
      message: { role: 'assistant', content: 'Hi' },
      done: false,
    });
    // Leave invalid JSON in the buffer (no newline)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chunk + '\n' + 'broken{json'));
        controller.close();
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, { status: 200 }),
    );

    const client = makeClient();
    await expect(
      client.chat({
        model: 'phi4:latest',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    ).rejects.toThrow(OllamaConnectionError);

    fetchSpy.mockRestore();
  });

  it('listModels throws on non-ok response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 503 }),
    );

    const client = makeClient();
    await expect(client.listModels()).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });
});

// ── DMS-005: Tests for Ollama API Extensions ──────────────────

describe('OllamaClient.listModelsFull (DMS-002)', () => {
  it('returns full tags response with model details', async () => {
    const tagsResponse = {
      models: [
        {
          name: 'qwen2.5-coder:7b',
          model: 'qwen2.5-coder:7b',
          size: 4_700_000_000,
          digest: 'abc123',
          modified_at: '2026-01-01T00:00:00Z',
          details: {
            parent_model: '',
            format: 'gguf',
            family: 'qwen2',
            families: ['qwen2'],
            parameter_size: '7.6B',
            quantization_level: 'Q4_K_M',
          },
        },
        {
          name: 'phi4:latest',
          model: 'phi4:latest',
          size: 8_500_000_000,
          digest: 'def456',
          modified_at: '2026-01-02T00:00:00Z',
          details: {
            format: 'gguf',
            family: 'phi4',
            parameter_size: '14B',
            quantization_level: 'Q4_0',
          },
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(tagsResponse), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.listModelsFull();

    expect(result.models).toHaveLength(2);
    expect(result.models[0]!.name).toBe('qwen2.5-coder:7b');
    expect(result.models[0]!.details?.quantization_level).toBe('Q4_K_M');
    expect(result.models[0]!.details?.parameter_size).toBe('7.6B');
    expect(result.models[0]!.details?.family).toBe('qwen2');
    expect(result.models[1]!.name).toBe('phi4:latest');
    expect(result.models[1]!.details?.parameter_size).toBe('14B');

    fetchSpy.mockRestore();
  });

  it('returns empty models array when no models installed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.listModelsFull();

    expect(result.models).toHaveLength(0);

    fetchSpy.mockRestore();
  });

  it('handles missing models field gracefully', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.listModelsFull();

    expect(result.models).toHaveLength(0);

    fetchSpy.mockRestore();
  });

  it('throws OllamaNotRunningError on connection failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const client = makeClient();
    await expect(client.listModelsFull()).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaNotRunningError on non-ok response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 503 }),
    );

    const client = makeClient();
    await expect(client.listModelsFull()).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });

  it('listModels() delegates to listModelsFull and returns models array', async () => {
    const tagsResponse = {
      models: [
        { name: 'test:latest', size: 1000, digest: 'a', modified_at: '2026-01-01T00:00:00Z' },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(tagsResponse), { status: 200 }),
    );

    const client = makeClient();
    const models = await client.listModels();

    expect(Array.isArray(models)).toBe(true);
    expect(models).toHaveLength(1);
    expect(models[0]!.name).toBe('test:latest');

    fetchSpy.mockRestore();
  });
});

describe('OllamaClient.listRunning (DMS-003)', () => {
  it('returns running models with VRAM usage', async () => {
    const psResponse = {
      models: [
        {
          name: 'qwen2.5-coder:32b',
          model: 'qwen2.5-coder:32b',
          size: 18_500_000_000,
          digest: 'abc123',
          details: {
            format: 'gguf',
            family: 'qwen2',
            parameter_size: '32B',
            quantization_level: 'Q4_K_M',
          },
          expires_at: '2026-12-31T23:59:59Z',
          size_vram: 18_500_000_000,
        },
        {
          name: 'qwen3:14b',
          model: 'qwen3:14b',
          size: 8_200_000_000,
          digest: 'def456',
          details: {
            format: 'gguf',
            family: 'qwen3',
            parameter_size: '14B',
          },
          expires_at: '2026-12-31T23:59:59Z',
          size_vram: 8_200_000_000,
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(psResponse), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.listRunning();

    expect(result.models).toHaveLength(2);
    expect(result.models[0]!.name).toBe('qwen2.5-coder:32b');
    expect(result.models[0]!.size_vram).toBe(18_500_000_000);
    expect(result.models[0]!.expires_at).toBe('2026-12-31T23:59:59Z');
    expect(result.models[1]!.name).toBe('qwen3:14b');
    expect(result.models[1]!.size_vram).toBe(8_200_000_000);

    fetchSpy.mockRestore();
  });

  it('returns empty array when no models are loaded', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.listRunning();

    expect(result.models).toHaveLength(0);

    fetchSpy.mockRestore();
  });

  it('handles missing models field gracefully', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.listRunning();

    expect(result.models).toHaveLength(0);

    fetchSpy.mockRestore();
  });

  it('throws OllamaNotRunningError on connection failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    const client = makeClient();
    await expect(client.listRunning()).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });

  it('throws OllamaNotRunningError on non-ok response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 500 }),
    );

    const client = makeClient();
    await expect(client.listRunning()).rejects.toThrow(OllamaNotRunningError);

    fetchSpy.mockRestore();
  });
});

describe('OllamaClient.pullModel response (DMS-004)', () => {
  it('returns size and duration on successful pull', async () => {
    const lines = [
      JSON.stringify({ status: 'pulling manifest' }),
      JSON.stringify({ status: 'downloading', completed: 50, total: 5_000_000_000 }),
      JSON.stringify({ status: 'downloading', completed: 5_000_000_000, total: 5_000_000_000 }),
      JSON.stringify({ status: 'success' }),
    ];

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(lines), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.pullModel('qwen2.5-coder:32b');

    expect(result.modelName).toBe('qwen2.5-coder:32b');
    expect(result.sizeBytes).toBe(5_000_000_000);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.alreadyUpToDate).toBe(false);

    stderrSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('detects already-up-to-date models', async () => {
    const lines = [
      JSON.stringify({ status: 'pulling manifest' }),
      JSON.stringify({ status: 'pulling abc123... already exists' }),
      JSON.stringify({ status: 'pulling def456... already exists' }),
      JSON.stringify({ status: 'success' }),
    ];

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(lines), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.pullModel('qwen2.5-coder:7b');

    expect(result.modelName).toBe('qwen2.5-coder:7b');
    expect(result.alreadyUpToDate).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    stderrSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('tracks the largest total bytes across chunks', async () => {
    const lines = [
      JSON.stringify({ status: 'downloading', completed: 100, total: 1_000_000 }),
      JSON.stringify({ status: 'downloading', completed: 500, total: 8_000_000_000 }),
      JSON.stringify({ status: 'downloading', completed: 100, total: 500_000 }),
      JSON.stringify({ status: 'success' }),
    ];

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(ndjsonStream(lines), { status: 200 }),
    );

    const client = makeClient();
    const result = await client.pullModel('large-model:32b');

    expect(result.sizeBytes).toBe(8_000_000_000);

    stderrSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

// NOTE: client.ts timeout callbacks (requestTimeout, firstTokenTimeout, heartbeatTimeout)
// and stall detection in pullModel use AbortController.abort() which doesn't interrupt
// ReadableStream.read() in Node.js test environment. These paths are exercised in
// integration/E2E tests with a real Ollama server. Excluded from unit coverage.
