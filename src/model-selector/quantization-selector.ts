// Copyright 2026 claude-token-saver-mcp Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Quantization Variant Auto-Selector (DMS-031)
 *
 * Selects the best quantization variant for a model based on
 * available VRAM and user preference (quality vs speed).
 */

import type { QuantizationVariant } from './types.js';

export interface QuantizationInput {
  /** Available quantization variants for the model */
  variants: QuantizationVariant[];
  /** Available VRAM in GB */
  availableVramGB: number;
  /** If true, prefer quality over speed */
  preferQuality: boolean;
}

export interface QuantizationResult {
  /** The selected variant */
  variant: QuantizationVariant;
  /** True if the selected variant exceeds available VRAM (smallest fallback) */
  exceedsVram: boolean;
}

/**
 * Select the best quantization variant given VRAM constraints and preference.
 *
 * - Filter variants that fit within `availableVramGB`
 * - If `preferQuality=true`: sort by qualityRank ascending, pick first
 * - If `preferQuality=false`: sort by speedRank ascending, pick first
 * - If no variant fits: return the smallest vramRequired variant (with exceedsVram flag)
 * - If no variants: return undefined
 */
export function selectQuantization(input: QuantizationInput): QuantizationResult | undefined {
  const { variants, availableVramGB, preferQuality } = input;

  if (variants.length === 0) {
    return undefined;
  }

  // Filter variants that fit within available VRAM
  const fitting = variants.filter((v) => v.vramRequired <= availableVramGB);

  if (fitting.length > 0) {
    // Sort by preference
    const sorted = [...fitting].sort((a, b) =>
      preferQuality
        ? a.qualityRank - b.qualityRank
        : a.speedRank - b.speedRank,
    );
    return { variant: sorted[0]!, exceedsVram: false };
  }

  // No variant fits — return the smallest one as a fallback
  const smallest = [...variants].sort((a, b) => a.vramRequired - b.vramRequired);
  return { variant: smallest[0]!, exceedsVram: true };
}
