// Copyright 2026 claude-token-saver-mcp team
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
import type { BenchmarkStore } from './benchmark-db.js';
import { getRecommendations, getFullRegistry } from './registry.js';
import { calculateVramCapacity } from './vram-calculator.js';
import { selectQuantization } from './quantization-selector.js';

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
  /** Custom recommendation overrides: { [category]: { [tierLevel]: modelId[] } } */
  customRecommendations?: Record<string, Record<string, string[]>>;
  /** External benchmark store for enriching model data (DMS-028) */
  benchmarkStore?: BenchmarkStore;
  /** Available VRAM in GB for quantization selection (DMS-031) */
  availableVramGB?: number;
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
    customRecommendations,
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

  // 0. Check custom recommendations BEFORE registry lookup
  const customModelIds = customRecommendations?.[effectiveCategory]?.[String(tier)];
  let customCandidates: ModelRecommendation[] = [];

  if (customModelIds && customModelIds.length > 0) {
    const registry = getFullRegistry();
    const registryMap = new Map<string, ModelRecommendation>();
    for (const rec of registry) {
      registryMap.set(rec.modelId, rec);
    }

    customCandidates = customModelIds.map((modelId, index) => {
      const existing = registryMap.get(modelId);
      if (existing) {
        return { ...existing, category: effectiveCategory, tier, priority: 100 + index };
      }
      return {
        modelId,
        displayName: modelId,
        category: effectiveCategory,
        tier,
        minRamGB: 0,
        parameterSize: 'unknown',
        quantization: 'default',
        vramRequired: 0,
        license: 'Other' as const,
        benchmarks: {},
        ollamaAvailable: true,
        priority: 100 + index,
      };
    });
  }

  // 1. Lookup recommendations for (category, tier)
  let registryCandidates = getRecommendations(effectiveCategory, tier);

  // If no registry candidates found for this tier, try lower tiers
  if (registryCandidates.length === 0 && tier > 1) {
    for (let t = (tier - 1) as TierLevel; t >= 1; t = (t - 1) as TierLevel) {
      registryCandidates = getRecommendations(effectiveCategory, t);
      if (registryCandidates.length > 0) break;
    }
  }

  // Combine: custom models first, then registry models
  let candidates = [...customCandidates, ...registryCandidates];

  // DMS-028: Enrich candidates with external benchmark data
  if (input.benchmarkStore) {
    candidates = candidates.map((c) => {
      const stored = input.benchmarkStore!.getBenchmarks(c.modelId);
      if (stored) {
        return { ...c, benchmarks: { ...c.benchmarks, ...stored } };
      }
      return c;
    });
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

  // DMS-031: Estimate available VRAM for quantization selection
  const estimatedVram = input.availableVramGB ?? totalRamGB * 0.7;

  const results: RecommendationResult[] = candidates.map((rec) => {
    const result: RecommendationResult = {
      recommendation: rec,
      installed: installedSet.has(rec.modelId),
      loaded: loadedSet.has(rec.modelId),
    };

    // DMS-031: Auto-select quantization variant
    if (rec.variants && rec.variants.length > 0) {
      const qResult = selectQuantization({
        variants: rec.variants,
        availableVramGB: estimatedVram,
        preferQuality,
      });
      if (qResult) {
        result.recommendedQuantization = qResult.variant.quantization;
      }
    }

    return result;
  });

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
      const quantStr = r.recommendedQuantization && r.recommendedQuantization !== rec.quantization
        ? `${rec.quantization} → ${r.recommendedQuantization}`
        : rec.quantization;
      lines.push(
        `${i + 1}. ✅ **${rec.modelId}** (${quantStr})${loadedStr} — ${benchStr} | License: ${rec.license}`,
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
