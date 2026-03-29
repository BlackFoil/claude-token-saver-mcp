// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OllamaChatResponse } from '../ollama/client.js';
import { validateCompressContextInput } from '../validators/input-validator.js';
import { detectPromptInjection, sanitizeOutput } from '../validators/prompt-guard.js';
import { ctsErrorToCallToolResult, CTSError } from '../errors.js';
import { reportCost } from '../cost/reporter.js';
import { SYSTEM_PROMPT } from '../ollama/client.js';
import type { TaskCategory } from '../model-selector/types.js';
import type { ToolHandlerContext, OllamaTaskPayload } from './offload-work.js';

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3);
}

function truncateByTokens(text: string, maxTokens: number): string {
  const estimated = estimateTokenCount(text);
  if (estimated <= maxTokens) return text;

  // Calculate approx char position (3 chars/token)
  const maxChars = maxTokens * 3;
  let cutPos = Math.min(maxChars, text.length);

  // Adjust to word boundary
  const nextSpace = text.indexOf(' ', cutPos);
  const prevSpace = text.lastIndexOf(' ', cutPos);
  if (prevSpace > cutPos * 0.8) {
    cutPos = prevSpace;
  } else if (nextSpace !== -1 && nextSpace < cutPos * 1.1) {
    cutPos = nextSpace;
  }

  return text.substring(0, cutPos);
}

function buildCompressPrompt(
  content: string,
  focus?: string,
  maxLength?: number,
): string {
  const parts: string[] = ['Summarize the following content.'];
  if (focus) parts.push(`Focus on: ${focus}`);
  if (maxLength) parts.push(`Target maximum length: ${maxLength} characters.`);
  parts.push('');
  parts.push('---');
  parts.push('Content:');
  parts.push(content);
  return parts.join('\n');
}

function createFallbackResponse(reason: string, errorMessage: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `[FALLBACK_TO_CLOUD] ${reason}: ${errorMessage}`,
      },
    ],
    isError: true,
  };
}

export async function handleCompressContext(
  rawInput: unknown,
  context: ToolHandlerContext,
): Promise<CallToolResult> {
  const { ollamaClient, queue, tierConfig, costCalculator, logger, maxRequestSizeBytes } = context;

  const startTime = Date.now();
  try {
    // Step 1: Ollama availability check
    if (!context.ollamaHealthy) {
      const recheck = await ollamaClient.healthCheck();
      if (!recheck) {
        return createFallbackResponse(
          'OLLAMA_UNREACHABLE',
          'Ollama is not available. Process this task directly.',
        );
      }
      context.ollamaHealthy = true;
    }

    // Step 2: Input validation
    const validated = validateCompressContextInput(
      rawInput,
      maxRequestSizeBytes,
      tierConfig.contextLimit,
    );
    const input = validated.input;

    // Step 3: Prompt injection check
    const checkText = input.content + (input.focus ?? '');
    const piResult = detectPromptInjection(checkText);
    if (piResult.blocked) {
      logger.error({ threats: piResult.threats }, 'PI blocked in compress_context');
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

    // DMS-017: Resolve model override
    const rawArgs = typeof rawInput === 'object' && rawInput !== null
      ? rawInput as Record<string, unknown> : {};
    const modelOverride = typeof rawArgs['model'] === 'string' && rawArgs['model'].trim()
      ? rawArgs['model'].trim() : undefined;
    const effectiveModel = modelOverride ?? tierConfig.primaryModel;
    if (modelOverride) {
      logger.info({ model: effectiveModel }, 'compress_context: using explicit model override');
    }

    // Step 4: Context truncation if needed
    let processedContent = input.content;
    let truncated = false;
    const originalTokens = estimateTokenCount(input.content);

    if (validated.requiresTruncation) {
      const contentLimit = Math.floor(tierConfig.contextLimit * 0.9);
      processedContent = truncateByTokens(input.content, contentLimit);
      truncated = true;
      logger.warn({
        inputTokens: originalTokens,
        maxTokens: tierConfig.contextLimit,
        truncatedTokens: estimateTokenCount(processedContent),
      }, 'コンテキストカットオフ発生');
    }

    // Step 6: Build prompt
    const userPrompt = buildCompressPrompt(
      processedContent,
      input.focus,
      input.max_length,
    );

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: userPrompt },
    ];

    // Step 7: Enqueue and process
    const payload: OllamaTaskPayload = {
      request: {
        model: effectiveModel,
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
        return createFallbackResponse('QUEUE_ERROR', queueError.message);
      }
      throw queueError;
    }

    // DMS-029: Record successful execution
    if (context.executionTracker) {
      context.executionTracker.recordExecution({
        taskCategory: 'summarization' as TaskCategory,
        modelId: effectiveModel,
        executionTimeMs: Date.now() - startTime,
        inputTokens: ollamaResponse.inputTokens ?? 0,
        outputTokens: ollamaResponse.outputTokens ?? 0,
        success: true,
      });
    }

    // Step 9: Cost calculation
    const costResult = costCalculator.calculateSavings({
      inputTokens: ollamaResponse.inputTokens,
      outputTokens: ollamaResponse.outputTokens,
      tool: 'compress_context',
    });

    // Step 10: Log
    reportCost(costResult, 'compress_context');
    logger.info({
      tool: 'compress_context',
      model: ollamaResponse.model,
      inputTokens: ollamaResponse.inputTokens,
      outputTokens: ollamaResponse.outputTokens,
      durationMs: ollamaResponse.totalDurationMs,
      savingsUsd: costResult.savingsUsd,
      truncated,
    }, 'compress_context completed');

    // Sanitize output
    const sanitized = sanitizeOutput(ollamaResponse.text);
    if (sanitized.redactionCount > 0) {
      logger.warn({
        detectedCategories: sanitized.detectedCategories,
        redactionCount: sanitized.redactionCount,
      }, 'Sensitive info redacted from LLM output');
    }

    // Step 11: Build response
    let responseText = sanitized.sanitized;

    if (truncated) {
      const truncatedTokens = estimateTokenCount(processedContent);
      responseText = `[WARNING: Input truncated from ~${originalTokens} to ~${truncatedTokens} tokens due to Tier ${tierConfig.level} context limit (${tierConfig.contextLimit} tokens). Only the first portion was summarized.]\n\n${responseText}`;
    }

    const originalLength = input.content.length;
    const compressedLength = ollamaResponse.text.length;
    const compressionRatio = originalLength > 0
      ? ((1 - compressedLength / originalLength) * 100).toFixed(1)
      : '0.0';

    const meta = [
      `Model: ${ollamaResponse.model}`,
      `Tokens: ${ollamaResponse.inputTokens} in / ${ollamaResponse.outputTokens} out`,
      `Duration: ${Math.round(ollamaResponse.totalDurationMs)}ms`,
      `Compression: ${originalLength} -> ${compressedLength} chars (${compressionRatio}% reduced)`,
      `Savings: $${costResult.savingsUsd.toFixed(4)} (cumulative: $${costResult.cumulativeSavingsUsd.toFixed(4)})`,
    ].join(' | ');

    return {
      content: [
        {
          type: 'text',
          text: `${responseText}\n\n---\n${meta}`,
        },
      ],
    };
  } catch (error) {
    // DMS-029: Record failed execution
    if (context.executionTracker) {
      context.executionTracker.recordExecution({
        taskCategory: 'summarization' as TaskCategory,
        modelId: tierConfig.primaryModel,
        executionTimeMs: Date.now() - startTime,
        inputTokens: 0,
        outputTokens: 0,
        success: false,
      });
    }

    if (error instanceof CTSError) {
      if (error.fallbackToCloud) {
        return createFallbackResponse('ERROR', error.message);
      }
      return ctsErrorToCallToolResult(error);
    }
    return ctsErrorToCallToolResult(error);
  }
}
