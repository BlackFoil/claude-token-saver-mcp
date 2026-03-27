// Copyright 2026 claude-token-saver-mcp Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Dynamic Model Selector — Type Definitions (DMS-001)
 * Design: docs/design/dynamic-model-selector-design.md §2, §3.1
 */

import type { TierLevel } from '../tiering/config.js';

// ── Task Categories ───────────────────────────────────────────

/** LLM usage categories defined in CLAUDE.md role table. */
export type TaskCategory =
  | 'coding'
  | 'coding-agent'
  | 'japanese-text'
  | 'japanese-coding'
  | 'translation'
  | 'summarization'
  | 'general';

export const TASK_CATEGORIES: readonly TaskCategory[] = [
  'coding',
  'coding-agent',
  'japanese-text',
  'japanese-coding',
  'translation',
  'summarization',
  'general',
] as const;

// ── License Types ─────────────────────────────────────────────

/** License classifications for recommended models. */
export type LicenseType =
  | 'Apache-2.0'
  | 'MIT'
  | 'NVIDIA-Open'
  | 'Meta-Community'
  | 'PLaMo-Community'
  | 'Other';

export const LICENSE_TYPES: readonly LicenseType[] = [
  'Apache-2.0',
  'MIT',
  'NVIDIA-Open',
  'Meta-Community',
  'PLaMo-Community',
  'Other',
] as const;

// ── Quantization Variants (DMS-031) ──────────────────────────

/** A quantization variant for a model. */
export interface QuantizationVariant {
  /** Quantization format (e.g. 'Q4_K_M', 'Q5_K_M', 'Q8_0') */
  quantization: string;
  /** VRAM required in GB */
  vramRequired: number;
  /** Quality ranking (1 = highest quality) */
  qualityRank: number;
  /** Speed ranking (1 = fastest) */
  speedRank: number;
}

// ── Model Recommendation ──────────────────────────────────────

/** Benchmark scores for a model (all optional). */
export interface ModelBenchmarks {
  /** HumanEval pass@1 (%) */
  humanEval?: number;
  /** SWE-Bench Verified (%) */
  sweBench?: number;
  /** Japanese MT-Bench score */
  japaneseMTBench?: number;
}

/**
 * A single model recommendation entry in the registry.
 * Design: §3.1 ModelRecommendation interface.
 */
export interface ModelRecommendation {
  /** Ollama model ID (e.g. "qwen2.5-coder:7b") */
  modelId: string;
  /** Human-readable display name */
  displayName: string;
  /** Task category this recommendation targets */
  category: TaskCategory;
  /** Tier level (1/2/3) this recommendation is for */
  tier: TierLevel;
  /** Minimum RAM in GB */
  minRamGB: number;
  /** Parameter size label (e.g. "7B", "32B") */
  parameterSize: string;
  /** Recommended quantization (e.g. "Q4_K_M") */
  quantization: string;
  /** Estimated VRAM required in GB */
  vramRequired: number;
  /** License type */
  license: LicenseType;
  /** Additional license notes */
  licenseNote?: string;
  /** Benchmark scores */
  benchmarks: ModelBenchmarks;
  /** Whether the model is available via `ollama pull` */
  ollamaAvailable: boolean;
  /** Priority within the same category+tier (1 = highest) */
  priority: number;
  /** Available quantization variants for this model */
  variants?: QuantizationVariant[];
}

/**
 * Recommendation result returned by the recommender engine.
 * Includes installation status for each recommended model.
 */
export interface RecommendationResult {
  /** The recommended model */
  recommendation: ModelRecommendation;
  /** Whether the model is already installed locally */
  installed: boolean;
  /** Whether the model is currently loaded in VRAM */
  loaded: boolean;
  /** Recommended quantization variant based on VRAM availability */
  recommendedQuantization?: string;
}

// ── Execution Tracking (DMS-029) ─────────────────────────────

/** A single execution record for model performance tracking. */
export interface ExecutionRecord {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Task category the execution was for */
  taskCategory: TaskCategory;
  /** Ollama model ID used */
  modelId: string;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Number of input tokens */
  inputTokens: number;
  /** Number of output tokens */
  outputTokens: number;
  /** Whether the execution completed successfully */
  success: boolean;
}

/** Aggregated performance metrics for a model within a category. */
export interface ModelPerformanceMetrics {
  /** Ollama model ID */
  modelId: string;
  /** Task category */
  category: TaskCategory;
  /** Average execution time in milliseconds */
  avgExecutionTimeMs: number;
  /** Success rate from 0 to 1 */
  successRate: number;
  /** Total number of executions */
  usageCount: number;
}
