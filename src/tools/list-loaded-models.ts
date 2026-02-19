// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

/**
 * list_loaded_models MCP Tool Handler (DMS-015)
 * Design: docs/design/dynamic-model-selector-design.md §4.5
 *
 * Lists models currently loaded in VRAM with usage details.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OllamaClient } from '../ollama/client.js';
import type { TierConfig } from '../tiering/config.js';
import type { AppConfig } from '../config/schema.js';
import type { Logger } from 'pino';
import { ctsErrorToCallToolResult, CTSError } from '../errors.js';
import { calculateVramCapacity } from '../model-selector/vram-calculator.js';

export interface ListLoadedModelsContext {
  ollamaClient: OllamaClient;
  tierConfig: TierConfig;
  config: AppConfig;
  logger: Logger;
  ollamaHealthy: boolean;
}

/**
 * Handle list_loaded_models tool call.
 */
export async function handleListLoadedModels(
  _args: Record<string, unknown>,
  ctx: ListLoadedModelsContext,
): Promise<CallToolResult> {
  try {
    // Check Ollama health
    if (!ctx.ollamaHealthy) {
      const recheck = await ctx.ollamaClient.healthCheck();
      if (!recheck) {
        return {
          content: [{ type: 'text', text: '[CTS-1001] Ollama is not available.' }],
          isError: true,
        };
      }
      ctx.ollamaHealthy = true;
    }

    const psResult = await ctx.ollamaClient.listRunning();
    const totalRamGB = getRamFromTier(ctx.tierConfig);
    const vram = calculateVramCapacity(totalRamGB, ctx.config.modelSelector.maxSimultaneousModels);

    if (psResult.models.length === 0) {
      const lines = [
        '## Loaded Models',
        '',
        'No models currently loaded in VRAM.',
        '',
        `**Slots:** 0/${vram.maxSimultaneousModels} used`,
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    }

    // Build Markdown table
    const lines: string[] = [
      '## Loaded Models',
      '',
      '| # | Model | VRAM | Expires | Size |',
      '|:---:|:---|:---:|:---|:---:|',
    ];

    let totalVramBytes = 0;

    for (let i = 0; i < psResult.models.length; i++) {
      const m = psResult.models[i]!;
      const vramGB = (m.size_vram / (1024 ** 3)).toFixed(1);
      const sizeGB = (m.size / (1024 ** 3)).toFixed(1);
      totalVramBytes += m.size_vram;

      // Format expiry
      let expiresStr: string;
      try {
        const expiresAt = new Date(m.expires_at);
        const now = new Date();
        if (expiresAt.getFullYear() > 9000) {
          expiresStr = 'permanent';
        } else {
          const diffMs = expiresAt.getTime() - now.getTime();
          if (diffMs > 0) {
            const diffMin = Math.round(diffMs / 60_000);
            expiresStr = diffMin > 60 ? `${Math.round(diffMin / 60)}h` : `${diffMin}m`;
          } else {
            expiresStr = 'expired';
          }
        }
      } catch {
        expiresStr = 'unknown';
      }

      lines.push(`| ${i + 1} | ${m.name} | ${vramGB} GB | ${expiresStr} | ${sizeGB} GB |`);
    }

    const totalVramGB = (totalVramBytes / (1024 ** 3)).toFixed(1);
    const estimatedAvailableGB = vram.estimatedVramGB.toFixed(0);

    lines.push('');
    lines.push(`**VRAM Total:** ${totalVramGB} GB / ~${estimatedAvailableGB} GB available`);
    lines.push(`**Slots:** ${psResult.models.length}/${vram.maxSimultaneousModels} used`);

    ctx.logger.info({ loadedModels: psResult.models.length }, 'list_loaded_models completed');

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
