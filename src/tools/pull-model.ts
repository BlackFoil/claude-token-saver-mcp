// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * pull_model MCP Tool Handler (DMS-020)
 * Design: docs/design/dynamic-model-selector-design.md §7.1
 *
 * Downloads a model from the Ollama registry to local storage.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OllamaClient } from '../ollama/client.js';
import type { Logger } from 'pino';
import { ctsErrorToCallToolResult, CTSError, InvalidConfigError } from '../errors.js';

export interface PullModelContext {
  ollamaClient: OllamaClient;
  logger: Logger;
  ollamaHealthy: boolean;
}

/**
 * Handle pull_model tool call.
 */
export async function handlePullModel(
  args: Record<string, unknown>,
  ctx: PullModelContext,
): Promise<CallToolResult> {
  try {
    // Validate input
    const model = args['model'];
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new InvalidConfigError('model', 'model is required and must be a non-empty string');
    }

    // Check Ollama health
    if (!ctx.ollamaHealthy) {
      const recheck = await ctx.ollamaClient.healthCheck();
      if (!recheck) {
        return {
          content: [{ type: 'text', text: '[CTS-1001] Ollama is not available. Cannot pull model.' }],
          isError: true,
        };
      }
      ctx.ollamaHealthy = true;
    }

    // Pull model via Ollama API
    ctx.logger.info({ model }, 'pull_model: starting pull');
    const pullResult = await ctx.ollamaClient.pullModel(model);

    // Format response
    if (pullResult.alreadyUpToDate) {
      const lines = [
        `Model "${model}" is already up to date.`,
        '',
        `**Model:** ${pullResult.modelName}`,
        `**Status:** already installed, no download needed`,
      ];
      ctx.logger.info({ model }, 'pull_model: already up to date');
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    }

    const sizeGB = (pullResult.sizeBytes / (1024 ** 3)).toFixed(1);
    const durationSec = (pullResult.durationMs / 1000).toFixed(1);

    const lines = [
      `Model "${model}" pulled successfully.`,
      '',
      `**Model:** ${pullResult.modelName}`,
      `**Size:** ${sizeGB} GB`,
      `**Duration:** ${durationSec}s`,
      `**Status:** ready (use \`preload_model\` to load into VRAM)`,
    ];

    ctx.logger.info({ model, sizeGB, durationSec }, 'pull_model: completed');

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
