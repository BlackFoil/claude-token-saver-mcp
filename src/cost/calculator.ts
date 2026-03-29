// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

import type { PricingTable } from './pricing.js';
import { InvalidConfigError } from '../errors.js';

export interface CostResult {
  readonly savingsUsd: number;
  readonly cumulativeSavingsUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly comparisonModel: string;
}

export interface CumulativeCost {
  readonly totalSavingsUsd: number;
  readonly totalRequests: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly byTool: {
    readonly offload_work: { readonly requests: number; readonly savings: number };
    readonly compress_context: { readonly requests: number; readonly savings: number };
  };
  readonly lastUpdated: string;
}

export interface CalculateSavingsParams {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model?: string;
  readonly tool: 'offload_work' | 'compress_context';
}

export class CostCalculator {
  private readonly pricing: PricingTable;
  private readonly defaultComparisonModel: string;

  private totalSavingsUsd = 0;
  private totalRequests = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private byTool = {
    offload_work: { requests: 0, savings: 0 },
    compress_context: { requests: 0, savings: 0 },
  };

  constructor(pricing: PricingTable, defaultComparisonModel: string) {
    if (!pricing[defaultComparisonModel]) {
      throw new InvalidConfigError(
        'defaultComparisonModel',
        `比較対象モデル '${defaultComparisonModel}' の価格情報が見つかりません`,
      );
    }
    this.pricing = pricing;
    this.defaultComparisonModel = defaultComparisonModel;
  }

  calculateSavings(params: CalculateSavingsParams): CostResult {
    if (params.inputTokens < 0 || params.outputTokens < 0) {
      throw new InvalidConfigError('tokens', 'トークン数は0以上である必要があります');
    }

    const model = params.model ?? this.defaultComparisonModel;
    const modelPricing = this.pricing[model];
    if (!modelPricing) {
      throw new InvalidConfigError('model', `モデル '${model}' の価格情報が見つかりません`);
    }

    const savingsUsd =
      (params.inputTokens / 1_000_000) * modelPricing.inputPer1MTokens +
      (params.outputTokens / 1_000_000) * modelPricing.outputPer1MTokens;

    this.totalSavingsUsd += savingsUsd;
    this.totalRequests++;
    this.totalInputTokens += params.inputTokens;
    this.totalOutputTokens += params.outputTokens;
    this.byTool[params.tool].requests++;
    this.byTool[params.tool].savings += savingsUsd;

    return {
      savingsUsd,
      cumulativeSavingsUsd: this.totalSavingsUsd,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      comparisonModel: model,
    };
  }

  getCumulativeSavings(): CumulativeCost {
    return {
      totalSavingsUsd: this.totalSavingsUsd,
      totalRequests: this.totalRequests,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      byTool: {
        offload_work: { ...this.byTool.offload_work },
        compress_context: { ...this.byTool.compress_context },
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  reset(): void {
    this.totalSavingsUsd = 0;
    this.totalRequests = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.byTool = {
      offload_work: { requests: 0, savings: 0 },
      compress_context: { requests: 0, savings: 0 },
    };
  }

  restoreFromHistory(history: CumulativeCost): void {
    if (history.totalSavingsUsd < 0) {
      throw new InvalidConfigError('costHistory', '不正なコスト履歴データです');
    }
    this.totalSavingsUsd = history.totalSavingsUsd;
    this.totalRequests = history.totalRequests;
    this.totalInputTokens = history.totalInputTokens;
    this.totalOutputTokens = history.totalOutputTokens;
    this.byTool = {
      offload_work: { ...history.byTool.offload_work },
      compress_context: { ...history.byTool.compress_context },
    };
  }
}
