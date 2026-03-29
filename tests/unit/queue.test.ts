import { describe, it, expect, vi } from 'vitest';
import { FIFOQueue } from '../../src/queue/fifo-queue.js';

function createTestQueue(
  overrides?: Partial<{
    maxQueueLength: number;
    maxRequestSizeBytes: number;
    queueTimeoutMs: number;
  }>,
  processor?: (item: string) => Promise<string>,
) {
  return new FIFOQueue<string, string>(
    {
      maxQueueLength: overrides?.maxQueueLength ?? 10,
      maxRequestSizeBytes: overrides?.maxRequestSizeBytes ?? 200 * 1024,
      queueTimeoutMs: overrides?.queueTimeoutMs ?? 5_000,
    },
    processor ?? (async (item) => `processed: ${item}`),
  );
}

describe('FIFOQueue', () => {
  it('Q-01: enqueue and dequeue', async () => {
    const queue = createTestQueue();
    const result = await queue.enqueue('hello', 100);
    expect(result).toBe('processed: hello');
  });

  it('Q-02: FIFO order', async () => {
    const order: string[] = [];
    const queue = new FIFOQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5000 },
      async (item) => {
        order.push(item);
        await new Promise((r) => setTimeout(r, 10));
        return item;
      },
    );

    const p1 = queue.enqueue('first', 100);
    const p2 = queue.enqueue('second', 100);
    const p3 = queue.enqueue('third', 100);

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('Q-04: queue full error', async () => {
    const queue = createTestQueue({ maxQueueLength: 1 }, async (item) => {
      await new Promise((r) => setTimeout(r, 100));
      return item;
    });

    // First enqueue starts processing
    const p1 = queue.enqueue('first', 100);
    // Wait for processing to start
    await new Promise((r) => setTimeout(r, 5));
    // Second goes into queue
    const p2 = queue.enqueue('second', 100);
    // Third should fail (queue length = 1)
    await expect(queue.enqueue('third', 100)).rejects.toThrow();

    await Promise.all([p1, p2]);
  });

  it('Q-06: getStatus returns correct info', async () => {
    const queue = createTestQueue();
    await queue.enqueue('test', 100);
    const stats = queue.getStatus();
    expect(stats.totalProcessed).toBe(1);
    expect(stats.currentLength).toBe(0);
    expect(stats.isProcessing).toBe(false);
  });

  it('Q-07: resolves on success', async () => {
    const queue = createTestQueue(undefined, async () => 'ok');
    const result = await queue.enqueue('test', 100);
    expect(result).toBe('ok');
  });

  it('Q-08: rejects on error', async () => {
    const queue = createTestQueue(undefined, async () => {
      throw new Error('fail');
    });
    await expect(queue.enqueue('test', 100)).rejects.toThrow('fail');
  });

  it('Q-11: rejects oversized request', async () => {
    const queue = createTestQueue({ maxRequestSizeBytes: 100 });
    await expect(queue.enqueue('test', 200)).rejects.toThrow();
  });

  it('Q-12: queue timeout ejects stale item', async () => {
    const queue = new FIFOQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 50 },
      async (item) => {
        // This processor takes much longer than timeout
        await new Promise((r) => setTimeout(r, 500));
        return item;
      },
    );

    // First item starts processing (takes 500ms)
    const p1 = queue.enqueue('first', 100);
    // Wait for first to start processing
    await new Promise((r) => setTimeout(r, 5));
    // Second item goes into queue but will timeout at 50ms
    const p2 = queue.enqueue('second', 100);

    await expect(p2).rejects.toThrow();
    // First item should still complete
    await expect(p1).resolves.toBe('first');
  }, 10_000);

  it('Q-13: getStatus averages are calculated after processing', async () => {
    const queue = createTestQueue(undefined, async (item) => {
      await new Promise((r) => setTimeout(r, 10));
      return `done:${item}`;
    });

    await queue.enqueue('a', 100);
    await queue.enqueue('b', 100);

    const stats = queue.getStatus();
    expect(stats.totalProcessed).toBe(2);
    expect(stats.averageProcessingMs).toBeGreaterThan(0);
    expect(stats.averageWaitMs).toBeGreaterThanOrEqual(0);
  });

  it('Q-14: getStatus averages are 0 when nothing processed', () => {
    const queue = createTestQueue();
    const stats = queue.getStatus();
    expect(stats.averageWaitMs).toBe(0);
    expect(stats.averageProcessingMs).toBe(0);
    expect(stats.totalProcessed).toBe(0);
  });

  it('Q-15: rate limiter rejects when exceeded', async () => {
    const rateLimiter = {
      check: vi.fn().mockReturnValue(false),
      getLimitPerMinute: vi.fn().mockReturnValue(5),
    };

    const queue = new FIFOQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5000 },
      async (item) => item,
      rateLimiter,
    );

    await expect(queue.enqueue('test', 100)).rejects.toThrow('レートリミット');
  });
});
