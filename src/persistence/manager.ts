// Copyright 2026 claude-token-saver-mcp Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Persistence Manager (P5-002)
 *
 * Wires ExecutionTracker and BenchmarkStore file persistence
 * into the server lifecycle with auto-save support.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import type { ExecutionTracker } from '../model-selector/execution-tracker.js';
import type { BenchmarkStore } from '../model-selector/benchmark-db.js';
import type { Logger } from 'pino';

const DEFAULT_DATA_DIR = join(homedir(), '.config', 'claude-token-saver');
const EXECUTION_HISTORY_FILE = 'execution-history.json';
const BENCHMARK_DATA_FILE = 'benchmark-data.json';

export interface PersistenceManagerConfig {
  dataDir?: string;
  autoSaveIntervalMs?: number;
}

export class PersistenceManager {
  private readonly dataDir: string;
  private readonly autoSaveIntervalMs: number;
  private autoSaveTimer?: ReturnType<typeof setInterval>;
  private executionTracker?: ExecutionTracker;
  private benchmarkStore?: BenchmarkStore;
  private logger?: Logger;

  constructor(config?: PersistenceManagerConfig) {
    this.dataDir = config?.dataDir ?? DEFAULT_DATA_DIR;
    this.autoSaveIntervalMs = config?.autoSaveIntervalMs ?? 5 * 60 * 1000;
  }

  /** Register components for persistence. */
  register(components: {
    executionTracker?: ExecutionTracker;
    benchmarkStore?: BenchmarkStore;
    logger?: Logger;
  }): void {
    this.executionTracker = components.executionTracker;
    this.benchmarkStore = components.benchmarkStore;
    this.logger = components.logger;
  }

  /** Load all data from disk. Call on startup. */
  async loadAll(): Promise<void> {
    const paths = this.getFilePaths();

    if (this.executionTracker) {
      try {
        await this.executionTracker.loadFromFile(paths.executionHistory);
        this.logger?.info({ path: paths.executionHistory }, 'Loaded execution history');
      } catch (_err: unknown) {
        // Missing file on first run or corrupt data — not critical
        this.logger?.warn(
          { path: paths.executionHistory, error: String(_err) },
          'Could not load execution history, starting fresh',
        );
      }
    }

    if (this.benchmarkStore) {
      try {
        await this.benchmarkStore.loadFromFile(paths.benchmarkData);
        this.logger?.info({ path: paths.benchmarkData }, 'Loaded benchmark data');
      } catch (_err: unknown) {
        this.logger?.warn(
          { path: paths.benchmarkData, error: String(_err) },
          'Could not load benchmark data, using defaults',
        );
      }
    }
  }

  /** Save all data to disk. Call on shutdown. */
  async saveAll(): Promise<void> {
    this.ensureDataDir();
    const paths = this.getFilePaths();

    if (this.executionTracker) {
      try {
        await this.executionTracker.saveToFile(paths.executionHistory);
        this.logger?.info({ path: paths.executionHistory }, 'Saved execution history');
      } catch (_err: unknown) {
        this.logger?.warn(
          { path: paths.executionHistory, error: String(_err) },
          'Could not save execution history',
        );
      }
    }

    if (this.benchmarkStore) {
      try {
        await this.benchmarkStore.saveToFile(paths.benchmarkData);
        this.logger?.info({ path: paths.benchmarkData }, 'Saved benchmark data');
      } catch (_err: unknown) {
        this.logger?.warn(
          { path: paths.benchmarkData, error: String(_err) },
          'Could not save benchmark data',
        );
      }
    }
  }

  /** Start auto-save timer. */
  startAutoSave(): void {
    if (this.autoSaveTimer) return;
    this.autoSaveTimer = setInterval(() => {
      void this.saveAll();
    }, this.autoSaveIntervalMs);
    // Allow the process to exit even if the timer is running
    if (this.autoSaveTimer.unref) {
      this.autoSaveTimer.unref();
    }
  }

  /** Stop auto-save timer. */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
  }

  /** Get file paths for testing. */
  getFilePaths(): { executionHistory: string; benchmarkData: string } {
    return {
      executionHistory: join(this.dataDir, EXECUTION_HISTORY_FILE),
      benchmarkData: join(this.dataDir, BENCHMARK_DATA_FILE),
    };
  }

  private ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }
}
