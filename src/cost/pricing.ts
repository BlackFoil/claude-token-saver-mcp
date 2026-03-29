// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

export interface ModelPricing {
  readonly inputPer1MTokens: number;
  readonly outputPer1MTokens: number;
}

export type PricingTable = Readonly<Record<string, ModelPricing>>;

export const DEFAULT_PRICING: PricingTable = {
  'claude-sonnet-4-5': {
    inputPer1MTokens: 3.0,
    outputPer1MTokens: 15.0,
  },
  'claude-opus-4': {
    inputPer1MTokens: 15.0,
    outputPer1MTokens: 75.0,
  },
  'claude-haiku-3-5': {
    inputPer1MTokens: 0.8,
    outputPer1MTokens: 4.0,
  },
} as const;

export const DEFAULT_COMPARISON_MODEL = 'claude-sonnet-4-5' as const;

export function loadPricing(
  configPricing?: Record<string, { inputPer1MTokens: number; outputPer1MTokens: number }>,
): PricingTable {
  if (!configPricing) return DEFAULT_PRICING;

  const merged: Record<string, ModelPricing> = { ...DEFAULT_PRICING };

  for (const [model, pricing] of Object.entries(configPricing)) {
    if (
      typeof pricing.inputPer1MTokens !== 'number' ||
      typeof pricing.outputPer1MTokens !== 'number' ||
      pricing.inputPer1MTokens <= 0 ||
      pricing.outputPer1MTokens <= 0 ||
      pricing.inputPer1MTokens > 1000 ||
      pricing.outputPer1MTokens > 1000
    ) {
      process.stderr.write(`[WARN] モデル "${model}" の価格情報が不正です。スキップします。\n`);
      continue;
    }

    merged[model] = {
      inputPer1MTokens: pricing.inputPer1MTokens,
      outputPer1MTokens: pricing.outputPer1MTokens,
    };
  }

  return merged;
}
