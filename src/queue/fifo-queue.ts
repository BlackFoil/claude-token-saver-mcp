// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';
import { QueueFullError, RateLimitError } from '../errors.js';

export interface QueueConfig {
  maxQueueLength: number;
  maxRequestSizeBytes: number;
  queueTimeoutMs: number;
}

export interface QueueStats {
  currentLength: number;
  isProcessing: boolean;
  totalProcessed: number;
  totalRejected: number;
  averageWaitMs: number;
  averageProcessingMs: number;
}

export interface RateLimiter {
  check(agentId?: string): boolean;
  getLimitPerMinute(): number;
}

interface QueueItem<T> {
  id: string;
  payload: T;
  enqueuedAt: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  _timer: ReturnType<typeof setTimeout>;
}

interface QueueInternalStats {
  totalProcessed: number;
  totalRejected: number;
  totalWaitMs: number;
  totalProcessingMs: number;
}

/**
 * Promise-based FIFO queue with concurrency=1, max queue length, and rate limiting.
 */
export class FIFOQueue<T, R> {
  private queue: QueueItem<T>[] = [];
  private isProcessingFlag = false;
  private readonly config: QueueConfig;
  private readonly processor: (item: T) => Promise<R>;
  private readonly rateLimiter: RateLimiter | null;
  private readonly stats: QueueInternalStats = {
    totalProcessed: 0,
    totalRejected: 0,
    totalWaitMs: 0,
    totalProcessingMs: 0,
  };

  constructor(config: QueueConfig, processor: (item: T) => Promise<R>, rateLimiter?: RateLimiter) {
    this.config = config;
    this.processor = processor;
    this.rateLimiter = rateLimiter ?? null;
  }

  async enqueue(payload: T, requestSizeBytes: number, agentId?: string): Promise<R> {
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

    // 4. Create promise and enqueue
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

      const item: QueueItem<T> = {
        id,
        payload,
        enqueuedAt: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject,
        _timer: timer,
      };

      this.queue.push(item);
    });

    // 5. Trigger processing
    queueMicrotask(() => this.processNext());

    return promise;
  }

  getStatus(): QueueStats {
    const totalProcessed = this.stats.totalProcessed;
    return {
      currentLength: this.queue.length,
      isProcessing: this.isProcessingFlag,
      totalProcessed,
      totalRejected: this.stats.totalRejected,
      averageWaitMs: totalProcessed > 0 ? this.stats.totalWaitMs / totalProcessed : 0,
      averageProcessingMs: totalProcessed > 0 ? this.stats.totalProcessingMs / totalProcessed : 0,
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
