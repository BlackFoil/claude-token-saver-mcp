// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

/**
 * preload_model MCP Tool Handler (DMS-014)
 * Design: docs/design/dynamic-model-selector-design.md §4.4
 *
 * Preloads a model into VRAM for warm inference during the session.
 * Sends an empty chat request with keep_alive to keep the model loaded.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OllamaClient } from '../ollama/client.js';
import type { TierConfig } from '../tiering/config.js';
import type { AppConfig } from '../config/schema.js';
import type { Logger } from 'pino';
import { ctsErrorToCallToolResult, CTSError, ModelNotFoundError, InvalidConfigError } from '../errors.js';
import { calculateVramCapacity } from '../model-selector/vram-calculator.js';

export interface PreloadModelContext {
  ollamaClient: OllamaClient;
  tierConfig: TierConfig;
  config: AppConfig;
  logger: Logger;
  ollamaHealthy: boolean;
}

/**
 * Handle preload_model tool call.
 */
export async function handlePreloadModel(
  args: Record<string, unknown>,
  ctx: PreloadModelContext,
): Promise<CallToolResult> {
  try {
    // Validate input
    const model = args['model'];
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new InvalidConfigError('model', 'model is required and must be a non-empty string');
    }

    const keepAlive = typeof args['keep_alive'] === 'string'
      ? args['keep_alive']
      : ctx.config.modelSelector.preloadKeepAlive;

    // Check Ollama health
    if (!ctx.ollamaHealthy) {
      const recheck = await ctx.ollamaClient.healthCheck();
      if (!recheck) {
        return {
          content: [{ type: 'text', text: '[CTS-1001] Ollama is not available. Cannot preload model.' }],
          isError: true,
        };
      }
      ctx.ollamaHealthy = true;
    }

    // Check if model is installed
    const tags = await ctx.ollamaClient.listModelsFull();
    const installedNames = tags.models.map((m) => m.name);
    if (!installedNames.includes(model)) {
      throw new ModelNotFoundError(
        `Model "${model}" is not installed. Use pull_model to download it first.`,
      );
    }

    // Check VRAM constraints
    const totalRamGB = getRamFromTier(ctx.tierConfig);
    const vram = calculateVramCapacity(totalRamGB, ctx.config.modelSelector.maxSimultaneousModels);
    const currentlyLoaded = await ctx.ollamaClient.listRunning();
    const loadedCount = currentlyLoaded.models.length;

    // Skip constraint check if model is already loaded
    const alreadyLoaded = currentlyLoaded.models.some((m) => m.name === model);
    if (!alreadyLoaded && loadedCount >= vram.maxSimultaneousModels) {
      return {
        content: [{
          type: 'text',
          text: `[CTS-4001] Cannot preload "${model}": ${loadedCount}/${vram.maxSimultaneousModels} model slots used.\n` +
            `Currently loaded: ${currentlyLoaded.models.map((m) => m.name).join(', ')}\n` +
            `Unload a model or increase MAX_SIMULTANEOUS_MODELS to proceed.`,
        }],
        isError: true,
      };
    }

    // Send empty chat request to load model into VRAM
    await ctx.ollamaClient.chat({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      stream: true,
      options: {
        num_predict: 1,
      },
    });

    // Verify load via /api/ps
    const psAfter = await ctx.ollamaClient.listRunning();
    const loadedModel = psAfter.models.find((m) => m.name === model);

    const vramUsageGB = loadedModel
      ? (loadedModel.size_vram / (1024 ** 3)).toFixed(1)
      : 'unknown';

    const totalLoadedNow = psAfter.models.length;

    const lines = [
      'Model preloaded successfully.',
      '',
      `**Model:** ${model}`,
      `**VRAM Usage:** ~${vramUsageGB} GB`,
      `**Keep Alive:** ${keepAlive === '-1' ? 'permanent (until offload or server restart)' : keepAlive}`,
      `**Status:** ready for inference`,
      '',
      `Currently loaded models: ${totalLoadedNow}/${vram.maxSimultaneousModels} (max for this system)`,
    ];

    ctx.logger.info({ model, vramUsageGB, keepAlive }, 'preload_model completed');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    if (error instanceof CTSError) {
      return ctsErrorToCallToolResult(error);
    }
    return ctsErrorToCallToolResult(error);
  }
}

function getRamFromTier(tierConfig: TierConfig): number {
  const { min, max } = tierConfig.ramRange;
  if (max === Infinity) return Math.max(min, 64);
  return (min + max) / 2;
}
