// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * get_metrics MCP Tool Handler (P5-001)
 * Exposes Prometheus-compatible metrics via an MCP tool call.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MetricsCollector } from '../metrics/collector.js';
import type { Logger } from 'pino';

export interface GetMetricsContext {
  metricsCollector: MetricsCollector;
  logger: Logger;
}

type MetricsFormat = 'prometheus' | 'json';

interface GetMetricsArgs {
  format?: MetricsFormat;
}

function parseArgs(raw: unknown): GetMetricsArgs {
  if (raw == null || typeof raw !== 'object') {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const format = obj['format'];
  if (format === 'prometheus' || format === 'json') {
    return { format };
  }
  return {};
}

export async function handleGetMetrics(
  args: unknown,
  ctx: GetMetricsContext,
): Promise<CallToolResult> {
  const { format = 'json' } = parseArgs(args);

  ctx.logger.debug({ format }, 'get_metrics called');

  if (format === 'prometheus') {
    const text = ctx.metricsCollector.toPrometheusText();
    return {
      content: [
        {
          type: 'text' as const,
          text,
        },
      ],
    };
  }

  // Default: JSON
  const snapshot = ctx.metricsCollector.toJSON();
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(snapshot, null, 2),
      },
    ],
  };
}
