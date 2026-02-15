// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import type { CostResult } from './calculator.js';

function formatCostLine(result: CostResult, toolName: string): string {
  return `[CTS Cost] ${toolName} | 今回: $${result.savingsUsd.toFixed(4)} | 累計: $${result.cumulativeSavingsUsd.toFixed(4)} | tokens: ${result.inputTokens}->${result.outputTokens}`;
}

export function reportCost(result: CostResult, toolName: string): void {
  try {
    process.stderr.write(formatCostLine(result, toolName) + '\n');
  } catch {
    // I/Oエラーでサーバーを停止させない
  }
}
