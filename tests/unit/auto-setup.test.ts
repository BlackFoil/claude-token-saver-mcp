// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAutoSetup, type AutoSetupContext } from '../../src/tools/auto-setup.js';
import { OllamaClient } from '../../src/ollama/client.js';
import type { AppConfig } from '../../src/config/schema.js';
import type { TierConfig } from '../../src/tiering/config.js';
import pino from 'pino';

// ── Test Helpers ─────────────────────────────────────────────

const silentLogger = pino({ level: 'silent' });

function makeConfig(overrides?: Partial<AppConfig['modelSelector']>): AppConfig {
  return {
    ollama: { baseUrl: 'http://localhost:11434' },
    tier: null,
    timeout: null,
    queue: { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 60_000 },
    cost: { comparisonModel: 'claude-sonnet-4-5' },
    security: { enableInputSanitization: true },
    logLevel: 'info',
    modelSelector: {
      enabled: true,
      preferQuality: false,
      preloadKeepAlive: '-1',
      maxSimultaneousModels: 'auto' as const,
      customRecommendations: {},
      blockedModels: ['codestral'],
      licenseFilter: ['Apache-2.0', 'MIT', 'NVIDIA-Open'],
      ...overrides,
    },
    distributed: { enabled: false, nodes: [], strategy: 'model-affinity', healthCheckIntervalMs: 30_000 },
    persistence: { enabled: true, autoSaveIntervalMs: 300_000 },
    registryUpdater: { enabled: false, updateIntervalMs: 1_800_000 },
  };
}

function makeTierConfig(tier: 1 | 2 | 3): TierConfig {
  const configs: Record<number, TierConfig> = {
    1: {
      level: 1, name: 'Light', primaryModel: 'phi4:latest', fallbackModel: null,
      contextLimit: 4_000, ramRange: { min: 0, max: 16 },
      timeout: { requestTimeout: 60_000, heartbeatTimeout: 30_000, firstTokenTimeout: 120_000 },
    },
    2: {
      level: 2, name: 'Standard', primaryModel: 'qwen2.5-coder:7b', fallbackModel: null,
      contextLimit: 12_000, ramRange: { min: 16, max: 48 },
      timeout: { requestTimeout: 90_000, heartbeatTimeout: 30_000, firstTokenTimeout: 120_000 },
    },
    3: {
      level: 3, name: 'Ultra', primaryModel: 'qwen2.5-coder:32b', fallbackModel: null,
      contextLimit: 32_000, ramRange: { min: 48, max: Infinity },
      timeout: { requestTimeout: 180_000, heartbeatTimeout: 45_000, firstTokenTimeout: 180_000 },
    },
  };
  return configs[tier]!;
}

function makeMockClient() {
  const client = new OllamaClient({
    baseUrl: 'http://localhost:11434',
    requestTimeout: 10_000,
    heartbeatTimeout: 5_000,
    firstTokenTimeout: 10_000,
  });

  vi.spyOn(client, 'healthCheck').mockResolvedValue(true);
  vi.spyOn(client, 'listModelsFull').mockResolvedValue({
    models: [
      { name: 'qwen2.5-coder:7b', size: 5_000_000_000, digest: 'abc123', modified_at: '2026-01-01T00:00:00Z' },
    ],
  });
  vi.spyOn(client, 'listRunning').mockResolvedValue({
    models: [],
  });
  vi.spyOn(client, 'pullModel').mockResolvedValue({
    modelName: 'qwen2.5-coder:7b',
    sizeBytes: 5_000_000_000,
    durationMs: 1_000,
    alreadyUpToDate: false,
  });
  vi.spyOn(client, 'chat').mockResolvedValue({
    text: '',
    inputTokens: 0,
    outputTokens: 0,
    totalDurationMs: 100,
    loadDurationMs: 50,
    model: 'qwen2.5-coder:7b',
  });

  return client;
}

function makeContext(
  tier: 1 | 2 | 3 = 2,
  ollamaHealthy = true,
  configOverrides?: Partial<AppConfig['modelSelector']>,
): AutoSetupContext {
  return {
    ollamaClient: makeMockClient(),
    tierConfig: makeTierConfig(tier),
    config: makeConfig(configOverrides),
    logger: silentLogger,
    ollamaHealthy,
  };
}

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
  return (result.content[0] as { type: 'text'; text: string }).text;
}

// ── Tests ────────────────────────────────────────────────────

describe('handleAutoSetup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic flow', () => {
    it('AS-01: recommends and preloads already-installed model', async () => {
      const ctx = makeContext(2);
      // Model is installed (listModelsFull returns it) but not loaded (listRunning empty)
      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      expect(result.isError).toBeUndefined();
      const text = getText(result);
      expect(text).toContain('## Auto Setup Complete');
      expect(text).toContain('Already installed');
      expect(text).toContain('Preloaded into VRAM');
      expect(text).toContain('qwen2.5-coder:7b');
      // pullModel should NOT have been called (already installed)
      expect(ctx.ollamaClient.pullModel).not.toHaveBeenCalled();
      // chat should have been called for preloading
      expect(ctx.ollamaClient.chat).toHaveBeenCalled();
    });

    it('AS-02: pulls and preloads uninstalled model', async () => {
      const ctx = makeContext(2);
      // Model not installed
      vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValue({
        models: [],
      });
      vi.spyOn(ctx.ollamaClient, 'pullModel').mockResolvedValue({
        modelName: 'qwen2.5-coder:7b',
        sizeBytes: 5_000_000_000,
        durationMs: 30_000,
        alreadyUpToDate: false,
      });

      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      expect(result.isError).toBeUndefined();
      expect(ctx.ollamaClient.pullModel).toHaveBeenCalledWith('qwen2.5-coder:7b');
      const text = getText(result);
      expect(text).toContain('## Auto Setup Complete');
      expect(text).toContain('Pulled from registry');
      expect(text).toContain('4.7 GB downloaded');
      expect(text).toContain('Preloaded into VRAM');
      expect(ctx.ollamaClient.chat).toHaveBeenCalled();
    });

    it('AS-03: skips everything when model already loaded', async () => {
      const ctx = makeContext(2);
      // Model installed AND loaded
      vi.spyOn(ctx.ollamaClient, 'listRunning').mockResolvedValue({
        models: [
          { name: 'qwen2.5-coder:7b', size: 5_000_000_000, size_vram: 5_000_000_000, digest: 'abc', expires_at: '', details: {} },
        ],
      });

      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      expect(result.isError).toBeUndefined();
      const text = getText(result);
      expect(text).toContain('Already installed');
      expect(text).toContain('Already loaded in VRAM');
      expect(ctx.ollamaClient.pullModel).not.toHaveBeenCalled();
      expect(ctx.ollamaClient.chat).not.toHaveBeenCalled();
    });

    it('AS-04: defaults to category "general" when not specified', async () => {
      const ctx = makeContext(2);

      const result = await handleAutoSetup({}, ctx);

      expect(result.isError).toBeUndefined();
      const text = getText(result);
      expect(text).toContain('**Category:** general');
    });
  });

  describe('skip options', () => {
    it('AS-05: skip_pull=true skips download', async () => {
      const ctx = makeContext(2);
      // Model NOT installed
      vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValue({
        models: [],
      });

      const result = await handleAutoSetup(
        { category: 'coding', skip_pull: true },
        ctx,
      );

      expect(ctx.ollamaClient.pullModel).not.toHaveBeenCalled();
      const text = getText(result);
      expect(text).toContain('Skipped pull (skip_pull=true)');
      // Preload also skipped since model is not installed
      expect(text).toContain('Skipped preload (model not installed)');
    });

    it('AS-06: skip_preload=true skips VRAM loading', async () => {
      const ctx = makeContext(2);

      const result = await handleAutoSetup(
        { category: 'coding', skip_preload: true },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      expect(ctx.ollamaClient.chat).not.toHaveBeenCalled();
      const text = getText(result);
      expect(text).toContain('Skipped preload (skip_preload=true)');
      // Model was already installed, so pull is skipped too
      expect(text).toContain('Already installed');
    });
  });

  describe('error handling', () => {
    it('AS-07: returns error when Ollama is not healthy', async () => {
      const ctx = makeContext(2, false);
      vi.spyOn(ctx.ollamaClient, 'healthCheck').mockResolvedValue(false);

      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain('CTS-1001');
      expect(text).toContain('Ollama is not available');
    });

    it('AS-08: handles pull failure gracefully', async () => {
      const ctx = makeContext(2);
      // Model not installed, pull fails
      vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValue({
        models: [],
      });
      vi.spyOn(ctx.ollamaClient, 'pullModel').mockRejectedValue(
        new Error('network error'),
      );

      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      // Should NOT crash — returns partial success with warning
      expect(result.isError).toBeUndefined();
      const text = getText(result);
      expect(text).toContain('## Auto Setup Complete');
      expect(text).toContain('Pull failed');
      expect(text).toContain('network error');
      expect(text).toContain('### Warnings');
      // Preload should be skipped because pull failed
      expect(text).toContain('Skipped preload (pull failed)');
    });

    it('AS-09: handles preload failure gracefully', async () => {
      const ctx = makeContext(2);
      // Model installed, but preload (chat) fails
      vi.spyOn(ctx.ollamaClient, 'chat').mockRejectedValue(
        new Error('VRAM full'),
      );

      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      // Should NOT crash — returns partial success with warning
      expect(result.isError).toBeUndefined();
      const text = getText(result);
      expect(text).toContain('## Auto Setup Complete');
      expect(text).toContain('Preload failed');
      expect(text).toContain('VRAM full');
      expect(text).toContain('### Warnings');
    });

    it('AS-10: returns error for invalid category', async () => {
      const ctx = makeContext(2);

      const result = await handleAutoSetup({ category: 'invalid' }, ctx);

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain('CTS-6001');
      expect(text).toContain('Invalid category');
    });

    it('AS-11: returns error when no recommendations found', async () => {
      const ctx = makeContext(2, true, {
        blockedModels: [
          'qwen2.5-coder', 'deepseek-coder-v2', 'qwen3', 'devstral',
          'phi4', 'phi4-mini', 'gemma3', 'llama3', 'llama3.2',
          'aya-expanse', 'plamo', 'qwen2.5', 'qwen3-coder',
        ],
        licenseFilter: ['Apache-2.0', 'MIT', 'NVIDIA-Open'],
      });

      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain('Auto Setup Failed');
      expect(text).toContain('No models found');
    });

    it('AS-12: handles Ollama recovery during setup', async () => {
      const ctx = makeContext(2, false);
      // Initially unhealthy, but recheck succeeds
      vi.spyOn(ctx.ollamaClient, 'healthCheck').mockResolvedValue(true);

      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      expect(result.isError).toBeUndefined();
      expect(ctx.ollamaClient.healthCheck).toHaveBeenCalled();
      expect(ctx.ollamaHealthy).toBe(true);
      const text = getText(result);
      expect(text).toContain('## Auto Setup Complete');
    });
  });

  describe('quality preference', () => {
    it('AS-13: prefer_quality=true selects larger model', async () => {
      const ctx = makeContext(3);
      // Tier 3 with both models installed — quality preference should sort by VRAM (larger first)
      vi.spyOn(ctx.ollamaClient, 'listModelsFull').mockResolvedValue({
        models: [
          { name: 'qwen2.5-coder:32b', size: 18_500_000_000, digest: 'abc', modified_at: '2026-01-01T00:00:00Z' },
          { name: 'qwen2.5-coder:7b', size: 5_000_000_000, digest: 'def', modified_at: '2026-01-01T00:00:00Z' },
        ],
      });

      const result = await handleAutoSetup(
        { category: 'coding', prefer_quality: true },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      const text = getText(result);
      // With prefer_quality=true on Tier 3, the 32b model should be selected
      expect(text).toContain('qwen2.5-coder:32b');
      expect(text).toContain('**Selected Model:** qwen2.5-coder:32b');
    });
  });

  describe('response format', () => {
    it('AS-14: response includes system info', async () => {
      const ctx = makeContext(2);

      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      expect(result.isError).toBeUndefined();
      const text = getText(result);
      expect(text).toContain('**System:** Tier 2 (Standard)');
      expect(text).toContain('32GB RAM');
      expect(text).toContain('**Category:** coding');
    });

    it('AS-15: response includes usage instructions', async () => {
      const ctx = makeContext(2);

      const result = await handleAutoSetup({ category: 'coding' }, ctx);

      expect(result.isError).toBeUndefined();
      const text = getText(result);
      expect(text).toContain('### Usage');
      expect(text).toContain('offload_work');
      expect(text).toContain('qwen2.5-coder:7b');
    });
  });
});
