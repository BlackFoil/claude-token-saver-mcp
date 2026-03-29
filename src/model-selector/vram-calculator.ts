// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * VRAM Calculator (DMS-007)
 * Design: docs/design/dynamic-model-selector-design.md §5.4
 *
 * Estimates simultaneous model load capacity based on system RAM.
 */

import type { TierLevel } from '../tiering/config.js';

/**
 * VRAM estimation result.
 */
export interface VramEstimate {
  /** Total system RAM in GB */
  totalRamGB: number;
  /** Estimated available VRAM in GB (Apple Silicon unified memory or discrete GPU) */
  estimatedVramGB: number;
  /** Maximum number of models that can be loaded simultaneously */
  maxSimultaneousModels: number;
  /** Detected tier level */
  tier: TierLevel;
}

/**
 * Estimate available VRAM from system RAM.
 *
 * Apple Silicon unified memory: ~75% of total RAM available for GPU.
 * Discrete GPU: use VRAM directly (not implemented in MVP; assumes unified).
 */
function estimateVramFromRam(totalRamGB: number): number {
  return totalRamGB * 0.75;
}

/**
 * Determine max simultaneous models based on RAM.
 * Design: §5.4 table.
 *
 * | PC RAM     | Simultaneous | Strategy                        |
 * |:-----------|:------------:|:--------------------------------|
 * | < 16 GB    | 1            | Single shared model             |
 * | 16-32 GB   | 1-2          | coding + general (7B × 2)      |
 * | 32-48 GB   | 2            | coding + japanese (7B + 14B)    |
 * | 48-64 GB   | 2-3          | coding(32B) + japanese(14B)     |
 * | 64-128 GB  | 3-4          | coding(32B) + japanese(32B) + general |
 */
function calculateMaxModels(totalRamGB: number): number {
  if (totalRamGB < 16) return 1;
  if (totalRamGB < 32) return 2;
  if (totalRamGB < 48) return 2;
  if (totalRamGB < 64) return 3;
  return 4;
}

/**
 * Determine tier level from RAM.
 */
function determineTier(totalRamGB: number): TierLevel {
  if (totalRamGB < 16) return 1;
  if (totalRamGB < 48) return 2;
  return 3;
}

/**
 * Calculate VRAM estimate and max simultaneous models.
 *
 * @param totalRamGB - Total system RAM in GB
 * @param maxModelsOverride - Override from config (MAX_SIMULTANEOUS_MODELS env or config.modelSelector.maxSimultaneousModels)
 */
export function calculateVramCapacity(
  totalRamGB: number,
  maxModelsOverride?: number | 'auto',
): VramEstimate {
  const tier = determineTier(totalRamGB);
  const estimatedVramGB = estimateVramFromRam(totalRamGB);
  const autoMaxModels = calculateMaxModels(totalRamGB);

  const maxSimultaneousModels =
    maxModelsOverride !== undefined && maxModelsOverride !== 'auto'
      ? maxModelsOverride
      : autoMaxModels;

  return {
    totalRamGB,
    estimatedVramGB,
    maxSimultaneousModels,
    tier,
  };
}

/**
 * Check if loading an additional model would exceed VRAM capacity.
 *
 * @param currentLoadedVramGB - Total VRAM currently used by loaded models
 * @param newModelVramGB - VRAM required by the new model
 * @param totalRamGB - Total system RAM in GB
 * @returns true if the model can be loaded without exceeding VRAM
 */
export function canLoadModel(
  currentLoadedVramGB: number,
  newModelVramGB: number,
  totalRamGB: number,
): boolean {
  const availableVram = estimateVramFromRam(totalRamGB);
  return currentLoadedVramGB + newModelVramGB <= availableVram;
}
