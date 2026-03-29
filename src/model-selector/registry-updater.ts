// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * Model Registry Auto-Update (P6-003)
 *
 * Periodically queries Ollama for locally installed models and auto-classifies
 * any models not already present in the static registry.
 */

import type { OllamaClient, OllamaModelInfo } from '../ollama/client.js';
import type { LicenseType, ModelBenchmarks, ModelRecommendation, TaskCategory } from './types.js';
import type { TierLevel } from '../tiering/config.js';
import type { Logger } from 'pino';
import { getAllRegisteredModelIds } from './registry.js';

// ── Config ────────────────────────────────────────────────────

export interface RegistryUpdaterConfig {
  /** Interval in ms for checking new models (default: 30 minutes) */
  updateIntervalMs?: number;
  /** Whether auto-update is enabled */
  enabled?: boolean;
}

const DEFAULT_CONFIG: Required<RegistryUpdaterConfig> = {
  updateIntervalMs: 30 * 60 * 1_000, // 30 minutes
  enabled: true,
};

// ── Known Model Family Patterns ───────────────────────────────

interface ModelFamilyPattern {
  pattern: RegExp;
  category: TaskCategory;
  license: LicenseType;
  benchmarks: ModelBenchmarks;
}

const MODEL_FAMILY_PATTERNS: ModelFamilyPattern[] = [
  // Coding-specific models (must be checked before general qwen/deepseek)
  {
    pattern: /^qwen.*coder/i,
    category: 'coding',
    license: 'Apache-2.0',
    benchmarks: { humanEval: 70 },
  },
  {
    pattern: /^deepseek.*coder/i,
    category: 'coding',
    license: 'MIT',
    benchmarks: { humanEval: 65 },
  },
  {
    pattern: /^codellama/i,
    category: 'coding',
    license: 'Meta-Community',
    benchmarks: { humanEval: 60 },
  },
  {
    pattern: /^devstral/i,
    category: 'coding-agent',
    license: 'Apache-2.0',
    benchmarks: { sweBench: 50 },
  },
  // General models with Japanese support
  {
    pattern: /^qwen3/i,
    category: 'general',
    license: 'Apache-2.0',
    benchmarks: { japaneseMTBench: 7.0 },
  },
  {
    pattern: /^qwen2\.5/i,
    category: 'general',
    license: 'Apache-2.0',
    benchmarks: { japaneseMTBench: 6.5 },
  },
  // General models
  { pattern: /^gemma/i, category: 'general', license: 'MIT', benchmarks: {} },
  { pattern: /^phi/i, category: 'general', license: 'MIT', benchmarks: {} },
  { pattern: /^llama/i, category: 'general', license: 'Meta-Community', benchmarks: {} },
];

// ── Helpers ───────────────────────────────────────────────────

/**
 * Parse a parameter size string (e.g. "7B", "14B", "0.5B") into billions.
 * Returns NaN if unparseable.
 */
function parseParamBillions(paramSize: string | undefined): number {
  if (!paramSize) return NaN;
  const match = paramSize.match(/^([\d.]+)\s*[bB]/);
  return match?.[1] ? parseFloat(match[1]) : NaN;
}

/**
 * Estimate tier level from parameter count in billions.
 */
function estimateTier(paramBillions: number): TierLevel {
  if (Number.isNaN(paramBillions) || paramBillions <= 8) return 1;
  if (paramBillions <= 16) return 2;
  return 3;
}

/**
 * Estimate VRAM required (GB) from the model file size in bytes.
 * Rough heuristic: file size * 1.2 for runtime overhead, converted to GB.
 */
function estimateVram(sizeBytes: number): number {
  return Math.round((sizeBytes / 1024 ** 3) * 1.2 * 10) / 10;
}

/**
 * Estimate minimum RAM (GB) from VRAM — add a small buffer.
 */
function estimateMinRam(vramGB: number): number {
  return Math.ceil(vramGB + 2);
}

// ── RegistryUpdater ───────────────────────────────────────────

export class RegistryUpdater {
  private readonly client: OllamaClient;
  private readonly logger: Logger;
  private readonly config: Required<RegistryUpdaterConfig>;
  private timer?: ReturnType<typeof setInterval>;
  private discoveredModels: Map<string, ModelRecommendation> = new Map();

  constructor(client: OllamaClient, logger: Logger, config?: RegistryUpdaterConfig) {
    this.client = client;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start periodic updates. */
  start(): void {
    if (!this.config.enabled) {
      this.logger.debug('Registry auto-update is disabled');
      return;
    }
    if (this.timer) return; // already running

    this.logger.info({ intervalMs: this.config.updateIntervalMs }, 'Starting registry auto-update');

    // Run immediately, then on interval
    void this.update().catch((err) => {
      this.logger.warn({ err }, 'Initial registry update failed');
    });

    this.timer = setInterval(() => {
      void this.update().catch((err) => {
        this.logger.warn({ err }, 'Periodic registry update failed');
      });
    }, this.config.updateIntervalMs);
  }

  /** Stop periodic updates. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.logger.info('Stopped registry auto-update');
    }
  }

  /** Run a single update cycle — query Ollama and discover new models. */
  async update(): Promise<ModelRecommendation[]> {
    const registeredIds = new Set(getAllRegisteredModelIds());
    const newlyDiscovered: ModelRecommendation[] = [];

    let models: OllamaModelInfo[];
    try {
      models = await this.client.listModels();
    } catch (err) {
      this.logger.warn({ err }, 'Failed to list models from Ollama');
      return [];
    }

    for (const model of models) {
      const modelId = model.name;

      // Skip if already in static registry or already discovered
      if (registeredIds.has(modelId) || this.discoveredModels.has(modelId)) {
        continue;
      }

      const recommendation = this.classifyModel(model);
      if (recommendation) {
        this.discoveredModels.set(modelId, recommendation);
        newlyDiscovered.push(recommendation);
        this.logger.info(
          { modelId, category: recommendation.category, tier: recommendation.tier },
          'Discovered new model',
        );
      }
    }

    if (newlyDiscovered.length > 0) {
      this.logger.info({ count: newlyDiscovered.length }, 'Registry update complete');
    }

    return newlyDiscovered;
  }

  /** Get all discovered models (not in static registry). */
  getDiscoveredModels(): ModelRecommendation[] {
    return [...this.discoveredModels.values()];
  }

  /** Classify a model based on its name and details. */
  classifyModel(model: OllamaModelInfo): ModelRecommendation | null {
    const name = model.name.toLowerCase();

    const matched = MODEL_FAMILY_PATTERNS.find((p) => p.pattern.test(name));
    if (!matched) {
      this.logger.debug({ modelName: model.name }, 'Model does not match any known pattern');
      return null;
    }

    const paramBillions = parseParamBillions(model.details?.parameter_size);
    const tier = estimateTier(paramBillions);
    const vramRequired = estimateVram(model.size);
    const minRamGB = estimateMinRam(vramRequired);
    const parameterSize = model.details?.parameter_size ?? 'unknown';
    const quantization = model.details?.quantization_level ?? 'unknown';

    return {
      modelId: model.name,
      displayName: model.name,
      category: matched.category,
      tier,
      minRamGB,
      parameterSize,
      quantization,
      vramRequired,
      license: matched.license,
      benchmarks: { ...matched.benchmarks },
      ollamaAvailable: true,
      priority: 99, // Lower than static registry entries
    };
  }
}

// Re-export helpers for testing
export { parseParamBillions, estimateTier, estimateVram, MODEL_FAMILY_PATTERNS };
