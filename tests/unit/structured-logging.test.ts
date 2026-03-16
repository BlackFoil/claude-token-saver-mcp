import { describe, it, expect } from 'vitest';
import { createToolLogContext, createRequestId } from '../../src/logging/structured.js';

describe('Structured Logging (P5-003)', () => {
  describe('createToolLogContext', () => {
    it('creates context with all fields', () => {
      const now = Date.now();
      const err = new Error('something failed');
      (err as Error & { code: string }).code = 'CTS-1001';

      const ctx = createToolLogContext({
        tool: 'offload-work',
        model: 'qwen3:8b',
        category: 'coding',
        startTime: now - 1500,
        response: { inputTokens: 200, outputTokens: 100, totalDurationMs: 2000 },
        savings: 0.05,
        error: err,
      });

      expect(ctx.tool).toBe('offload-work');
      expect(ctx.model).toBe('qwen3:8b');
      expect(ctx.category).toBe('coding');
      expect(ctx.durationMs).toBeGreaterThanOrEqual(1400);
      expect(ctx.durationMs).toBeLessThan(3000);
      expect(ctx.inputTokens).toBe(200);
      expect(ctx.outputTokens).toBe(100);
      expect(ctx.savingsUsd).toBe(0.05);
      expect(ctx.error).toBe('something failed');
      expect(ctx.errorCode).toBe('CTS-1001');
    });

    it('creates context with minimal fields', () => {
      const ctx = createToolLogContext({ tool: 'recommend-model' });

      expect(ctx.tool).toBe('recommend-model');
      expect(ctx.model).toBeUndefined();
      expect(ctx.category).toBeUndefined();
      expect(ctx.durationMs).toBeUndefined();
      expect(ctx.inputTokens).toBeUndefined();
      expect(ctx.outputTokens).toBeUndefined();
      expect(ctx.savingsUsd).toBeUndefined();
      expect(ctx.error).toBeUndefined();
      expect(ctx.errorCode).toBeUndefined();
    });

    it('calculates durationMs from startTime', () => {
      const startTime = Date.now() - 500;
      const ctx = createToolLogContext({ tool: 'test', startTime });

      expect(ctx.durationMs).toBeGreaterThanOrEqual(400);
      expect(ctx.durationMs).toBeLessThan(2000);
    });

    it('uses response totalDurationMs when startTime is not provided', () => {
      const ctx = createToolLogContext({
        tool: 'test',
        response: { inputTokens: 50, outputTokens: 25, totalDurationMs: 1234 },
      });

      expect(ctx.durationMs).toBe(1234);
      expect(ctx.inputTokens).toBe(50);
      expect(ctx.outputTokens).toBe(25);
    });

    it('prefers startTime over response totalDurationMs for durationMs', () => {
      const startTime = Date.now() - 800;
      const ctx = createToolLogContext({
        tool: 'test',
        startTime,
        response: { inputTokens: 50, outputTokens: 25, totalDurationMs: 9999 },
      });

      // Should use startTime-based calculation, not 9999
      expect(ctx.durationMs).toBeGreaterThanOrEqual(700);
      expect(ctx.durationMs).toBeLessThan(5000);
    });

    it('handles error without code property', () => {
      const ctx = createToolLogContext({
        tool: 'test',
        error: new Error('plain error'),
      });

      expect(ctx.error).toBe('plain error');
      expect(ctx.errorCode).toBeUndefined();
    });
  });

  describe('createRequestId', () => {
    it('returns a valid UUID v4 format', () => {
      const id = createRequestId();
      // UUID v4: 8-4-4-4-12 hex digits
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('returns unique IDs on successive calls', () => {
      const ids = new Set(Array.from({ length: 100 }, () => createRequestId()));
      expect(ids.size).toBe(100);
    });
  });
});
