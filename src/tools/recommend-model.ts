// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * recommend_model MCP Tool Handler (DMS-010)
 * Design: docs/design/dynamic-model-selector-design.md §4.1
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OllamaClient } from '../ollama/client.js';
import type { TierConfig } from '../tiering/config.js';
import type { AppConfig } from '../config/schema.js';
import type { BenchmarkStore } from '../model-selector/benchmark-db.js';
import type { Logger } from 'pino';
import { TASK_CATEGORIES, type TaskCategory } from '../model-selector/types.js';
import { recommendModels, formatRecommendationMarkdown } from '../model-selector/recommender.js';
import { ctsErrorToCallToolResult, CTSError, InvalidConfigError } from '../errors.js';

export interface RecommendModelContext {
  ollamaClient: OllamaClient;
  tierConfig: TierConfig;
  config: AppConfig;
  logger: Logger;
  ollamaHealthy: boolean;
  benchmarkStore?: BenchmarkStore;
}

interface RecommendModelInput {
  category: string;
  prefer_quality?: boolean;
}

function validateInput(args: Record<string, unknown>): RecommendModelInput {
  const category = args['category'];
  if (typeof category !== 'string' || !TASK_CATEGORIES.includes(category as TaskCategory)) {
    throw new InvalidConfigError(
      'category',
      `Invalid category "${String(category)}". Must be one of: ${TASK_CATEGORIES.join(', ')}`,
    );
  }

  const preferQuality = args['prefer_quality'];
  if (preferQuality !== undefined && typeof preferQuality !== 'boolean') {
    throw new InvalidConfigError('prefer_quality', 'Must be a boolean');
  }

  return {
    category: category as string,
    prefer_quality: preferQuality as boolean | undefined,
  };
}

/**
 * Handle recommend_model tool call.
 */
export async function handleRecommendModel(
  args: Record<string, unknown>,
  ctx: RecommendModelContext,
): Promise<CallToolResult> {
  try {
    // Check if model selector is enabled
    if (!ctx.config.modelSelector.enabled) {
      throw new InvalidConfigError(
        'modelSelector.enabled',
        'Model selector is disabled. Set MODEL_SELECTOR_ENABLED=true or modelSelector.enabled=true in config.',
      );
    }

    const input = validateInput(args);
    const category = input.category as TaskCategory;

    // Get installed and loaded models from Ollama
    let installedModels: string[] = [];
    let loadedModels: string[] = [];

    if (ctx.ollamaHealthy) {
      try {
        const [tagsResult, psResult] = await Promise.all([
          ctx.ollamaClient.listModelsFull(),
          ctx.ollamaClient.listRunning(),
        ]);
        installedModels = tagsResult.models.map((m) => m.name);
        loadedModels = psResult.models.map((m) => m.name);
      } catch (err) {
        ctx.logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          'Failed to query Ollama models, proceeding without install status',
        );
      }
    }

    // Get system RAM from tier config
    const totalRamGB = getRamFromTier(ctx.tierConfig);

    // Run recommendation engine
    const output = recommendModels({
      category,
      preferQuality: input.prefer_quality ?? ctx.config.modelSelector.preferQuality,
      totalRamGB,
      installedModels,
      loadedModels,
      blockedModels: ctx.config.modelSelector.blockedModels,
      licenseFilter: ctx.config.modelSelector.licenseFilter,
      maxSimultaneousModels: ctx.config.modelSelector.maxSimultaneousModels,
      benchmarkStore: ctx.benchmarkStore,
    });

    // Format as Markdown
    const markdown = formatRecommendationMarkdown(output, category, totalRamGB);

    ctx.logger.info({
      category,
      tier: output.tier,
      recommendations: output.recommendations.length,
      vramFallback: output.vramFallback,
    }, 'recommend_model completed');

    return {
      content: [{ type: 'text', text: markdown }],
    };
  } catch (error) {
    if (error instanceof CTSError) {
      return ctsErrorToCallToolResult(error);
    }
    return ctsErrorToCallToolResult(error);
  }
}

/**
 * Estimate total RAM from tier config.
 * Uses midpoint of tier range as approximation.
 */
function getRamFromTier(tierConfig: TierConfig): number {
  const { min, max } = tierConfig.ramRange;
  if (max === Infinity) return Math.max(min, 64);
  return (min + max) / 2;
}
