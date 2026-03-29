import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RegistryUpdater,
  parseParamBillions,
  estimateTier,
  estimateVram,
  MODEL_FAMILY_PATTERNS,
} from '../../src/model-selector/registry-updater.js';
import type { OllamaClient, OllamaModelInfo } from '../../src/ollama/client.js';
import type { Logger } from 'pino';

// ── Helpers ───────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function makeModel(
  name: string,
  sizeBytes = 4 * 1024 ** 3, // 4 GB
  parameterSize = '7B',
  quantization = 'Q4_K_M',
): OllamaModelInfo {
  return {
    name,
    size: sizeBytes,
    digest: 'sha256:abc123',
    modified_at: '2026-01-01T00:00:00Z',
    details: {
      parameter_size: parameterSize,
      quantization_level: quantization,
      family: 'test',
    },
  };
}

function makeMockClient(models: OllamaModelInfo[] = []): OllamaClient {
  return {
    listModels: vi.fn().mockResolvedValue(models),
    listModelsFull: vi.fn().mockResolvedValue({ models }),
    healthCheck: vi.fn().mockResolvedValue(true),
    listRunning: vi.fn().mockResolvedValue({ models: [] }),
    chat: vi.fn(),
    getVersion: vi.fn(),
    pullModel: vi.fn(),
  } as unknown as OllamaClient;
}

// ── Tests ─────────────────────────────────────────────────────

describe('parseParamBillions', () => {
  it('parses "7B" as 7', () => {
    expect(parseParamBillions('7B')).toBe(7);
  });

  it('parses "0.5B" as 0.5', () => {
    expect(parseParamBillions('0.5B')).toBe(0.5);
  });

  it('parses "32b" (lowercase) as 32', () => {
    expect(parseParamBillions('32b')).toBe(32);
  });

  it('returns NaN for undefined', () => {
    expect(parseParamBillions(undefined)).toBeNaN();
  });

  it('returns NaN for unparseable string', () => {
    expect(parseParamBillions('unknown')).toBeNaN();
  });
});

describe('estimateTier', () => {
  it('returns tier 1 for <= 8B', () => {
    expect(estimateTier(3)).toBe(1);
    expect(estimateTier(7)).toBe(1);
    expect(estimateTier(8)).toBe(1);
  });

  it('returns tier 2 for 9B-16B', () => {
    expect(estimateTier(9)).toBe(2);
    expect(estimateTier(14)).toBe(2);
    expect(estimateTier(16)).toBe(2);
  });

  it('returns tier 3 for > 16B', () => {
    expect(estimateTier(32)).toBe(3);
    expect(estimateTier(70)).toBe(3);
  });

  it('returns tier 1 for NaN', () => {
    expect(estimateTier(NaN)).toBe(1);
  });
});

describe('estimateVram', () => {
  it('estimates VRAM from file size', () => {
    // 4 GB file → 4 * 1.2 = 4.8 GB VRAM
    const result = estimateVram(4 * 1024 ** 3);
    expect(result).toBe(4.8);
  });

  it('returns 0 for zero-size file', () => {
    expect(estimateVram(0)).toBe(0);
  });
});

describe('MODEL_FAMILY_PATTERNS', () => {
  it('matches qwen coder models to coding', () => {
    const pat = MODEL_FAMILY_PATTERNS.find((p) => p.pattern.test('qwen2.5-coder:7b'));
    expect(pat).toBeDefined();
    expect(pat!.category).toBe('coding');
  });

  it('matches deepseek-coder to coding', () => {
    const pat = MODEL_FAMILY_PATTERNS.find((p) => p.pattern.test('deepseek-coder-v2:16b'));
    expect(pat).toBeDefined();
    expect(pat!.category).toBe('coding');
  });

  it('matches codellama to coding', () => {
    const pat = MODEL_FAMILY_PATTERNS.find((p) => p.pattern.test('codellama:7b'));
    expect(pat).toBeDefined();
    expect(pat!.category).toBe('coding');
  });

  it('matches devstral to coding-agent', () => {
    const pat = MODEL_FAMILY_PATTERNS.find((p) => p.pattern.test('devstral:24b'));
    expect(pat).toBeDefined();
    expect(pat!.category).toBe('coding-agent');
  });

  it('matches qwen3 (non-coder) to general', () => {
    const pat = MODEL_FAMILY_PATTERNS.find((p) => p.pattern.test('qwen3:8b'));
    expect(pat).toBeDefined();
    expect(pat!.category).toBe('general');
  });

  it('matches gemma to general', () => {
    const pat = MODEL_FAMILY_PATTERNS.find((p) => p.pattern.test('gemma3:4b'));
    expect(pat).toBeDefined();
    expect(pat!.category).toBe('general');
  });

  it('matches phi to general', () => {
    const pat = MODEL_FAMILY_PATTERNS.find((p) => p.pattern.test('phi4:14b'));
    expect(pat).toBeDefined();
    expect(pat!.category).toBe('general');
  });

  it('matches llama to general', () => {
    const pat = MODEL_FAMILY_PATTERNS.find((p) => p.pattern.test('llama3.3:70b'));
    expect(pat).toBeDefined();
    expect(pat!.category).toBe('general');
  });
});

describe('RegistryUpdater.classifyModel', () => {
  let updater: RegistryUpdater;
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
    updater = new RegistryUpdater(makeMockClient(), logger);
  });

  it('classifies qwen2.5-coder as coding with correct tier', () => {
    const model = makeModel('qwen2.5-coder:7b', 4 * 1024 ** 3, '7B');
    const result = updater.classifyModel(model);

    expect(result).not.toBeNull();
    expect(result!.category).toBe('coding');
    expect(result!.tier).toBe(1); // 7B → tier 1
    expect(result!.priority).toBe(99);
    expect(result!.license).toBe('Apache-2.0');
    expect(result!.ollamaAvailable).toBe(true);
  });

  it('classifies large model as higher tier', () => {
    const model = makeModel('qwen2.5-coder:32b', 18 * 1024 ** 3, '32B');
    const result = updater.classifyModel(model);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe(3); // 32B → tier 3
  });

  it('classifies devstral as coding-agent', () => {
    const model = makeModel('devstral:24b', 14 * 1024 ** 3, '24B');
    const result = updater.classifyModel(model);

    expect(result).not.toBeNull();
    expect(result!.category).toBe('coding-agent');
  });

  it('returns null for unrecognized model', () => {
    const model = makeModel('totally-unknown-model:1b', 1024 ** 3, '1B');
    const result = updater.classifyModel(model);

    expect(result).toBeNull();
  });

  it('handles missing details gracefully', () => {
    const model: OllamaModelInfo = {
      name: 'gemma:2b',
      size: 2 * 1024 ** 3,
      digest: 'sha256:xyz',
      modified_at: '2026-01-01T00:00:00Z',
    };
    const result = updater.classifyModel(model);

    expect(result).not.toBeNull();
    expect(result!.category).toBe('general');
    expect(result!.tier).toBe(1); // NaN params → tier 1
    expect(result!.parameterSize).toBe('unknown');
    expect(result!.quantization).toBe('unknown');
  });
});

describe('RegistryUpdater.update', () => {
  let logger: Logger;

  it('discovers new models not in static registry', async () => {
    const models = [
      makeModel('phi4-mini:3.8b', 2.5 * 1024 ** 3, '3.8B'),
      makeModel('llama3.3:8b', 4.5 * 1024 ** 3, '8B'),
    ];
    const client = makeMockClient(models);
    logger = makeLogger();
    const updater = new RegistryUpdater(client, logger, { enabled: true });

    const discovered = await updater.update();

    expect(discovered).toHaveLength(2);
    expect(discovered[0].modelId).toBe('phi4-mini:3.8b');
    expect(discovered[1].modelId).toBe('llama3.3:8b');
  });

  it('does not re-discover models on second update', async () => {
    const models = [makeModel('phi4:14b', 8 * 1024 ** 3, '14B')];
    const client = makeMockClient(models);
    logger = makeLogger();
    const updater = new RegistryUpdater(client, logger, { enabled: true });

    const first = await updater.update();
    expect(first).toHaveLength(1);

    const second = await updater.update();
    expect(second).toHaveLength(0);
  });

  it('skips unrecognized models', async () => {
    const models = [makeModel('totally-unknown:1b', 1024 ** 3, '1B')];
    const client = makeMockClient(models);
    logger = makeLogger();
    const updater = new RegistryUpdater(client, logger, { enabled: true });

    const discovered = await updater.update();
    expect(discovered).toHaveLength(0);
  });

  it('returns empty array when listModels fails', async () => {
    const client = makeMockClient();
    (client.listModels as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connection refused'),
    );
    logger = makeLogger();
    const updater = new RegistryUpdater(client, logger, { enabled: true });

    const discovered = await updater.update();
    expect(discovered).toHaveLength(0);
  });
});

describe('RegistryUpdater.getDiscoveredModels', () => {
  it('returns all discovered models', async () => {
    const models = [
      makeModel('phi4:14b', 8 * 1024 ** 3, '14B'),
      makeModel('gemma3:2b', 2 * 1024 ** 3, '2B'),
    ];
    const client = makeMockClient(models);
    const logger = makeLogger();
    const updater = new RegistryUpdater(client, logger, { enabled: true });

    await updater.update();
    const discovered = updater.getDiscoveredModels();
    expect(discovered).toHaveLength(2);
    expect(discovered.map((d) => d.modelId)).toContain('phi4:14b');
    expect(discovered.map((d) => d.modelId)).toContain('gemma3:2b');
  });

  it('returns empty when no models discovered', () => {
    const logger = makeLogger();
    const updater = new RegistryUpdater(makeMockClient(), logger);
    expect(updater.getDiscoveredModels()).toHaveLength(0);
  });
});

describe('RegistryUpdater.start/stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts periodic updates and can be stopped', async () => {
    const models = [makeModel('phi4:14b', 8 * 1024 ** 3, '14B')];
    const client = makeMockClient(models);
    const logger = makeLogger();
    const updater = new RegistryUpdater(client, logger, {
      enabled: true,
      updateIntervalMs: 1000,
    });

    updater.start();

    // Initial call happens immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(client.listModels).toHaveBeenCalledTimes(1);

    // Advance to trigger interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.listModels).toHaveBeenCalledTimes(2);

    updater.stop();

    // After stop, no more calls
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.listModels).toHaveBeenCalledTimes(2);
  });

  it('does nothing when disabled', () => {
    const client = makeMockClient();
    const logger = makeLogger();
    const updater = new RegistryUpdater(client, logger, { enabled: false });

    updater.start();
    expect(client.listModels).not.toHaveBeenCalled();
    updater.stop(); // no-op
  });

  it('does not start twice', async () => {
    const client = makeMockClient();
    const logger = makeLogger();
    const updater = new RegistryUpdater(client, logger, {
      enabled: true,
      updateIntervalMs: 10_000,
    });

    updater.start();
    updater.start(); // second call should be no-op

    await vi.advanceTimersByTimeAsync(0);
    // Only one initial call
    expect(client.listModels).toHaveBeenCalledTimes(1);

    updater.stop();
  });
});
