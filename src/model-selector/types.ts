// Copyright 2026 PulseAgent Team
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
}
