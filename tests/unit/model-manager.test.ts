import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelManager } from '../../src/ollama/model-manager.js';
import { ModelNotFoundError } from '../../src/errors.js';
import type { TierConfig } from '../../src/tiering/config.js';

const TIER1_CONFIG: TierConfig = {
  level: 1,
  name: 'Light',
  primaryModel: 'phi4:latest',
  fallbackModel: 'phi4-mini:latest',
  contextLimit: 4000,
  ramRange: { min: 0, max: 16 },
  timeout: {
    requestTimeout: 60000,
    heartbeatTimeout: 30000,
    firstTokenTimeout: 120000,
  },
};

const TIER2_CONFIG: TierConfig = {
  level: 2,
  name: 'Standard',
  primaryModel: 'qwen2.5-coder:7b',
  fallbackModel: null,
  contextLimit: 12000,
  ramRange: { min: 16, max: 48 },
  timeout: {
    requestTimeout: 90000,
    heartbeatTimeout: 30000,
    firstTokenTimeout: 120000,
  },
};

function createMockClient() {
  return {
    listModels: vi.fn(),
    pullModel: vi.fn(),
    chat: vi.fn(),
    healthCheck: vi.fn(),
    getVersion: vi.fn(),
  };
}

describe('ModelManager', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let manager: ModelManager;

  beforeEach(() => {
    mockClient = createMockClient();
    manager = new ModelManager(mockClient as unknown as import('../../src/ollama/client.js').OllamaClient);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  describe('ensureModelAvailable', () => {
    it('returns primary model when it is already available', async () => {
      mockClient.listModels.mockResolvedValue([
        { name: 'phi4:latest', size: 1000, digest: 'abc', modified_at: '' },
      ]);

      const result = await manager.ensureModelAvailable(TIER1_CONFIG);
      expect(result).toBe('phi4:latest');
      expect(mockClient.pullModel).not.toHaveBeenCalled();
    });

    it('pulls primary model if not available', async () => {
      mockClient.listModels.mockResolvedValue([]);
      mockClient.pullModel.mockResolvedValue(undefined);

      const result = await manager.ensureModelAvailable(TIER1_CONFIG);
      expect(result).toBe('phi4:latest');
      expect(mockClient.pullModel).toHaveBeenCalledWith('phi4:latest');
    });

    it('falls back to fallback model on Tier 1 pull failure', async () => {
      mockClient.listModels.mockResolvedValue([
        { name: 'phi4-mini:latest', size: 500, digest: 'def', modified_at: '' },
      ]);
      mockClient.pullModel.mockRejectedValueOnce(new Error('pull failed'));

      const result = await manager.ensureModelAvailable(TIER1_CONFIG);
      expect(result).toBe('phi4-mini:latest');
    });

    it('pulls fallback model if neither available', async () => {
      mockClient.listModels.mockResolvedValue([]);
      mockClient.pullModel
        .mockRejectedValueOnce(new Error('pull primary failed'))
        .mockResolvedValueOnce(undefined);

      const result = await manager.ensureModelAvailable(TIER1_CONFIG);
      expect(result).toBe('phi4-mini:latest');
      expect(mockClient.pullModel).toHaveBeenCalledTimes(2);
    });

    it('throws ModelNotFoundError when both primary and fallback fail', async () => {
      mockClient.listModels.mockResolvedValue([]);
      mockClient.pullModel
        .mockRejectedValueOnce(new Error('pull primary failed'))
        .mockRejectedValueOnce(new Error('pull fallback failed'));

      await expect(manager.ensureModelAvailable(TIER1_CONFIG)).rejects.toThrow(ModelNotFoundError);
    });

    it('throws when no fallback (Tier 2) and pull fails with ModelNotFoundError', async () => {
      mockClient.listModels.mockResolvedValue([]);
      mockClient.pullModel.mockRejectedValueOnce(
        new ModelNotFoundError('qwen2.5-coder:7b'),
      );

      await expect(manager.ensureModelAvailable(TIER2_CONFIG)).rejects.toThrow(ModelNotFoundError);
    });

    it('wraps non-ModelNotFoundError in ModelNotFoundError (Tier 2)', async () => {
      mockClient.listModels.mockResolvedValue([]);
      mockClient.pullModel.mockRejectedValueOnce(
        new Error('network error'),
      );

      const err = await manager.ensureModelAvailable(TIER2_CONFIG).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ModelNotFoundError);
      expect((err as ModelNotFoundError).message).toContain('qwen2.5-coder:7b');
    });
  });

  describe('isModelAvailable', () => {
    it('returns true when model exists', async () => {
      mockClient.listModels.mockResolvedValue([
        { name: 'phi4:latest', size: 1000, digest: 'abc', modified_at: '' },
      ]);

      expect(await manager.isModelAvailable('phi4:latest')).toBe(true);
    });

    it('returns false when model does not exist', async () => {
      mockClient.listModels.mockResolvedValue([]);

      expect(await manager.isModelAvailable('nonexistent')).toBe(false);
    });
  });

  describe('getModels', () => {
    it('refreshes on first call', async () => {
      mockClient.listModels.mockResolvedValue([
        { name: 'phi4:latest', size: 1000, digest: 'abc', modified_at: '' },
      ]);

      const models = await manager.getModels();
      expect(models).toHaveLength(1);
      expect(mockClient.listModels).toHaveBeenCalledOnce();
    });

    it('uses cache on subsequent calls', async () => {
      mockClient.listModels.mockResolvedValue([]);

      await manager.getModels();
      await manager.getModels();
      expect(mockClient.listModels).toHaveBeenCalledOnce();
    });

    it('refreshModelList clears cache', async () => {
      mockClient.listModels.mockResolvedValue([]);

      await manager.getModels();
      await manager.refreshModelList();
      expect(mockClient.listModels).toHaveBeenCalledTimes(2);
    });
  });
});
