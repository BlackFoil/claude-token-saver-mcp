// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OllamaClient, OllamaChatResponse, OllamaChatRequest } from '../ollama/client.js';
import type { FIFOQueue } from '../queue/fifo-queue.js';
import type { CostCalculator } from '../cost/calculator.js';
import type { TierConfig } from '../tiering/config.js';
import { validateOffloadWorkInput, type OffloadWorkInput } from '../validators/input-validator.js';
import { detectPromptInjection, sanitizeOutput } from '../validators/prompt-guard.js';
import { ctsErrorToCallToolResult, CTSError } from '../errors.js';
import { reportCost } from '../cost/reporter.js';
import { SYSTEM_PROMPT } from '../ollama/client.js';
import type { Logger } from 'pino';

export interface ToolHandlerContext {
  ollamaClient: OllamaClient;
  queue: FIFOQueue<OllamaTaskPayload, OllamaChatResponse>;
  tierConfig: TierConfig;
  costCalculator: CostCalculator;
  logger: Logger;
  ollamaHealthy: boolean;
  maxRequestSizeBytes: number;
}

export interface OllamaTaskPayload {
  request: OllamaChatRequest;
  tierConfig: TierConfig;
}

function formatUserPrompt(input: OffloadWorkInput): string {
  const parts: string[] = [];
  if (input.language) parts.push(`Language: ${input.language}`);
  if (input.output_format) parts.push(`Output format: ${input.output_format}`);
  parts.push(`Task: ${input.task}`);
  if (input.context) {
    parts.push('---');
    parts.push(`Context:\n${input.context}`);
  }
  return parts.join('\n');
}

function createFallbackResponse(reason: string, task: string, errorMessage: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `[FALLBACK_TO_CLOUD] ${reason}: ${errorMessage}\n\nOriginal task (process directly):\n${task}`,
      },
    ],
    isError: true,
  };
}

export async function handleOffloadWork(
  rawInput: unknown,
  context: ToolHandlerContext,
): Promise<CallToolResult> {
  const { ollamaClient, queue, tierConfig, costCalculator, logger, maxRequestSizeBytes } = context;

  try {
    // Step 1: Ollama availability check
    if (!context.ollamaHealthy) {
      const recheck = await ollamaClient.healthCheck();
      if (!recheck) {
        const task = typeof rawInput === 'object' && rawInput !== null && 'task' in rawInput
          ? String((rawInput as { task: unknown }).task)
          : '';
        return createFallbackResponse(
          'OLLAMA_UNREACHABLE',
          task,
          'Ollama is not available. Process this task directly.',
        );
      }
      context.ollamaHealthy = true;
    }

    // Step 2: Input validation
    const validated = validateOffloadWorkInput(rawInput, maxRequestSizeBytes);
    const input = validated.input;

    // Step 3: Prompt injection check
    const combinedText = input.task + (input.context ?? '');
    const piResult = detectPromptInjection(combinedText);
    if (piResult.blocked) {
      logger.error({ threats: piResult.threats }, 'PI blocked in offload_work');
      return {
        content: [
          {
            type: 'text',
            text: `[CTS-5001] プロンプトインジェクションの疑いを検出しました: ${piResult.threats.map((t) => t.category).join(', ')}`,
          },
        ],
        isError: true,
      };
    }

    // Step 5: Build chat messages
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: formatUserPrompt(input) },
    ];

    // Step 6-7: Enqueue and process
    const payload: OllamaTaskPayload = {
      request: {
        model: tierConfig.primaryModel,
        messages,
        stream: true as const,
        options: {
          num_ctx: tierConfig.contextLimit,
          temperature: 0.1,
        },
      },
      tierConfig,
    };

    let ollamaResponse: OllamaChatResponse;
    try {
      ollamaResponse = await queue.enqueue(
        payload,
        validated.totalBytes,
      );
    } catch (queueError) {
      if (queueError instanceof CTSError) {
        return createFallbackResponse(
          'QUEUE_ERROR',
          input.task,
          queueError.message,
        );
      }
      throw queueError;
    }

    // Step 8: Cost calculation
    const costResult = costCalculator.calculateSavings({
      inputTokens: ollamaResponse.inputTokens,
      outputTokens: ollamaResponse.outputTokens,
      tool: 'offload_work',
    });

    // Step 9: Log to stderr
    reportCost(costResult, 'offload_work');
    logger.info({
      tool: 'offload_work',
      model: ollamaResponse.model,
      inputTokens: ollamaResponse.inputTokens,
      outputTokens: ollamaResponse.outputTokens,
      durationMs: ollamaResponse.totalDurationMs,
      savingsUsd: costResult.savingsUsd,
    }, 'offload_work completed');

    // Sanitize output
    const sanitized = sanitizeOutput(ollamaResponse.text);
    if (sanitized.redactionCount > 0) {
      logger.warn({
        detectedCategories: sanitized.detectedCategories,
        redactionCount: sanitized.redactionCount,
      }, 'Sensitive info redacted from LLM output');
    }

    // Step 10: Build response
    const meta = [
      `Model: ${ollamaResponse.model}`,
      `Tokens: ${ollamaResponse.inputTokens} in / ${ollamaResponse.outputTokens} out`,
      `Duration: ${Math.round(ollamaResponse.totalDurationMs)}ms`,
      `Savings: $${costResult.savingsUsd.toFixed(4)} (cumulative: $${costResult.cumulativeSavingsUsd.toFixed(4)})`,
    ].join(' | ');

    return {
      content: [
        {
          type: 'text',
          text: `${sanitized.sanitized}\n\n---\n${meta}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof CTSError) {
      if (error.fallbackToCloud) {
        const task = typeof rawInput === 'object' && rawInput !== null && 'task' in rawInput
          ? String((rawInput as { task: unknown }).task)
          : '';
        return createFallbackResponse('ERROR', task, error.message);
      }
      return ctsErrorToCallToolResult(error);
    }
    return ctsErrorToCallToolResult(error);
  }
}
