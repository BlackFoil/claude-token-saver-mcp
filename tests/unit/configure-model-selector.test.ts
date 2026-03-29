import { describe, it, expect, vi } from 'vitest';
import { handleConfigureModelSelector } from '../../src/tools/configure-model-selector.js';
import type { ConfigureModelSelectorContext } from '../../src/tools/configure-model-selector.js';
import type { AppConfig } from '../../src/config/schema.js';

function createMockContext(
  overrides?: Partial<{
    enabled: boolean;
    blockedModels: string[];
    licenseFilter: string[];
    customRecommendations: Record<string, Record<string, string[]>>;
  }>,
): ConfigureModelSelectorContext {
  return {
    config: {
      ollama: { baseUrl: 'http://127.0.0.1:11434' },
      tier: null,
      timeout: null,
      queue: { maxQueueLength: 10, maxRequestSizeBytes: 204800, queueTimeoutMs: 60000 },
      cost: { comparisonModel: 'claude-sonnet-4-5' },
      security: { enableInputSanitization: true },
      logLevel: 'info',
      modelSelector: {
        enabled: overrides?.enabled ?? true,
        preferQuality: false,
        preloadKeepAlive: '-1',
        maxSimultaneousModels: 'auto' as const,
        customRecommendations: overrides?.customRecommendations ?? {},
        blockedModels: overrides?.blockedModels ?? ['codestral'],
        licenseFilter: overrides?.licenseFilter ?? ['Apache-2.0', 'MIT', 'NVIDIA-Open'],
      },
    } as AppConfig,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as ConfigureModelSelectorContext['logger'],
  };
}

describe('handleConfigureModelSelector (DMS-032)', () => {
  it('get blocked_models returns current blocklist', async () => {
    const ctx = createMockContext({ blockedModels: ['codestral', 'phi-2'] });
    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'get' },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('codestral');
    expect(text).toContain('phi-2');
  });

  it('set blocked_models replaces blocklist', async () => {
    const ctx = createMockContext();
    await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'set', values: ['model-a', 'model-b'] },
      ctx,
    );

    expect(ctx.config.modelSelector.blockedModels).toEqual(['model-a', 'model-b']);
  });

  it('add blocked_models appends to blocklist', async () => {
    const ctx = createMockContext({ blockedModels: ['codestral'] });
    await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'add', values: ['new-blocked'] },
      ctx,
    );

    expect(ctx.config.modelSelector.blockedModels).toContain('codestral');
    expect(ctx.config.modelSelector.blockedModels).toContain('new-blocked');
  });

  it('remove blocked_models removes from blocklist', async () => {
    const ctx = createMockContext({ blockedModels: ['codestral', 'phi-2'] });
    await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'remove', values: ['codestral'] },
      ctx,
    );

    expect(ctx.config.modelSelector.blockedModels).not.toContain('codestral');
    expect(ctx.config.modelSelector.blockedModels).toContain('phi-2');
  });

  it('get license_filter returns current filter', async () => {
    const ctx = createMockContext({ licenseFilter: ['Apache-2.0', 'MIT'] });
    const result = await handleConfigureModelSelector(
      { setting: 'license_filter', action: 'get' },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Apache-2.0');
    expect(text).toContain('MIT');
  });

  it('set license_filter with invalid license type returns error', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'license_filter', action: 'set', values: ['INVALID-LICENSE'] },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('INVALID-LICENSE');
  });

  it('get custom_recommendations returns current config', async () => {
    const ctx = createMockContext({
      customRecommendations: {
        coding: { '2': ['my-model:7b'] },
      },
    });
    const result = await handleConfigureModelSelector(
      { setting: 'custom_recommendations', action: 'get' },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('coding');
    expect(text).toContain('my-model:7b');
  });

  it('set custom_recommendations updates config', async () => {
    const ctx = createMockContext();
    const newConfig = { coding: { '2': ['custom-a', 'custom-b'] } };
    await handleConfigureModelSelector(
      { setting: 'custom_recommendations', action: 'set', custom_config: newConfig },
      ctx,
    );

    expect(ctx.config.modelSelector.customRecommendations).toEqual(newConfig);
  });

  it('invalid setting name returns error', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'nonexistent_setting', action: 'get' },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Invalid setting');
  });

  it('modelSelector disabled returns error', async () => {
    const ctx = createMockContext({ enabled: false });
    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'get' },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('disabled');
  });

  // ── Branch coverage: validation edge cases ──

  it('invalid action name returns error', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'invalid_action' },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Invalid action');
  });

  it('non-string setting returns error', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector({ setting: 123, action: 'get' }, ctx);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Invalid setting');
  });

  it('non-string action returns error', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 42 },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Invalid action');
  });

  it('values must be string array (non-array rejected)', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'set', values: 'not-an-array' },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Must be an array');
  });

  it('values with non-string elements rejected', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'set', values: [1, 2, 3] },
      ctx,
    );

    expect(result.isError).toBe(true);
  });

  it('custom_config must be an object (array rejected)', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'custom_recommendations', action: 'set', custom_config: [1, 2] },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Must be an object');
  });

  it('custom_recommendations with add action returns error (unsupported)', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'custom_recommendations', action: 'add', values: ['model-a'] },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('only supports');
  });

  it('custom_recommendations set without custom_config returns error', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'custom_recommendations', action: 'set' },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('requires custom_config');
  });

  it('blocked_models set action requires non-empty values', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'add' },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('requires non-empty values');
  });

  it('get blocked_models returns "No blocked models" when empty', async () => {
    const ctx = createMockContext({ blockedModels: [] });
    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'get' },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('No blocked models');
  });

  it('get license_filter returns "No license filter" when empty', async () => {
    const ctx = createMockContext({ licenseFilter: [] });
    const result = await handleConfigureModelSelector(
      { setting: 'license_filter', action: 'get' },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('No license filter');
  });

  it('set license_filter with empty array clears filter', async () => {
    const ctx = createMockContext({ licenseFilter: ['MIT'] });
    const result = await handleConfigureModelSelector(
      { setting: 'license_filter', action: 'set', values: [] },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('cleared');
  });

  it('set license_filter with valid values updates filter', async () => {
    const ctx = createMockContext({ licenseFilter: ['MIT'] });
    const result = await handleConfigureModelSelector(
      { setting: 'license_filter', action: 'set', values: ['Apache-2.0', 'MIT'] },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('2 types');
  });

  it('add license_filter appends to filter', async () => {
    const ctx = createMockContext({ licenseFilter: ['MIT'] });
    await handleConfigureModelSelector(
      { setting: 'license_filter', action: 'add', values: ['Apache-2.0'] },
      ctx,
    );

    expect(ctx.config.modelSelector.licenseFilter).toContain('MIT');
    expect(ctx.config.modelSelector.licenseFilter).toContain('Apache-2.0');
  });

  it('remove license_filter removes from filter', async () => {
    const ctx = createMockContext({ licenseFilter: ['MIT', 'Apache-2.0'] });
    await handleConfigureModelSelector(
      { setting: 'license_filter', action: 'remove', values: ['MIT'] },
      ctx,
    );

    expect(ctx.config.modelSelector.licenseFilter).not.toContain('MIT');
    expect(ctx.config.modelSelector.licenseFilter).toContain('Apache-2.0');
  });

  it('get custom_recommendations returns "No custom recommendations" when empty', async () => {
    const ctx = createMockContext({ customRecommendations: {} });
    const result = await handleConfigureModelSelector(
      { setting: 'custom_recommendations', action: 'get' },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('No custom recommendations');
  });

  it('set custom_recommendations with empty object clears', async () => {
    const ctx = createMockContext({
      customRecommendations: { coding: { '2': ['model-a'] } },
    });
    const result = await handleConfigureModelSelector(
      { setting: 'custom_recommendations', action: 'set', custom_config: {} },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('cleared');
  });

  it('set blocked_models without values returns error', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'set' },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('requires values array');
  });

  it('set license_filter without values returns error', async () => {
    const ctx = createMockContext();
    const result = await handleConfigureModelSelector(
      { setting: 'license_filter', action: 'set' },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('requires values array');
  });

  it('non-CTSError in handler returns CTS-0000 error', async () => {
    const ctx = createMockContext();
    // Force a generic error by providing a non-object custom_config that passes validation but fails later
    Object.defineProperty(ctx.config.modelSelector, 'enabled', {
      get() {
        throw new TypeError('unexpected');
      },
    });

    const result = await handleConfigureModelSelector(
      { setting: 'blocked_models', action: 'get' },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('CTS-0000');
  });
});
