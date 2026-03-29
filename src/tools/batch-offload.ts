// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandlerContext, OllamaTaskPayload } from './offload-work.js';
import { validateOffloadWorkInput } from '../validators/input-validator.js';
import { detectPromptInjection } from '../validators/prompt-guard.js';
import { ctsErrorToCallToolResult, CTSError } from '../errors.js';
import { reportCost } from '../cost/reporter.js';
import { SYSTEM_PROMPT } from '../ollama/client.js';
import type { OllamaChatResponse } from '../ollama/client.js';

export interface BatchTask {
  task: string;
  language?: string;
  context?: string;
  output_format?: string;
  model?: string;
  category?: string;
}

const batchInputSchema = z.object({
  tasks: z.array(z.object({
    task: z.string().min(1).max(50000),
    language: z.string().optional(),
    context: z.string().max(100000).optional(),
    output_format: z.enum(['code', 'diff', 'explanation', 'raw']).optional(),
    model: z.string().optional(),
    category: z.string().optional(),
  })).min(1).max(10),
  sequential: z.boolean().default(false),
});

export { batchInputSchema };

interface TaskResult {
  index: number;
  success: boolean;
  text?: string;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  savingsUsd: number;
}

function formatUserPrompt(task: BatchTask, previousResult?: string): string {
  const parts: string[] = [];
  if (task.language) parts.push(`Language: ${task.language}`);
  if (task.output_format) parts.push(`Output format: ${task.output_format}`);
  parts.push(`Task: ${task.task}`);
  if (task.context) {
    parts.push('---');
    parts.push(`Context:\n${task.context}`);
  }
  if (previousResult) {
    parts.push('---');
    parts.push(`Previous result:\n${previousResult}`);
  }
  return parts.join('\n');
}

async function processOneTask(
  task: BatchTask,
  index: number,
  context: ToolHandlerContext,
  previousResult?: string,
): Promise<TaskResult> {
  const { queue, tierConfig, costCalculator, logger, maxRequestSizeBytes } = context;

  const startTime = Date.now();
  try {
    // Input validation (same as offload_work)
    const validated = validateOffloadWorkInput(task, maxRequestSizeBytes);
    const input = validated.input;

    // Prompt injection check
    const combinedText = input.task + (input.context ?? '');
    const piResult = detectPromptInjection(combinedText);
    if (piResult.blocked) {
      logger.error({ threats: piResult.threats, taskIndex: index }, 'PI blocked in batch_offload');
      return {
        index,
        success: false,
        error: `[CTS-5001] プロンプトインジェクションの疑いを検出しました: ${piResult.threats.map((t) => t.category).join(', ')}`,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startTime,
        savingsUsd: 0,
      };
    }

    // Use tierConfig default model (batch tasks don't do model selection)
    const effectiveModel = task.model?.trim() || tierConfig.primaryModel;

    // Build chat messages
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: formatUserPrompt(task, previousResult) },
    ];

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

    // Enqueue with LOW priority
    const ollamaResponse: OllamaChatResponse = await queue.enqueue(
      payload,
      validated.totalBytes,
    );

    // Cost calculation
    const costResult = costCalculator.calculateSavings({
      inputTokens: ollamaResponse.inputTokens,
      outputTokens: ollamaResponse.outputTokens,
      tool: 'offload_work',
    });

    reportCost(costResult, 'batch_offload');
    logger.info({
      tool: 'batch_offload',
      taskIndex: index,
      model: ollamaResponse.model,
      inputTokens: ollamaResponse.inputTokens,
      outputTokens: ollamaResponse.outputTokens,
      durationMs: ollamaResponse.totalDurationMs,
      savingsUsd: costResult.savingsUsd,
    }, 'batch_offload task completed');

    return {
      index,
      success: true,
      text: ollamaResponse.text,
      inputTokens: ollamaResponse.inputTokens,
      outputTokens: ollamaResponse.outputTokens,
      durationMs: Math.round(ollamaResponse.totalDurationMs),
      savingsUsd: costResult.savingsUsd,
    };
  } catch (error) {
    const errorMessage = error instanceof CTSError
      ? `[${error.code}] ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);

    return {
      index,
      success: false,
      error: errorMessage,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startTime,
      savingsUsd: 0,
    };
  }
}

export async function handleBatchOffload(
  rawInput: unknown,
  context: ToolHandlerContext,
): Promise<CallToolResult> {
  try {
    // Step 1: Ollama availability check
    if (!context.ollamaHealthy) {
      const recheck = await context.ollamaClient.healthCheck();
      if (!recheck) {
        return {
          content: [{
            type: 'text',
            text: '[FALLBACK_TO_CLOUD] OLLAMA_UNREACHABLE: Ollama is not available. Process these tasks directly.',
          }],
          isError: true,
        };
      }
      context.ollamaHealthy = true;
    }

    // Step 2: Validate batch input
    const parseResult = batchInputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const messages = parseResult.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      return {
        content: [{
          type: 'text',
          text: `[CTS-5001] バッチ入力バリデーションエラー: ${messages}`,
        }],
        isError: true,
      };
    }

    const { tasks, sequential } = parseResult.data;

    // Step 3: Process tasks
    let results: TaskResult[];

    if (sequential) {
      // Sequential: pass previous result as context to next task
      results = [];
      let previousResult: string | undefined;
      for (let i = 0; i < tasks.length; i++) {
        const result = await processOneTask(tasks[i]!, i, context, previousResult);
        results.push(result);
        if (result.success && result.text) {
          previousResult = result.text;
        }
      }
    } else {
      // Parallel: all tasks go to queue simultaneously
      const promises = tasks.map((task, i) =>
        processOneTask(task, i, context),
      );
      results = await Promise.all(promises);
    }

    // Step 4: Aggregate results
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    const totalSavings = results.reduce((sum, r) => sum + r.savingsUsd, 0);
    const totalInputTokens = results.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = results.reduce((sum, r) => sum + r.outputTokens, 0);

    // Build output text
    const outputParts: string[] = [];
    outputParts.push(`## Batch Results: ${successCount}/${tasks.length} succeeded`);
    if (failCount > 0) {
      outputParts.push(`(${failCount} failed)`);
    }
    outputParts.push('');

    for (const result of results) {
      outputParts.push(`### Task ${result.index + 1}`);
      if (result.success) {
        outputParts.push(result.text ?? '');
      } else {
        outputParts.push(`ERROR: ${result.error}`);
      }
      outputParts.push('');
    }

    outputParts.push('---');
    outputParts.push(
      `Total tokens: ${totalInputTokens} in / ${totalOutputTokens} out | ` +
      `Total savings: $${totalSavings.toFixed(4)} | ` +
      `Mode: ${sequential ? 'sequential' : 'parallel'}`,
    );

    return {
      content: [{
        type: 'text',
        text: outputParts.join('\n'),
      }],
      isError: failCount === tasks.length ? true : undefined,
    };
  } catch (error) {
    return ctsErrorToCallToolResult(error);
  }
}
