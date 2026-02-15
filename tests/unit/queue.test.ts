import { describe, it, expect, vi } from 'vitest';
import { FIFOQueue } from '../../src/queue/fifo-queue.js';

function createTestQueue(
  overrides?: Partial<{ maxQueueLength: number; maxRequestSizeBytes: number; queueTimeoutMs: number }>,
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
    const queue = createTestQueue(
      { maxQueueLength: 1 },
      async (item) => {
        await new Promise((r) => setTimeout(r, 100));
        return item;
      },
    );

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
});
