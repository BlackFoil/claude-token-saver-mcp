// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

/**
 * auto_setup MCP Tool Handler
 *
 * Automates the full model setup flow: recommend → pull → preload in one step.
 * Selects the best model for a given task category and system configuration,
 * downloads it if needed, and preloads it into VRAM for immediate inference.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OllamaClient } from '../ollama/client.js';
import type { TierConfig } from '../tiering/config.js';
import type { AppConfig } from '../config/schema.js';
import type { BenchmarkStore } from '../model-selector/benchmark-db.js';
import type { Logger } from 'pino';
import type { TierLevel } from '../tiering/config.js';
import { TASK_CATEGORIES, type TaskCategory } from '../model-selector/types.js';
import { recommendModels } from '../model-selector/recommender.js';
import { ctsErrorToCallToolResult, CTSError, InvalidConfigError } from '../errors.js';

export interface AutoSetupContext {
  ollamaClient: OllamaClient;
  tierConfig: TierConfig;
  config: AppConfig;
  logger: Logger;
  ollamaHealthy: boolean;
  benchmarkStore?: BenchmarkStore;
}

interface AutoSetupInput {
  category: TaskCategory;
  preferQuality: boolean;
  skipPull: boolean;
  skipPreload: boolean;
}

function validateInput(args: Record<string, unknown>): AutoSetupInput {
  const rawCategory = args['category'] ?? 'general';
  if (typeof rawCategory !== 'string' || !TASK_CATEGORIES.includes(rawCategory as TaskCategory)) {
    throw new InvalidConfigError(
      'category',
      `Invalid category "${String(rawCategory)}". Must be one of: ${TASK_CATEGORIES.join(', ')}`,
    );
  }

  const preferQuality = args['prefer_quality'];
  if (preferQuality !== undefined && typeof preferQuality !== 'boolean') {
    throw new InvalidConfigError('prefer_quality', 'Must be a boolean');
  }

  const skipPull = args['skip_pull'];
  if (skipPull !== undefined && typeof skipPull !== 'boolean') {
    throw new InvalidConfigError('skip_pull', 'Must be a boolean');
  }

  const skipPreload = args['skip_preload'];
  if (skipPreload !== undefined && typeof skipPreload !== 'boolean') {
    throw new InvalidConfigError('skip_preload', 'Must be a boolean');
  }

  return {
    category: rawCategory as TaskCategory,
    preferQuality: (preferQuality as boolean | undefined) ?? false,
    skipPull: (skipPull as boolean | undefined) ?? false,
    skipPreload: (skipPreload as boolean | undefined) ?? false,
  };
}

const TIER_NAMES: Record<TierLevel, string> = {
  1: 'Light',
  2: 'Standard',
  3: 'Ultra',
};

/**
 * Handle auto_setup tool call.
 */
export async function handleAutoSetup(
  args: Record<string, unknown>,
  ctx: AutoSetupContext,
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
    const { category, preferQuality, skipPull, skipPreload } = input;

    // Step 0: Check Ollama health
    if (!ctx.ollamaHealthy) {
      const recheck = await ctx.ollamaClient.healthCheck();
      if (!recheck) {
        return {
          content: [{
            type: 'text',
            text: '[CTS-1001] Ollama is not available. Cannot run auto_setup.\n\n' +
              '**To fix:**\n' +
              '1. Install Ollama: https://ollama.com/download\n' +
              '2. Start the server: `ollama serve`\n' +
              '3. Retry `auto_setup`',
          }],
          isError: true,
        };
      }
      ctx.ollamaHealthy = true;
    }

    // Step 1: Get installed and loaded models
    let installedModels: string[] = [];
    let loadedModels: string[] = [];
    const installedModelSizes = new Map<string, number>();

    try {
      const [tagsResult, psResult] = await Promise.all([
        ctx.ollamaClient.listModelsFull(),
        ctx.ollamaClient.listRunning(),
      ]);
      installedModels = tagsResult.models.map((m) => m.name);
      loadedModels = psResult.models.map((m) => m.name);
      for (const m of tagsResult.models) {
        installedModelSizes.set(m.name, m.size);
      }
    } catch (err) {
      ctx.logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'auto_setup: Failed to query Ollama models, proceeding without install status',
      );
    }

    // Step 2: Get system info
    const totalRamGB = getRamFromTier(ctx.tierConfig);

    // Step 3: Run recommendation engine
    const output = recommendModels({
      category,
      preferQuality: preferQuality || ctx.config.modelSelector.preferQuality,
      totalRamGB,
      installedModels,
      loadedModels,
      blockedModels: ctx.config.modelSelector.blockedModels,
      licenseFilter: ctx.config.modelSelector.licenseFilter,
      maxSimultaneousModels: ctx.config.modelSelector.maxSimultaneousModels,
      benchmarkStore: ctx.benchmarkStore,
    });

    // Step 4: Pick the #1 recommendation
    if (output.recommendations.length === 0) {
      return {
        content: [{
          type: 'text',
          text: '## Auto Setup Failed\n\n' +
            `No models found for category "${category}" on Tier ${output.tier} (${TIER_NAMES[output.tier]}).\n\n` +
            '**Possible causes:**\n' +
            '- All candidate models are in the blocked list\n' +
            '- License filter is too restrictive\n' +
            '- No models registered for this tier/category combination\n\n' +
            'Use `configure_model_selector` to check blocked_models and license_filter settings.',
        }],
        isError: true,
      };
    }

    const top = output.recommendations[0]!;
    const selectedModel = top.recommendation;
    const modelId = selectedModel.modelId;

    // Build step results
    const steps: string[] = [];
    const benchStr = formatBenchmarks(selectedModel.benchmarks);

    // Step result 1: Recommendation
    steps.push(`1. Model recommended — ${modelId} (priority #1 for ${category}/Tier ${output.tier})`);

    // Step 5: Pull if not installed
    let wasInstalled = top.installed;
    let pullSizeStr = '';
    let pullFailed = false;
    let pullError = '';

    if (!wasInstalled && !skipPull) {
      try {
        ctx.logger.info({ model: modelId }, 'auto_setup: pulling model');
        const pullResult = await ctx.ollamaClient.pullModel(modelId);
        wasInstalled = true;
        if (pullResult.alreadyUpToDate) {
          pullSizeStr = 'already up to date';
        } else {
          pullSizeStr = `${(pullResult.sizeBytes / (1024 ** 3)).toFixed(1)} GB downloaded in ${(pullResult.durationMs / 1000).toFixed(1)}s`;
        }
        steps.push(`2. Pulled from registry (${pullSizeStr})`);
      } catch (err) {
        pullFailed = true;
        pullError = err instanceof Error ? err.message : String(err);
        ctx.logger.warn({ model: modelId, error: pullError }, 'auto_setup: pull failed');
        steps.push(`2. Pull failed — ${pullError}`);
      }
    } else if (wasInstalled) {
      const sizeBytes = installedModelSizes.get(modelId);
      const sizeStr = sizeBytes ? `${(sizeBytes / (1024 ** 3)).toFixed(1)} GB` : '';
      steps.push(`2. Already installed${sizeStr ? ` (${sizeStr})` : ''}`);
    } else {
      steps.push('2. Skipped pull (skip_pull=true)');
    }

    // Step 6: Preload if not loaded
    let wasLoaded = top.loaded;
    let preloadFailed = false;
    let preloadError = '';

    if (wasInstalled && !wasLoaded && !skipPreload && !pullFailed) {
      try {
        ctx.logger.info({ model: modelId }, 'auto_setup: preloading model');
        await ctx.ollamaClient.chat({
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          stream: true,
          options: {
            num_predict: 1,
          },
        });
        wasLoaded = true;
        steps.push('3. Preloaded into VRAM — ready for inference');
      } catch (err) {
        preloadFailed = true;
        preloadError = err instanceof Error ? err.message : String(err);
        ctx.logger.warn({ model: modelId, error: preloadError }, 'auto_setup: preload failed');
        steps.push(`3. Preload failed — ${preloadError}`);
      }
    } else if (wasLoaded) {
      steps.push('3. Already loaded in VRAM — ready for inference');
    } else if (skipPreload) {
      steps.push('3. Skipped preload (skip_preload=true)');
    } else if (pullFailed) {
      steps.push('3. Skipped preload (pull failed)');
    } else if (!wasInstalled) {
      steps.push('3. Skipped preload (model not installed)');
    }

    // Build final response
    const lines: string[] = [
      '## Auto Setup Complete',
      '',
      `**System:** Tier ${output.tier} (${TIER_NAMES[output.tier]}) — ${Math.round(totalRamGB)}GB RAM`,
      `**Category:** ${category}`,
      `**Selected Model:** ${modelId}${benchStr ? ` (${benchStr})` : ''}`,
    ];

    if (output.vramFallback) {
      lines.push('');
      lines.push('> **Note:** VRAM constraints limit to 1 model. Selected general-purpose model for versatility.');
    }

    lines.push('');
    lines.push('### Setup Steps');
    for (const step of steps) {
      lines.push(step);
    }

    // Usage instructions
    lines.push('');
    lines.push('### Usage');
    if (wasInstalled && wasLoaded) {
      lines.push(`This model will be automatically used when you specify \`category: "${category}"\` in \`offload_work\`.`);
      lines.push(`You can also use it directly: \`offload_work(task="...", model="${modelId}")\``);
    } else if (wasInstalled && !wasLoaded) {
      lines.push(`Model is installed but not preloaded. Use \`preload_model(model="${modelId}")\` to load it into VRAM.`);
    } else {
      lines.push(`Model is not yet installed. Use \`pull_model(model="${modelId}")\` to download it first.`);
    }

    // Add warnings for partial success
    if (pullFailed || preloadFailed) {
      lines.push('');
      lines.push('### Warnings');
      if (pullFailed) {
        lines.push(`- Pull failed: ${pullError}`);
      }
      if (preloadFailed) {
        lines.push(`- Preload failed: ${preloadError}`);
      }
    }

    ctx.logger.info({
      category,
      tier: output.tier,
      model: modelId,
      wasInstalled: top.installed,
      wasLoaded: top.loaded,
      pulled: !top.installed && wasInstalled,
      preloaded: !top.loaded && wasLoaded,
      pullFailed,
      preloadFailed,
    }, 'auto_setup completed');

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

/**
 * Estimate total RAM from tier config.
 */
function getRamFromTier(tierConfig: TierConfig): number {
  const { min, max } = tierConfig.ramRange;
  if (max === Infinity) return Math.max(min, 64);
  return (min + max) / 2;
}

/**
 * Format benchmark scores as a compact string.
 */
function formatBenchmarks(benchmarks: { humanEval?: number; sweBench?: number; japaneseMTBench?: number }): string {
  const parts: string[] = [];
  if (benchmarks.humanEval !== undefined) {
    parts.push(`HumanEval: ${benchmarks.humanEval}%`);
  }
  if (benchmarks.sweBench !== undefined) {
    parts.push(`SWE-Bench: ${benchmarks.sweBench}%`);
  }
  if (benchmarks.japaneseMTBench !== undefined) {
    parts.push(`JP-MT: ${benchmarks.japaneseMTBench}`);
  }
  return parts.join(', ');
}
