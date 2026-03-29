// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * Structured Logging Helpers (P5-003)
 *
 * Provides consistent log context objects for tool execution tracing.
 */

import { randomUUID } from 'node:crypto';

export interface ToolLogContext {
  tool: string;
  model?: string;
  category?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  savingsUsd?: number;
  queueWaitMs?: number;
  error?: string;
  errorCode?: string;
}

/** Create a standardized log context for tool execution. */
export function createToolLogContext(params: {
  tool: string;
  model?: string;
  category?: string;
  startTime?: number;
  response?: { inputTokens: number; outputTokens: number; totalDurationMs: number };
  savings?: number;
  error?: Error;
}): ToolLogContext {
  const ctx: ToolLogContext = {
    tool: params.tool,
  };

  if (params.model !== undefined) {
    ctx.model = params.model;
  }

  if (params.category !== undefined) {
    ctx.category = params.category;
  }

  if (params.startTime !== undefined) {
    ctx.durationMs = Date.now() - params.startTime;
  }

  if (params.response) {
    ctx.inputTokens = params.response.inputTokens;
    ctx.outputTokens = params.response.outputTokens;
    // If startTime was not provided, fall back to the response's totalDurationMs
    if (ctx.durationMs === undefined) {
      ctx.durationMs = params.response.totalDurationMs;
    }
  }

  if (params.savings !== undefined) {
    ctx.savingsUsd = params.savings;
  }

  if (params.error) {
    ctx.error = params.error.message;
    if (
      'code' in params.error &&
      typeof (params.error as Record<string, unknown>).code === 'string'
    ) {
      ctx.errorCode = (params.error as Record<string, unknown>).code as string;
    }
  }

  return ctx;
}

/** Create a request ID for tracing. */
export function createRequestId(): string {
  return randomUUID();
}
