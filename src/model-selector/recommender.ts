// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

/**
 * Model Recommender Engine (DMS-008)
 * Design: docs/design/dynamic-model-selector-design.md §5.3
 *
 * Algorithm:
 * 1. (category, tier) → recommendation table lookup
 * 2. preferQuality → sort by quality (large models first) or speed (small first)
 * 3. Classify: installed ✅ / not installed 📥
 * 4. Sort: ✅ first, 📥 last
 * 5. Apply license filter
 * 6. Apply blocked model filter
 * 7. VRAM constraint check (single model fallback if needed)
 * 8. Return top 4
 */

import type { TaskCategory, RecommendationResult, ModelRecommendation } from './types.js';
import type { TierLevel } from '../tiering/config.js';
import { getRecommendations } from './registry.js';
import { calculateVramCapacity } from './vram-calculator.js';

const MAX_RESULTS = 4;

export interface RecommendInput {
  /** Task category to recommend models for */
  category: TaskCategory;
  /** Prefer quality (true) or speed (false). Default: false */
  preferQuality?: boolean;
  /** System RAM in GB (for tier detection) */
  totalRamGB: number;
  /** List of installed model names (from Ollama /api/tags) */
  installedModels: string[];
  /** List of currently loaded model names (from Ollama /api/ps) */
  loadedModels?: string[];
  /** Models to exclude from recommendations */
  blockedModels?: string[];
  /** Only include models with these licenses */
  licenseFilter?: string[];
  /** Override for max simultaneous models */
  maxSimultaneousModels?: number | 'auto';
}

export interface RecommendOutput {
  /** Recommended models with installation status */
  recommendations: RecommendationResult[];
  /** Detected tier level */
  tier: TierLevel;
  /** Whether VRAM constraints forced a general fallback */
  vramFallback: boolean;
  /** Max simultaneous models for this system */
  maxSimultaneousModels: number;
}

/**
 * Recommend models for a given category and system configuration.
 */
export function recommendModels(input: RecommendInput): RecommendOutput {
  const {
    category,
    preferQuality = false,
    totalRamGB,
    installedModels,
    loadedModels = [],
    blockedModels = [],
    licenseFilter,
    maxSimultaneousModels: maxModelsOverride,
  } = input;

  const vramCapacity = calculateVramCapacity(totalRamGB, maxModelsOverride);
  const tier = vramCapacity.tier;
  const maxModels = vramCapacity.maxSimultaneousModels;

  // Check VRAM constraint: if only 1 model can be loaded and category isn't general,
  // fall back to general to recommend a versatile model
  let effectiveCategory = category;
  let vramFallback = false;

  if (maxModels <= 1 && category !== 'general') {
    effectiveCategory = 'general';
    vramFallback = true;
  }

  // 1. Lookup recommendations for (category, tier)
  let candidates = getRecommendations(effectiveCategory, tier);

  // If no candidates found for this tier, try lower tiers
  if (candidates.length === 0 && tier > 1) {
    for (let t = (tier - 1) as TierLevel; t >= 1; t = (t - 1) as TierLevel) {
      candidates = getRecommendations(effectiveCategory, t);
      if (candidates.length > 0) break;
    }
  }

  // 2. Apply blocked model filter
  const blockedSet = new Set(blockedModels.map((m) => m.toLowerCase()));
  candidates = candidates.filter(
    (c) => !blockedSet.has(c.modelId.toLowerCase()) &&
           !blockedSet.has(c.modelId.split(':')[0]!.toLowerCase()),
  );

  // 3. Apply license filter
  if (licenseFilter && licenseFilter.length > 0) {
    const filterSet = new Set(licenseFilter);
    candidates = candidates.filter((c) => filterSet.has(c.license));
  }

  // 4. preferQuality sort
  if (preferQuality) {
    // Quality: larger models first (higher VRAM = larger)
    candidates = [...candidates].sort((a, b) => b.vramRequired - a.vramRequired);
  }
  // If !preferQuality, keep original priority order (already speed-optimized)

  // 5. Classify installed/loaded status
  const installedSet = new Set(installedModels);
  const loadedSet = new Set(loadedModels);

  const results: RecommendationResult[] = candidates.map((rec) => ({
    recommendation: rec,
    installed: installedSet.has(rec.modelId),
    loaded: loadedSet.has(rec.modelId),
  }));

  // 6. Sort: installed first, then not installed
  results.sort((a, b) => {
    // Loaded > installed > not installed
    if (a.loaded !== b.loaded) return a.loaded ? -1 : 1;
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return 0;
  });

  // 7. Return top N
  return {
    recommendations: results.slice(0, MAX_RESULTS),
    tier,
    vramFallback,
    maxSimultaneousModels: maxModels,
  };
}

/**
 * Format recommendation output as Markdown for MCP response.
 */
export function formatRecommendationMarkdown(
  output: RecommendOutput,
  category: TaskCategory,
  totalRamGB: number,
): string {
  const tierNames: Record<TierLevel, string> = {
    1: 'Light',
    2: 'Standard',
    3: 'Ultra',
  };

  const lines: string[] = [
    '## Model Recommendation',
    '',
    `**Category:** ${category}`,
    `**System:** Tier ${output.tier} (${tierNames[output.tier]}) — ${Math.round(totalRamGB)}GB RAM`,
    `**VRAM Slots:** ${output.maxSimultaneousModels} model(s) simultaneous`,
  ];

  if (output.vramFallback) {
    lines.push('');
    lines.push('> **Note:** VRAM constraints limit to 1 model. Recommending general-purpose model for versatility.');
  }

  const installed = output.recommendations.filter((r) => r.installed);
  const notInstalled = output.recommendations.filter((r) => !r.installed);

  if (installed.length > 0) {
    lines.push('');
    lines.push('### Recommended Models (available locally):');
    for (let i = 0; i < installed.length; i++) {
      const r = installed[i]!;
      const rec = r.recommendation;
      const benchStr = formatBenchmarks(rec);
      const loadedStr = r.loaded ? ' [LOADED]' : '';
      lines.push(
        `${i + 1}. ✅ **${rec.modelId}** (${rec.quantization})${loadedStr} — ${benchStr} | License: ${rec.license}`,
      );
    }
  }

  if (notInstalled.length > 0) {
    lines.push('');
    lines.push('### Additional options (requires pull):');
    const startIdx = installed.length;
    for (let i = 0; i < notInstalled.length; i++) {
      const r = notInstalled[i]!;
      const rec = r.recommendation;
      const benchStr = formatBenchmarks(rec);
      lines.push(
        `${startIdx + i + 1}. 📥 ${rec.modelId} — ${benchStr} | License: ${rec.license}`,
      );
    }
  }

  if (output.recommendations.length === 0) {
    lines.push('');
    lines.push('No models found matching the criteria. Check blocked models and license filter settings.');
  }

  lines.push('');
  lines.push('Use `offload_work` with `model` parameter to select.');

  return lines.join('\n');
}

function formatBenchmarks(rec: ModelRecommendation): string {
  const parts: string[] = [];
  if (rec.benchmarks.humanEval !== undefined) {
    parts.push(`HumanEval: ${rec.benchmarks.humanEval}%`);
  }
  if (rec.benchmarks.sweBench !== undefined) {
    parts.push(`SWE-Bench: ${rec.benchmarks.sweBench}%`);
  }
  if (rec.benchmarks.japaneseMTBench !== undefined) {
    parts.push(`JP-MT: ${rec.benchmarks.japaneseMTBench}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'N/A';
}
