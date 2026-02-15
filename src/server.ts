#!/usr/bin/env node
// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pino from 'pino';

import { loadConfig, loadCostHistory, saveCostHistory } from './config/index.js';
import { detectTier, applyConfigOverrides } from './tiering/detector.js';
import { OllamaClient } from './ollama/client.js';
import { ModelManager } from './ollama/model-manager.js';
import { FIFOQueue } from './queue/fifo-queue.js';
import { CostCalculator } from './cost/calculator.js';
import { loadPricing, DEFAULT_COMPARISON_MODEL } from './cost/pricing.js';
import { handleOffloadWork, type ToolHandlerContext, type OllamaTaskPayload } from './tools/offload-work.js';
import { handleCompressContext } from './tools/compress-context.js';
import type { OllamaChatResponse } from './ollama/client.js';
import type { TierConfig } from './tiering/config.js';

const PACKAGE_VERSION = '0.1.0';

async function main(): Promise<void> {
  // 1. Load config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`[WARN] 設定読み込みエラー: ${err instanceof Error ? err.message : String(err)}\n`);
    config = loadConfig(undefined); // retry with defaults
  }

  // Logger (stderr only - stdout is for MCP protocol)
  const logger = pino({
    level: config.logLevel,
    transport: undefined,
  }, pino.destination({ fd: 2 }));

  // 2. Detect tier
  let baseTier = detectTier();
  if (config.tier?.forceLevel) {
    baseTier = detectTier(
      config.tier.forceLevel === 1 ? 8 :
      config.tier.forceLevel === 2 ? 32 : 64,
    );
  }

  const tierConfig: TierConfig = applyConfigOverrides(baseTier, config.tier ? {
    primaryModel: config.tier.primaryModel ?? baseTier.primaryModel,
    fallbackModel: config.tier.fallbackModel !== undefined ? config.tier.fallbackModel : baseTier.fallbackModel,
    contextLimit: config.tier.contextLimit ?? baseTier.contextLimit,
    timeout: config.timeout ?? {},
  } : null);

  logger.info({ tier: tierConfig.level, name: tierConfig.name, model: tierConfig.primaryModel }, 'Tier detected');

  // 3. Create OllamaClient and check health
  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    requestTimeout: tierConfig.timeout.requestTimeout,
    heartbeatTimeout: tierConfig.timeout.heartbeatTimeout,
    firstTokenTimeout: tierConfig.timeout.firstTokenTimeout,
  });

  let ollamaHealthy = false;
  try {
    ollamaHealthy = await ollamaClient.healthCheck();
    if (ollamaHealthy) {
      const version = await ollamaClient.getVersion();
      logger.info({ version }, 'Ollama connected');

      // Try to ensure model is available
      const modelManager = new ModelManager(ollamaClient);
      try {
        const modelName = await modelManager.ensureModelAvailable(tierConfig);
        if (modelName !== tierConfig.primaryModel) {
          logger.info({ model: modelName }, 'Using fallback model');
        }
      } catch (modelErr) {
        logger.warn({ error: modelErr instanceof Error ? modelErr.message : String(modelErr) }, 'Model setup failed');
      }
    }
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Ollama not available at startup');
  }

  // 4. Create FIFO Queue
  const queue = new FIFOQueue<OllamaTaskPayload, OllamaChatResponse>(
    {
      maxQueueLength: config.queue.maxQueueLength,
      maxRequestSizeBytes: config.queue.maxRequestSizeBytes,
      queueTimeoutMs: config.queue.queueTimeoutMs,
    },
    async (payload) => {
      return ollamaClient.chat(payload.request);
    },
  );

  // 5. Create CostCalculator
  const pricing = loadPricing(config.cost.pricing);
  const costCalculator = new CostCalculator(pricing, config.cost.comparisonModel ?? DEFAULT_COMPARISON_MODEL);

  const costHistory = loadCostHistory();
  if (costHistory) {
    costCalculator.restoreFromHistory(costHistory);
    logger.info({
      totalSavings: costHistory.totalSavingsUsd,
      totalRequests: costHistory.totalRequests,
    }, 'Cost history restored');
  }

  // 6. Create MCP Server and register tools
  const server = new Server(
    {
      name: 'claude-token-saver-mcp',
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const toolContext: ToolHandlerContext = {
    ollamaClient,
    queue,
    tierConfig,
    costCalculator,
    logger,
    ollamaHealthy,
    maxRequestSizeBytes: config.queue.maxRequestSizeBytes,
  };

  // Tool definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'offload_work',
        description:
          'Offload coding/text tasks to a local LLM (Ollama) to save Claude API tokens. ' +
          'Use for code generation, refactoring, formatting, boilerplate, and other routine tasks.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            task: {
              type: 'string',
              description: 'The task to perform (required, max 50000 chars)',
            },
            context: {
              type: 'string',
              description: 'Additional context such as file content or specifications (optional, max 100000 chars)',
            },
            language: {
              type: 'string',
              enum: [
                'typescript', 'javascript', 'python', 'go', 'rust',
                'java', 'c', 'cpp', 'csharp', 'ruby', 'php', 'swift',
                'kotlin', 'scala', 'shell', 'sql', 'html', 'css', 'markdown',
              ],
              description: 'Programming language (optional)',
            },
            output_format: {
              type: 'string',
              enum: ['code', 'diff', 'explanation', 'raw'],
              description: 'Output format (optional, default: code)',
            },
          },
          required: ['task'],
        },
      },
      {
        name: 'compress_context',
        description:
          'Compress/summarize large text content using a local LLM to reduce cloud token usage. ' +
          'Use for summarizing logs, large files, or verbose context before sending to Claude.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            content: {
              type: 'string',
              description: 'The content to compress/summarize (required, max 200000 chars)',
            },
            focus: {
              type: 'string',
              description: 'What to focus on in the summary (optional, max 500 chars)',
            },
            max_length: {
              type: 'number',
              description: 'Target max length of the summary in chars (optional, 100-10000, default: 2000)',
            },
          },
          required: ['content'],
        },
      },
    ],
  }));

  // Tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'offload_work':
        return handleOffloadWork(args, toolContext);
      case 'compress_context':
        return handleCompressContext(args, toolContext);
      default:
        return {
          content: [
            {
              type: 'text' as const,
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  });

  // 7. Setup transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 8. Shutdown handler
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    const cumulative = costCalculator.getCumulativeSavings();
    logger.info({
      totalRequests: cumulative.totalRequests,
      totalSavings: cumulative.totalSavingsUsd,
    }, 'Shutting down');

    try {
      saveCostHistory(cumulative);
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to save cost history');
    }

    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // 9. Startup message
  process.stderr.write(
    `[claude-token-saver-mcp v${PACKAGE_VERSION}] ` +
    `Tier ${tierConfig.level} (${tierConfig.name}) | ` +
    `Model: ${tierConfig.primaryModel} | ` +
    `Ollama: ${ollamaHealthy ? 'connected' : 'not available'}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[FATAL] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
