#!/usr/bin/env node
// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import pino from 'pino';

import { loadConfig, loadCostHistory, saveCostHistory } from './config/index.js';
import { detectTier, applyConfigOverrides } from './tiering/detector.js';
import { OllamaClient } from './ollama/client.js';
import { ModelManager } from './ollama/model-manager.js';
import { FIFOQueue } from './queue/fifo-queue.js';
import { CostCalculator } from './cost/calculator.js';
import { loadPricing, DEFAULT_COMPARISON_MODEL } from './cost/pricing.js';
import {
  handleOffloadWork,
  type ToolHandlerContext,
  type OllamaTaskPayload,
} from './tools/offload-work.js';
import { handleCompressContext } from './tools/compress-context.js';
import { handleRecommendModel, type RecommendModelContext } from './tools/recommend-model.js';
import { handlePreloadModel, type PreloadModelContext } from './tools/preload-model.js';
import {
  handleListLoadedModels,
  type ListLoadedModelsContext,
} from './tools/list-loaded-models.js';
import { handlePullModel, type PullModelContext } from './tools/pull-model.js';
import {
  handleConfigureModelSelector,
  type ConfigureModelSelectorContext,
} from './tools/configure-model-selector.js';
import { handleCostDashboard, type CostDashboardContext } from './tools/cost-dashboard.js';
import { handleBatchOffload } from './tools/batch-offload.js';
import { handleGetMetrics, type GetMetricsContext } from './tools/get-metrics.js';
import { handleAutoSetup, type AutoSetupContext } from './tools/auto-setup.js';
import { ExecutionTracker } from './model-selector/execution-tracker.js';
import { BenchmarkStore } from './model-selector/benchmark-db.js';
import { getFullRegistry } from './model-selector/registry.js';
import { TASK_CATEGORIES } from './model-selector/types.js';
import { MetricsCollector } from './metrics/collector.js';
import { PersistenceManager } from './persistence/manager.js';
import { RegistryUpdater } from './model-selector/registry-updater.js';
import type { OllamaChatResponse } from './ollama/client.js';
import type { TierConfig } from './tiering/config.js';

const PACKAGE_VERSION = '0.3.0';

async function main(): Promise<void> {
  // 1. Load config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(
      `[WARN] 設定読み込みエラー: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    config = loadConfig(undefined); // retry with defaults
  }

  // Logger (stderr only - stdout is for MCP protocol)
  const logger = pino(
    {
      level: config.logLevel,
      transport: undefined,
    },
    pino.destination({ fd: 2 }),
  );

  // 2. Detect tier
  let baseTier = detectTier();
  if (config.tier?.forceLevel) {
    baseTier = detectTier(
      config.tier.forceLevel === 1 ? 8 : config.tier.forceLevel === 2 ? 32 : 64,
    );
  }

  const tierConfig: TierConfig = applyConfigOverrides(
    baseTier,
    config.tier
      ? {
          primaryModel: config.tier.primaryModel ?? baseTier.primaryModel,
          fallbackModel:
            config.tier.fallbackModel !== undefined
              ? config.tier.fallbackModel
              : baseTier.fallbackModel,
          contextLimit: config.tier.contextLimit ?? baseTier.contextLimit,
          timeout: config.timeout ?? {},
        }
      : null,
  );

  logger.info(
    { tier: tierConfig.level, name: tierConfig.name, model: tierConfig.primaryModel },
    'Tier detected',
  );

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
        logger.warn(
          { error: modelErr instanceof Error ? modelErr.message : String(modelErr) },
          'Model setup failed',
        );
      }
    }
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Ollama not available at startup',
    );
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
  const costCalculator = new CostCalculator(
    pricing,
    config.cost.comparisonModel ?? DEFAULT_COMPARISON_MODEL,
  );

  const costHistory = loadCostHistory();
  if (costHistory) {
    costCalculator.restoreFromHistory(costHistory);
    logger.info(
      {
        totalSavings: costHistory.totalSavingsUsd,
        totalRequests: costHistory.totalRequests,
      },
      'Cost history restored',
    );
  }

  // 5b. Create ExecutionTracker
  const executionTracker = new ExecutionTracker();

  // 5c. Create BenchmarkStore (DMS-028)
  const benchmarkStore = BenchmarkStore.createFromRegistry([...getFullRegistry()]);

  // 5d. Create MetricsCollector (P5-001)
  const metricsCollector = new MetricsCollector();
  metricsCollector.updateOllamaHealth(ollamaHealthy);

  // 5e. Setup PersistenceManager (P5-002)
  const persistenceManager = new PersistenceManager({
    dataDir: config.persistence.dataDir,
    autoSaveIntervalMs: config.persistence.autoSaveIntervalMs,
  });
  persistenceManager.register({ executionTracker, benchmarkStore, logger });

  if (config.persistence.enabled) {
    await persistenceManager.loadAll();
    persistenceManager.startAutoSave();
    logger.info('Persistence manager started');
  }

  // 5f. Create RegistryUpdater (P6-003)
  const registryUpdater = new RegistryUpdater(ollamaClient, logger, {
    enabled: config.registryUpdater.enabled,
    updateIntervalMs: config.registryUpdater.updateIntervalMs,
  });
  if (config.registryUpdater.enabled && ollamaHealthy) {
    registryUpdater.start();
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
    config, // DMS-016: model selector integration
    executionTracker, // DMS-029: execution tracking
  };

  // recommend_model context
  const recommendModelContext: RecommendModelContext = {
    ollamaClient,
    tierConfig,
    config,
    logger,
    ollamaHealthy,
    benchmarkStore,
  };

  // auto_setup context
  const autoSetupContext: AutoSetupContext = {
    ollamaClient,
    tierConfig,
    config,
    logger,
    ollamaHealthy,
    benchmarkStore,
  };

  // DMS-018: preload_model / list_loaded_models context
  const preloadModelContext: PreloadModelContext = {
    ollamaClient,
    tierConfig,
    config,
    logger,
    ollamaHealthy,
  };
  const listLoadedModelsContext: ListLoadedModelsContext = {
    ollamaClient,
    tierConfig,
    config,
    logger,
    ollamaHealthy,
  };

  // DMS-021: pull_model context
  const pullModelContext: PullModelContext = {
    ollamaClient,
    logger,
    ollamaHealthy,
  };

  // DMS-032: configure_model_selector context
  const configureModelSelectorContext: ConfigureModelSelectorContext = {
    config,
    logger,
  };

  // F-08: cost_dashboard context
  const costDashboardContext: CostDashboardContext = {
    costCalculator,
    executionTracker,
    logger,
  };

  // P5-001: get_metrics context
  const getMetricsContext: GetMetricsContext = {
    metricsCollector,
    logger,
  };

  // Tool definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required: string[];
      };
    }> = [
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
              description:
                'Additional context such as file content or specifications (optional, max 100000 chars)',
            },
            language: {
              type: 'string',
              enum: [
                'typescript',
                'javascript',
                'python',
                'go',
                'rust',
                'java',
                'c',
                'cpp',
                'csharp',
                'ruby',
                'php',
                'swift',
                'kotlin',
                'scala',
                'shell',
                'sql',
                'html',
                'css',
                'markdown',
              ],
              description: 'Programming language (optional)',
            },
            output_format: {
              type: 'string',
              enum: ['code', 'diff', 'explanation', 'raw'],
              description: 'Output format (optional, default: code)',
            },
            model: {
              type: 'string',
              description:
                'Override the Ollama model to use (optional). Takes precedence over category-based selection.',
            },
            category: {
              type: 'string',
              enum: [...TASK_CATEGORIES],
              description:
                'Task category for automatic model selection (optional). Ignored if model is specified.',
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
              description:
                'Target max length of the summary in chars (optional, 100-10000, default: 2000)',
            },
            model: {
              type: 'string',
              description: 'Override the Ollama model to use (optional).',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'cost_dashboard',
        description: 'View cumulative cost savings and model usage statistics.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      // P6-001: batch_offload
      {
        name: 'batch_offload',
        description:
          'Submit multiple coding tasks as a batch to the local LLM. ' +
          'Tasks are processed sequentially or in parallel. Supports partial failure.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  task: { type: 'string', description: 'The task to perform' },
                  language: { type: 'string', description: 'Programming language (optional)' },
                  context: { type: 'string', description: 'Additional context (optional)' },
                  output_format: { type: 'string', enum: ['code', 'diff', 'explanation', 'raw'] },
                  model: { type: 'string', description: 'Model override (optional)' },
                  category: { type: 'string', enum: [...TASK_CATEGORIES] },
                },
                required: ['task'],
              },
              description: 'Array of tasks (1-10)',
            },
            sequential: {
              type: 'boolean',
              description:
                'Process tasks sequentially, passing previous result as context (default: false)',
            },
          },
          required: ['tasks'],
        },
      },
      // P5-001: get_metrics
      {
        name: 'get_metrics',
        description:
          'Get server metrics in Prometheus text format or JSON. ' +
          'Includes request counts, latency, queue stats, cost savings, and health status.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            format: {
              type: 'string',
              enum: ['json', 'prometheus'],
              description: 'Output format (default: json)',
            },
          },
          required: [],
        },
      },
    ];

    // DMS-011: Conditionally expose recommend_model
    if (config.modelSelector.enabled) {
      tools.push({
        name: 'recommend_model',
        description:
          'Recommend the best local LLM model for a given task category based on system specs and installed models. ' +
          'Returns prioritized list with installation status and license info.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string',
              enum: [...TASK_CATEGORIES],
              description:
                'Task category: coding, coding-agent, japanese-text, japanese-coding, translation, summarization, general',
            },
            prefer_quality: {
              type: 'boolean' as const,
              description: 'Prefer quality (true) or speed (false). Default: false',
            },
          },
          required: ['category'],
        },
      });

      // DMS-018: preload_model
      tools.push({
        name: 'preload_model',
        description:
          'Preload a model into VRAM for warm inference. ' +
          'Sends an empty chat request with keep_alive to keep the model loaded during the session.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            model: {
              type: 'string',
              description: 'The model name to preload (must be already installed via pull_model)',
            },
            keep_alive: {
              type: 'string',
              description:
                'Duration to keep the model loaded (optional, default: "-1" = permanent). Examples: "5m", "1h", "-1"',
            },
          },
          required: ['model'],
        },
      });

      // DMS-018: list_loaded_models
      tools.push({
        name: 'list_loaded_models',
        description:
          'List all models currently loaded in VRAM with usage details. ' +
          'Shows VRAM usage, expiry time, and available slots.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      });

      // DMS-021: pull_model
      tools.push({
        name: 'pull_model',
        description:
          'Download a model from the Ollama registry to local storage. ' +
          'Use this to install recommended models before preloading them into VRAM.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            model: {
              type: 'string',
              description: 'Model name to pull (e.g. "qwen3:14b", "devstral:24b")',
            },
          },
          required: ['model'],
        },
      });

      // DMS-032: configure_model_selector
      tools.push({
        name: 'configure_model_selector',
        description:
          'View or modify model selector settings at runtime. ' +
          'Manage blocked models, license filters, and custom model recommendations.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            setting: {
              type: 'string',
              enum: ['blocked_models', 'license_filter', 'custom_recommendations'],
              description: 'Which setting to manage',
            },
            action: {
              type: 'string',
              enum: ['get', 'set', 'add', 'remove'],
              description:
                'Action to perform. "add"/"remove" for blocked_models/license_filter only.',
            },
            values: {
              type: 'array',
              items: { type: 'string' },
              description: 'Values for set/add/remove (for blocked_models and license_filter)',
            },
            custom_config: {
              type: 'object',
              description:
                'Custom recommendations config for "set" action on custom_recommendations. Format: { category: { tier: [modelId, ...] } }',
            },
          },
          required: ['setting', 'action'],
        },
      });

      // auto_setup: recommend → pull → preload in one step
      tools.push({
        name: 'auto_setup',
        description:
          'Automate the full model setup flow: recommend the best model for a task category, ' +
          'download it if needed, and preload it into VRAM — all in one step.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string',
              enum: [...TASK_CATEGORIES],
              description:
                'Task category: coding, coding-agent, japanese-text, japanese-coding, translation, summarization, general. Default: "general"',
            },
            prefer_quality: {
              type: 'boolean' as const,
              description: 'Prefer quality (true) or speed (false). Default: false',
            },
            skip_pull: {
              type: 'boolean' as const,
              description: 'Skip downloading the model if not installed. Default: false',
            },
            skip_preload: {
              type: 'boolean' as const,
              description: 'Skip preloading the model into VRAM. Default: false',
            },
          },
          required: [],
        },
      });
    }

    return { tools };
  });

  // Tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'offload_work':
        return handleOffloadWork(args, toolContext);
      case 'compress_context':
        return handleCompressContext(args, toolContext);
      case 'recommend_model':
        return handleRecommendModel(args ?? {}, recommendModelContext);
      case 'preload_model':
        return handlePreloadModel(args ?? {}, preloadModelContext);
      case 'list_loaded_models':
        return handleListLoadedModels(args ?? {}, listLoadedModelsContext);
      case 'pull_model':
        return handlePullModel(args ?? {}, pullModelContext);
      case 'configure_model_selector':
        return handleConfigureModelSelector(args ?? {}, configureModelSelectorContext);
      case 'cost_dashboard':
        return handleCostDashboard(args ?? {}, costDashboardContext);
      case 'batch_offload':
        return handleBatchOffload(args, toolContext);
      case 'auto_setup':
        return handleAutoSetup(args ?? {}, autoSetupContext);
      case 'get_metrics':
        return handleGetMetrics(args ?? {}, getMetricsContext);
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
    logger.info(
      {
        totalRequests: cumulative.totalRequests,
        totalSavings: cumulative.totalSavingsUsd,
      },
      'Shutting down',
    );

    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
    }

    // P6-003: Stop registry updater
    registryUpdater.stop();

    // P5-002: Save persistence data and stop auto-save
    persistenceManager.stopAutoSave();
    await persistenceManager.saveAll();

    try {
      saveCostHistory(cumulative);
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Failed to save cost history',
      );
    }

    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // 9. Periodic Ollama health check (F-12)
  const HEALTH_CHECK_INTERVAL = 60_000;
  let healthCheckTimer: ReturnType<typeof setInterval> | undefined;

  setTimeout(() => {
    healthCheckTimer = setInterval(async () => {
      try {
        const healthy = await ollamaClient.healthCheck();
        const wasHealthy = toolContext.ollamaHealthy;

        toolContext.ollamaHealthy = healthy;
        recommendModelContext.ollamaHealthy = healthy;
        preloadModelContext.ollamaHealthy = healthy;
        listLoadedModelsContext.ollamaHealthy = healthy;
        pullModelContext.ollamaHealthy = healthy;
        autoSetupContext.ollamaHealthy = healthy;

        // P5-001: Update metrics
        metricsCollector.updateOllamaHealth(healthy);
        metricsCollector.updateQueueLength(queue.getStatus().currentLength);

        if (healthy !== wasHealthy) {
          logger.info(
            { healthy },
            `Ollama health changed: ${wasHealthy ? 'connected → disconnected' : 'disconnected → connected'}`,
          );
        }
      } catch (err) {
        logger.debug(
          { error: err instanceof Error ? err.message : String(err) },
          'Health check failed',
        );
      }
    }, HEALTH_CHECK_INTERVAL);
  }, 30_000);

  // 10. Startup message
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
