import { describe, it, expect, vi } from 'vitest';
import { FIFOQueue } from '../../src/queue/fifo-queue.js';
import {
  validateOffloadWorkInput,
  validateCompressContextInput,
} from '../../src/validators/input-validator.js';

describe('DoS Protection: Queue Limits', () => {
  it('DOS-01: rejects when queue exceeds max length', async () => {
    const queue = new FIFOQueue<string, string>(
      { maxQueueLength: 1, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5_000 },
      async (item) => {
        await new Promise((r) => setTimeout(r, 500));
        return item;
      },
    );

    // Start processing first item
    const p1 = queue.enqueue('first', 100);
    await new Promise((r) => setTimeout(r, 10));
    // Queue second (fills queue to max=1)
    const p2 = queue.enqueue('second', 100);
    // Third should be rejected (queue full)
    await expect(queue.enqueue('third', 100)).rejects.toThrow();

    await Promise.all([p1, p2]);
  }, 10_000);

  it('DOS-02: rejects oversized request payload', async () => {
    const queue = new FIFOQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 1024, queueTimeoutMs: 5_000 },
      async (item) => item,
    );

    await expect(queue.enqueue('test', 2048)).rejects.toThrow();
  });

  it('DOS-03: queue timeout ejects long-waiting items', async () => {
    const queue = new FIFOQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 30 },
      async (item) => {
        await new Promise((r) => setTimeout(r, 500));
        return item;
      },
    );

    const p1 = queue.enqueue('first', 100);
    await new Promise((r) => setTimeout(r, 5));
    const p2 = queue.enqueue('second', 100);

    await expect(p2).rejects.toThrow();
    await expect(p1).resolves.toBe('first');
  }, 10_000);

  it('DOS-04: rate limiter rejects burst traffic', async () => {
    const rateLimiter = {
      check: vi.fn().mockReturnValue(false),
      getLimitPerMinute: vi.fn().mockReturnValue(10),
    };

    const queue = new FIFOQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5_000 },
      async (item) => item,
      rateLimiter,
    );

    await expect(queue.enqueue('burst', 100)).rejects.toThrow('レートリミット');
  });
});

describe('DoS Protection: Input Size Limits', () => {
  it('DOS-05: rejects offload_work with oversized task', () => {
    const hugeTask = 'a'.repeat(60_000); // exceeds 50000 char limit
    expect(() => validateOffloadWorkInput({ task: hugeTask }, 200 * 1024)).toThrow();
  });

  it('DOS-06: rejects offload_work with oversized context', () => {
    const hugeContext = 'x'.repeat(110_000); // exceeds 100000 char limit
    expect(() =>
      validateOffloadWorkInput({ task: 'small task', context: hugeContext }, 200 * 1024),
    ).toThrow();
  });

  it('DOS-07: rejects compress_context with oversized content', () => {
    const hugeContent = 'y'.repeat(210_000); // exceeds 200000 char limit
    expect(() =>
      validateCompressContextInput({ content: hugeContent }, 200 * 1024, 12_000),
    ).toThrow();
  });

  it('DOS-08: rejects when byte size exceeds maxRequestSizeBytes', () => {
    // Create content that's valid in chars but exceeds byte limit
    const content = 'a'.repeat(1000);
    expect(
      () => validateOffloadWorkInput({ task: content }, 500), // 500 bytes max
    ).toThrow();
  });
});
