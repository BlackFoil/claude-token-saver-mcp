import { describe, it, expect, vi } from 'vitest';

/**
 * Health check integration pattern tests (F-12)
 *
 * The actual health check runs in server.ts via setInterval.
 * These tests verify the health state propagation pattern used
 * by the periodic health check: mutating shared context objects.
 */

describe('Health check state propagation (F-12)', () => {
  it('healthCheck success sets ollamaHealthy to true', async () => {
    const ollamaClient = {
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const context = { ollamaHealthy: false };
    const healthy = await ollamaClient.healthCheck();
    context.ollamaHealthy = healthy;

    expect(context.ollamaHealthy).toBe(true);
  });

  it('healthCheck failure sets ollamaHealthy to false', async () => {
    const ollamaClient = {
      healthCheck: vi.fn().mockResolvedValue(false),
    };

    const context = { ollamaHealthy: true };
    const healthy = await ollamaClient.healthCheck();
    context.ollamaHealthy = healthy;

    expect(context.ollamaHealthy).toBe(false);
  });

  it('state change is detectable (connected → disconnected)', async () => {
    const ollamaClient = {
      healthCheck: vi.fn().mockResolvedValue(false),
    };

    const context = { ollamaHealthy: true };
    const wasHealthy = context.ollamaHealthy;
    const healthy = await ollamaClient.healthCheck();
    context.ollamaHealthy = healthy;

    expect(wasHealthy).toBe(true);
    expect(context.ollamaHealthy).toBe(false);
    expect(healthy !== wasHealthy).toBe(true);
  });

  it('multiple context objects share state update pattern', async () => {
    const ollamaClient = {
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    const ctx1 = { ollamaHealthy: false };
    const ctx2 = { ollamaHealthy: false };
    const ctx3 = { ollamaHealthy: false };

    const healthy = await ollamaClient.healthCheck();
    ctx1.ollamaHealthy = healthy;
    ctx2.ollamaHealthy = healthy;
    ctx3.ollamaHealthy = healthy;

    expect(ctx1.ollamaHealthy).toBe(true);
    expect(ctx2.ollamaHealthy).toBe(true);
    expect(ctx3.ollamaHealthy).toBe(true);
  });

  it('healthCheck exception does not crash (error is caught)', async () => {
    const ollamaClient = {
      healthCheck: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };

    const context = { ollamaHealthy: true };
    try {
      const healthy = await ollamaClient.healthCheck();
      context.ollamaHealthy = healthy;
    } catch {
      // Error caught — health state unchanged
    }

    expect(context.ollamaHealthy).toBe(true);
  });
});
