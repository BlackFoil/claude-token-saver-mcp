// Copyright 2026 claude-token-saver-mcp Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Execution Tracker (DMS-029)
 * Design: docs/design/dynamic-model-selector-design.md §6
 *
 * Tracks model execution history in a circular buffer and computes
 * performance metrics and recommendation boosts per model × category.
 */

import { readFile, writeFile } from 'node:fs/promises';
import type { ExecutionRecord, ModelPerformanceMetrics, TaskCategory } from './types.js';

const DEFAULT_MAX_RECORDS = 1000;

export class ExecutionTracker {
  private records: ExecutionRecord[] = [];
  private readonly maxRecords: number;

  constructor(maxRecords: number = DEFAULT_MAX_RECORDS) {
    this.maxRecords = Math.max(1, maxRecords);
  }

  /**
   * Record a new execution. Timestamp is added automatically.
   * Enforces circular buffer: removes oldest record when full.
   */
  recordExecution(record: Omit<ExecutionRecord, 'timestamp'>): void {
    if (this.records.length >= this.maxRecords) {
      this.records.shift();
    }
    this.records.push({ ...record, timestamp: Date.now() });
  }

  /**
   * Aggregate performance metrics for all models in a given category.
   * Returns results sorted by successRate descending.
   */
  getPerformanceMetrics(category: TaskCategory): ModelPerformanceMetrics[] {
    const filtered = this.records.filter((r) => r.taskCategory === category);
    if (filtered.length === 0) return [];

    const grouped = new Map<string, ExecutionRecord[]>();
    for (const record of filtered) {
      const existing = grouped.get(record.modelId);
      if (existing) {
        existing.push(record);
      } else {
        grouped.set(record.modelId, [record]);
      }
    }

    const metrics: ModelPerformanceMetrics[] = [];
    for (const [modelId, records] of grouped) {
      const successCount = records.filter((r) => r.success).length;
      const totalTime = records.reduce((sum, r) => sum + r.executionTimeMs, 0);
      metrics.push({
        modelId,
        category,
        avgExecutionTimeMs: totalTime / records.length,
        successRate: successCount / records.length,
        usageCount: records.length,
      });
    }

    metrics.sort((a, b) => b.successRate - a.successRate);
    return metrics;
  }

  /**
   * Compute a recommendation boost score (0.0–1.0) for a model in a category.
   *
   * Formula: successRate * (1 / normalizedExecutionTime)
   * where normalizedExecutionTime = model's avgTime / slowest avgTime in category.
   *
   * Returns 0 if no history exists for the model (neutral).
   */
  getRecommendationBoost(modelId: string, category: TaskCategory): number {
    const metrics = this.getPerformanceMetrics(category);
    if (metrics.length === 0) return 0;

    const modelMetrics = metrics.find((m) => m.modelId === modelId);
    if (!modelMetrics) return 0;

    const slowestAvg = Math.max(...metrics.map((m) => m.avgExecutionTimeMs));
    if (slowestAvg <= 0) return 0;

    const normalizedTime = modelMetrics.avgExecutionTimeMs / slowestAvg;
    if (normalizedTime <= 0) return 0;

    const boost = modelMetrics.successRate * (1 / normalizedTime);
    return Math.min(1, boost);
  }

  /** Return the current number of stored records. */
  getRecordCount(): number {
    return this.records.length;
  }

  /** Clear all stored records. */
  clear(): void {
    this.records = [];
  }

  /** Load execution records from a JSON file. */
  async loadFromFile(path: string): Promise<void> {
    const data = await readFile(path, 'utf-8');
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array of ExecutionRecord');
    }
    this.records = parsed as ExecutionRecord[];
    // Enforce max size by keeping only the newest records
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(this.records.length - this.maxRecords);
    }
  }

  /** Save execution records to a JSON file. */
  async saveToFile(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.records, null, 2), 'utf-8');
  }
}
