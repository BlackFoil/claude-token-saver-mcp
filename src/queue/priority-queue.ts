// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';
import { QueueFullError, RateLimitError } from '../errors.js';
import type { RateLimiter } from './fifo-queue.js';

export enum Priority {
  URGENT = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

export interface PriorityQueueConfig {
  maxQueueLength: number;
  maxRequestSizeBytes: number;
  queueTimeoutMs: number;
}

export interface PriorityQueueStats {
  currentLength: number;
  isProcessing: boolean;
  totalProcessed: number;
  totalRejected: number;
  averageWaitMs: number;
  averageProcessingMs: number;
  byPriority: Record<Priority, { pending: number; processed: number }>;
}

interface PriorityQueueItem<T> {
  id: string;
  payload: T;
  priority: Priority;
  enqueuedAt: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  _timer: ReturnType<typeof setTimeout>;
}

interface PriorityInternalStats {
  totalProcessed: number;
  totalRejected: number;
  totalWaitMs: number;
  totalProcessingMs: number;
  processedByPriority: Record<Priority, number>;
}

/**
 * Promise-based priority queue with concurrency=1, max queue length, and rate limiting.
 *
 * Items are dequeued by priority (lowest number first), then FIFO within the same priority.
 */
export class PriorityQueue<T, R> {
  private queue: PriorityQueueItem<T>[] = [];
  private isProcessingFlag = false;
  private readonly config: PriorityQueueConfig;
  private readonly processor: (item: T) => Promise<R>;
  private readonly rateLimiter: RateLimiter | null;
  private readonly stats: PriorityInternalStats = {
    totalProcessed: 0,
    totalRejected: 0,
    totalWaitMs: 0,
    totalProcessingMs: 0,
    processedByPriority: {
      [Priority.URGENT]: 0,
      [Priority.HIGH]: 0,
      [Priority.NORMAL]: 0,
      [Priority.LOW]: 0,
    },
  };

  constructor(
    config: PriorityQueueConfig,
    processor: (item: T) => Promise<R>,
    rateLimiter?: RateLimiter,
  ) {
    this.config = config;
    this.processor = processor;
    this.rateLimiter = rateLimiter ?? null;
  }

  async enqueue(
    payload: T,
    requestSizeBytes: number,
    options?: { priority?: Priority; agentId?: string },
  ): Promise<R> {
    const priority = options?.priority ?? Priority.NORMAL;
    const agentId = options?.agentId;

    // 1. Request size check
    if (requestSizeBytes > this.config.maxRequestSizeBytes) {
      throw new QueueFullError(this.queue.length, this.config.maxQueueLength);
    }

    // 2. Rate limit check
    if (this.rateLimiter && !this.rateLimiter.check(agentId)) {
      throw new RateLimitError(this.rateLimiter.getLimitPerMinute());
    }

    // 3. Queue length check
    if (this.queue.length >= this.config.maxQueueLength) {
      throw new QueueFullError(this.queue.length, this.config.maxQueueLength);
    }

    // 4. Create promise and enqueue with priority insertion
    const promise = new Promise<R>((resolve, reject) => {
      const id = randomUUID();

      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((item) => item.id === id);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          this.stats.totalRejected++;
          reject(new QueueFullError(this.queue.length, this.config.maxQueueLength));
        }
      }, this.config.queueTimeoutMs);

      const item: PriorityQueueItem<T> = {
        id,
        payload,
        priority,
        enqueuedAt: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject,
        _timer: timer,
      };

      // Insert in priority order, maintaining FIFO within same priority
      let insertIdx = this.queue.length;
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i]!.priority > priority) {
          insertIdx = i;
          break;
        }
      }
      this.queue.splice(insertIdx, 0, item);
    });

    // 5. Trigger processing
    queueMicrotask(() => this.processNext());

    return promise;
  }

  getStatus(): PriorityQueueStats {
    const totalProcessed = this.stats.totalProcessed;

    // Count pending by priority
    const pendingByPriority: Record<Priority, number> = {
      [Priority.URGENT]: 0,
      [Priority.HIGH]: 0,
      [Priority.NORMAL]: 0,
      [Priority.LOW]: 0,
    };
    for (const item of this.queue) {
      pendingByPriority[item.priority]++;
    }

    return {
      currentLength: this.queue.length,
      isProcessing: this.isProcessingFlag,
      totalProcessed,
      totalRejected: this.stats.totalRejected,
      averageWaitMs: totalProcessed > 0 ? this.stats.totalWaitMs / totalProcessed : 0,
      averageProcessingMs: totalProcessed > 0 ? this.stats.totalProcessingMs / totalProcessed : 0,
      byPriority: {
        [Priority.URGENT]: {
          pending: pendingByPriority[Priority.URGENT],
          processed: this.stats.processedByPriority[Priority.URGENT],
        },
        [Priority.HIGH]: {
          pending: pendingByPriority[Priority.HIGH],
          processed: this.stats.processedByPriority[Priority.HIGH],
        },
        [Priority.NORMAL]: {
          pending: pendingByPriority[Priority.NORMAL],
          processed: this.stats.processedByPriority[Priority.NORMAL],
        },
        [Priority.LOW]: {
          pending: pendingByPriority[Priority.LOW],
          processed: this.stats.processedByPriority[Priority.LOW],
        },
      },
    };
  }

  private async processNext(): Promise<void> {
    if (this.isProcessingFlag || this.queue.length === 0) return;

    this.isProcessingFlag = true;
    const item = this.queue.shift()!;
    clearTimeout(item._timer);

    const waitMs = Date.now() - item.enqueuedAt;
    this.stats.totalWaitMs += waitMs;

    const processingStart = Date.now();
    try {
      const result = await this.processor(item.payload);
      this.stats.totalProcessed++;
      this.stats.processedByPriority[item.priority]++;
      this.stats.totalProcessingMs += Date.now() - processingStart;
      item.resolve(result);
    } catch (error) {
      this.stats.totalRejected++;
      this.stats.totalProcessingMs += Date.now() - processingStart;
      item.reject(error);
    } finally {
      this.isProcessingFlag = false;
      queueMicrotask(() => this.processNext());
    }
  }
}
