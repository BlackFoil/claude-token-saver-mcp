import { describe, it, expect, vi } from 'vitest';
import { PriorityQueue, Priority } from '../../src/queue/priority-queue.js';

function createTestQueue(
  overrides?: Partial<{ maxQueueLength: number; maxRequestSizeBytes: number; queueTimeoutMs: number }>,
  processor?: (item: string) => Promise<string>,
) {
  return new PriorityQueue<string, string>(
    {
      maxQueueLength: overrides?.maxQueueLength ?? 10,
      maxRequestSizeBytes: overrides?.maxRequestSizeBytes ?? 200 * 1024,
      queueTimeoutMs: overrides?.queueTimeoutMs ?? 5_000,
    },
    processor ?? (async (item) => `processed: ${item}`),
  );
}

describe('PriorityQueue', () => {
  it('PQ-01: enqueue and dequeue basic item', async () => {
    const queue = createTestQueue();
    const result = await queue.enqueue('hello', 100);
    expect(result).toBe('processed: hello');
  });

  it('PQ-02: dequeues by priority (lowest number first)', async () => {
    const order: string[] = [];
    const queue = new PriorityQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5000 },
      async (item) => {
        order.push(item);
        await new Promise((r) => setTimeout(r, 10));
        return item;
      },
    );

    // First item starts processing immediately
    const p1 = queue.enqueue('normal', 100, { priority: Priority.NORMAL });
    // Wait for first to start processing
    await new Promise((r) => setTimeout(r, 2));

    // Now enqueue items with different priorities — they'll be ordered in the queue
    const p3 = queue.enqueue('low', 100, { priority: Priority.LOW });
    const p2 = queue.enqueue('urgent', 100, { priority: Priority.URGENT });
    const p4 = queue.enqueue('high', 100, { priority: Priority.HIGH });

    await Promise.all([p1, p2, p3, p4]);
    expect(order).toEqual(['normal', 'urgent', 'high', 'low']);
  });

  it('PQ-03: FIFO within same priority', async () => {
    const order: string[] = [];
    const queue = new PriorityQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5000 },
      async (item) => {
        order.push(item);
        await new Promise((r) => setTimeout(r, 10));
        return item;
      },
    );

    // First item starts processing
    const p0 = queue.enqueue('start', 100, { priority: Priority.URGENT });
    await new Promise((r) => setTimeout(r, 2));

    // Enqueue multiple items with NORMAL priority
    const p1 = queue.enqueue('first', 100, { priority: Priority.NORMAL });
    const p2 = queue.enqueue('second', 100, { priority: Priority.NORMAL });
    const p3 = queue.enqueue('third', 100, { priority: Priority.NORMAL });

    await Promise.all([p0, p1, p2, p3]);
    // After 'start' processes, the three NORMAL items should be in FIFO order
    expect(order).toEqual(['start', 'first', 'second', 'third']);
  });

  it('PQ-04: queue full error', async () => {
    const queue = createTestQueue(
      { maxQueueLength: 1 },
      async (item) => {
        await new Promise((r) => setTimeout(r, 100));
        return item;
      },
    );

    const p1 = queue.enqueue('first', 100);
    await new Promise((r) => setTimeout(r, 5));
    const p2 = queue.enqueue('second', 100);
    await expect(queue.enqueue('third', 100)).rejects.toThrow();

    await Promise.all([p1, p2]);
  });

  it('PQ-05: rate limiter rejects when exceeded', async () => {
    const rateLimiter = {
      check: vi.fn().mockReturnValue(false),
      getLimitPerMinute: vi.fn().mockReturnValue(5),
    };

    const queue = new PriorityQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5000 },
      async (item) => item,
      rateLimiter,
    );

    await expect(queue.enqueue('test', 100)).rejects.toThrow('レートリミット');
  });

  it('PQ-06: timeout ejects stale item', async () => {
    const queue = new PriorityQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 50 },
      async (item) => {
        await new Promise((r) => setTimeout(r, 500));
        return item;
      },
    );

    const p1 = queue.enqueue('first', 100);
    await new Promise((r) => setTimeout(r, 5));
    const p2 = queue.enqueue('second', 100, { priority: Priority.LOW });

    await expect(p2).rejects.toThrow();
    await expect(p1).resolves.toBe('first');
  }, 10_000);

  it('PQ-07: getStatus returns priority breakdown', async () => {
    const queue = new PriorityQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5000 },
      async (item) => {
        await new Promise((r) => setTimeout(r, 10));
        return item;
      },
    );

    await queue.enqueue('urgent-task', 100, { priority: Priority.URGENT });
    await queue.enqueue('normal-task', 100, { priority: Priority.NORMAL });

    const stats = queue.getStatus();
    expect(stats.totalProcessed).toBe(2);
    expect(stats.currentLength).toBe(0);
    expect(stats.isProcessing).toBe(false);
    expect(stats.byPriority[Priority.URGENT].processed).toBe(1);
    expect(stats.byPriority[Priority.NORMAL].processed).toBe(1);
    expect(stats.byPriority[Priority.HIGH].processed).toBe(0);
    expect(stats.byPriority[Priority.LOW].processed).toBe(0);
  });

  it('PQ-08: getStatus shows pending items by priority', async () => {
    const queue = new PriorityQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5000 },
      async (item) => {
        await new Promise((r) => setTimeout(r, 200));
        return item;
      },
    );

    // Start processing first item
    const p1 = queue.enqueue('first', 100, { priority: Priority.URGENT });
    await new Promise((r) => setTimeout(r, 5));

    // Add items that will be pending
    const p2 = queue.enqueue('high-task', 100, { priority: Priority.HIGH });
    const p3 = queue.enqueue('low-task', 100, { priority: Priority.LOW });

    const stats = queue.getStatus();
    expect(stats.currentLength).toBe(2);
    expect(stats.isProcessing).toBe(true);
    expect(stats.byPriority[Priority.HIGH].pending).toBe(1);
    expect(stats.byPriority[Priority.LOW].pending).toBe(1);

    await Promise.all([p1, p2, p3]);
  });

  it('PQ-09: rejects oversized request', async () => {
    const queue = createTestQueue({ maxRequestSizeBytes: 100 });
    await expect(queue.enqueue('test', 200)).rejects.toThrow();
  });

  it('PQ-10: resolves on success', async () => {
    const queue = createTestQueue(undefined, async () => 'ok');
    const result = await queue.enqueue('test', 100);
    expect(result).toBe('ok');
  });

  it('PQ-11: rejects on processor error', async () => {
    const queue = createTestQueue(undefined, async () => {
      throw new Error('processor fail');
    });
    await expect(queue.enqueue('test', 100)).rejects.toThrow('processor fail');
  });

  it('PQ-12: mixed priorities processed in correct order', async () => {
    const order: string[] = [];
    const queue = new PriorityQueue<string, string>(
      { maxQueueLength: 20, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5000 },
      async (item) => {
        order.push(item);
        await new Promise((r) => setTimeout(r, 5));
        return item;
      },
    );

    // First item starts processing
    const p0 = queue.enqueue('blocker', 100, { priority: Priority.NORMAL });
    await new Promise((r) => setTimeout(r, 2));

    // Enqueue mixed priorities
    const p1 = queue.enqueue('low-1', 100, { priority: Priority.LOW });
    const p2 = queue.enqueue('high-1', 100, { priority: Priority.HIGH });
    const p3 = queue.enqueue('low-2', 100, { priority: Priority.LOW });
    const p4 = queue.enqueue('urgent-1', 100, { priority: Priority.URGENT });
    const p5 = queue.enqueue('normal-1', 100, { priority: Priority.NORMAL });

    await Promise.all([p0, p1, p2, p3, p4, p5]);
    expect(order).toEqual(['blocker', 'urgent-1', 'high-1', 'normal-1', 'low-1', 'low-2']);
  });

  it('PQ-13: defaults to NORMAL priority when not specified', async () => {
    const queue = new PriorityQueue<string, string>(
      { maxQueueLength: 10, maxRequestSizeBytes: 200 * 1024, queueTimeoutMs: 5000 },
      async (item) => item,
    );

    await queue.enqueue('test', 100);
    const stats = queue.getStatus();
    expect(stats.byPriority[Priority.NORMAL].processed).toBe(1);
  });

  it('PQ-14: getStatus averages are 0 when nothing processed', () => {
    const queue = createTestQueue();
    const stats = queue.getStatus();
    expect(stats.averageWaitMs).toBe(0);
    expect(stats.averageProcessingMs).toBe(0);
    expect(stats.totalProcessed).toBe(0);
  });

  it('PQ-15: getStatus averages are calculated after processing', async () => {
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
});
