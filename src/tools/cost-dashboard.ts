// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * cost_dashboard MCP Tool Handler (F-08)
 * Displays cumulative cost savings and model usage statistics.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { CostCalculator } from '../cost/calculator.js';
import type { ExecutionTracker } from '../model-selector/execution-tracker.js';
import type { Logger } from 'pino';
import { TASK_CATEGORIES } from '../model-selector/types.js';

export interface CostDashboardContext {
  costCalculator: CostCalculator;
  executionTracker?: ExecutionTracker;
  logger: Logger;
}

interface ModelUsageRow {
  modelId: string;
  category: string;
  requests: number;
  avgTimeMs: number;
  successRate: number;
}

export async function handleCostDashboard(
  _args: Record<string, unknown>,
  ctx: CostDashboardContext,
): Promise<CallToolResult> {
  const savings = ctx.costCalculator.getCumulativeSavings();

  const lines: string[] = [
    '## Cost Savings Dashboard',
    '',
    `**Total Savings:** $${savings.totalSavingsUsd.toFixed(4)}`,
    `**Total Requests:** ${savings.totalRequests}`,
    `**Total Tokens:** ${savings.totalInputTokens} input / ${savings.totalOutputTokens} output`,
    '',
  ];

  // Collect execution metrics
  const rows: ModelUsageRow[] = [];

  if (ctx.executionTracker) {
    for (const category of TASK_CATEGORIES) {
      const metrics = ctx.executionTracker.getPerformanceMetrics(category);
      for (const m of metrics) {
        rows.push({
          modelId: m.modelId,
          category,
          requests: m.usageCount,
          avgTimeMs: m.avgExecutionTimeMs,
          successRate: m.successRate,
        });
      }
    }
  }

  if (rows.length > 0) {
    lines.push('### Model Usage Statistics');
    lines.push('| Model | Category | Requests | Avg Time | Success Rate |');
    lines.push('|:---|:---|:---:|:---:|:---:|');

    for (const row of rows) {
      const avgTimeSec = (row.avgTimeMs / 1000).toFixed(1);
      const successPct = (row.successRate * 100).toFixed(1);
      lines.push(
        `| ${row.modelId} | ${row.category} | ${row.requests} | ${avgTimeSec}s | ${successPct}% |`,
      );
    }
  } else {
    lines.push('> No execution history available.');
  }

  ctx.logger.debug({ totalSavings: savings.totalSavingsUsd, rows: rows.length }, 'Cost dashboard rendered');

  return {
    content: [
      {
        type: 'text' as const,
        text: lines.join('\n'),
      },
    ],
  };
}
