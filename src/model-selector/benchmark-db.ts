// Copyright 2026 claude-token-saver-mcp Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Benchmark Data Management Module (DMS-028)
 *
 * Manages model benchmark scores with in-memory storage
 * and optional JSON file persistence.
 */

import { readFile, writeFile } from 'node:fs/promises';
import type { ModelBenchmarks, ModelRecommendation } from './types.js';

interface BenchmarkFileSchema {
  version: number;
  lastUpdated: string;
  benchmarks: Record<string, ModelBenchmarks>;
}

/**
 * Manages model benchmark scores externally.
 * Stores benchmarks as an in-memory Map with optional JSON file persistence.
 */
export class BenchmarkStore {
  private readonly store: Map<string, ModelBenchmarks>;
  private lastUpdated: Date | undefined;

  constructor(defaultBenchmarks?: Map<string, ModelBenchmarks>) {
    this.store = new Map(defaultBenchmarks ?? []);
    if (this.store.size > 0) {
      this.lastUpdated = new Date();
    }
  }

  getBenchmarks(modelId: string): ModelBenchmarks | undefined {
    return this.store.get(modelId);
  }

  updateBenchmarks(modelId: string, benchmarks: Partial<ModelBenchmarks>): void {
    const existing = this.store.get(modelId) ?? {};
    this.store.set(modelId, { ...existing, ...benchmarks });
    this.lastUpdated = new Date();
  }

  getAllBenchmarks(): Map<string, ModelBenchmarks> {
    return new Map(this.store);
  }

  getLastUpdated(): Date | undefined {
    return this.lastUpdated;
  }

  async loadFromFile(path: string): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf-8');
    } catch {
      // File doesn't exist — silently use defaults
      return;
    }

    let data: BenchmarkFileSchema;
    try {
      data = JSON.parse(raw) as BenchmarkFileSchema;
    } catch {
      // Invalid JSON — log warning and use defaults
      console.warn(`[BenchmarkStore] Invalid JSON in ${path}, using defaults`);
      return;
    }

    if (data.benchmarks && typeof data.benchmarks === 'object') {
      for (const [modelId, benchmarks] of Object.entries(data.benchmarks)) {
        // Merge: file data overwrites defaults
        const existing = this.store.get(modelId) ?? {};
        this.store.set(modelId, { ...existing, ...benchmarks });
      }
    }

    if (data.lastUpdated) {
      this.lastUpdated = new Date(data.lastUpdated);
    }
  }

  async saveToFile(path: string): Promise<void> {
    const benchmarks: Record<string, ModelBenchmarks> = {};
    for (const [modelId, b] of this.store) {
      benchmarks[modelId] = b;
    }

    const data: BenchmarkFileSchema = {
      version: 1,
      lastUpdated: (this.lastUpdated ?? new Date()).toISOString(),
      benchmarks,
    };

    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  }

  static createFromRegistry(registry: ModelRecommendation[]): BenchmarkStore {
    const defaults = new Map<string, ModelBenchmarks>();
    for (const rec of registry) {
      // Use first occurrence for each modelId (highest priority entry)
      if (!defaults.has(rec.modelId)) {
        defaults.set(rec.modelId, { ...rec.benchmarks });
      } else {
        // Merge benchmarks from other category entries
        const existing = defaults.get(rec.modelId)!;
        defaults.set(rec.modelId, {
          humanEval: existing.humanEval ?? rec.benchmarks.humanEval,
          sweBench: existing.sweBench ?? rec.benchmarks.sweBench,
          japaneseMTBench: existing.japaneseMTBench ?? rec.benchmarks.japaneseMTBench,
        });
      }
    }
    return new BenchmarkStore(defaults);
  }
}
