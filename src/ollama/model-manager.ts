// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

import type { OllamaClient, OllamaModelInfo } from './client.js';
import { ModelNotFoundError } from '../errors.js';
import type { TierConfig } from '../tiering/config.js';

/**
 * Ensures required model is available, with auto-pull and fallback support.
 */
export class ModelManager {
  private readonly client: OllamaClient;
  private cachedModels: OllamaModelInfo[] | null = null;

  constructor(client: OllamaClient) {
    this.client = client;
  }

  /**
   * Ensure a model is available locally. If not, attempt to pull it.
   * For Tier 1, if primary model fails, try the fallback model.
   */
  async ensureModelAvailable(tierConfig: TierConfig): Promise<string> {
    const models = await this.refreshModelList();
    const modelNames = new Set(models.map((m) => m.name));

    // Check primary model
    if (modelNames.has(tierConfig.primaryModel)) {
      return tierConfig.primaryModel;
    }

    // Try to pull primary model
    try {
      process.stderr.write(
        `[INFO] モデル "${tierConfig.primaryModel}" が見つかりません。自動pullを開始します。\n`,
      );
      await this.client.pullModel(tierConfig.primaryModel);
      return tierConfig.primaryModel;
    } catch (pullError) {
      // If Tier 1 has a fallback model, try it
      if (tierConfig.fallbackModel) {
        process.stderr.write(
          `[WARN] プライマリモデルのpullに失敗しました。フォールバックモデル "${tierConfig.fallbackModel}" を試行します。\n`,
        );

        if (modelNames.has(tierConfig.fallbackModel)) {
          return tierConfig.fallbackModel;
        }

        try {
          await this.client.pullModel(tierConfig.fallbackModel);
          return tierConfig.fallbackModel;
        } catch {
          throw new ModelNotFoundError(
            `プライマリモデル "${tierConfig.primaryModel}" とフォールバックモデル "${tierConfig.fallbackModel}" の両方が利用できません。`,
          );
        }
      }

      throw pullError instanceof ModelNotFoundError
        ? pullError
        : new ModelNotFoundError(tierConfig.primaryModel);
    }
  }

  /**
   * Check if a specific model is available locally.
   */
  async isModelAvailable(modelName: string): Promise<boolean> {
    const models = await this.refreshModelList();
    return models.some((m) => m.name === modelName);
  }

  /**
   * Refresh the cached model list.
   */
  async refreshModelList(): Promise<OllamaModelInfo[]> {
    this.cachedModels = await this.client.listModels();
    return this.cachedModels;
  }

  /**
   * Get cached model list (or refresh if cache is empty).
   */
  async getModels(): Promise<OllamaModelInfo[]> {
    if (this.cachedModels === null) {
      return this.refreshModelList();
    }
    return this.cachedModels;
  }
}
