// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import { totalmem } from 'node:os';
import { InvalidConfigError } from '../errors.js';
import { TIER_DEFINITIONS, type TierConfig, type TierConfigOverrides } from './config.js';

/**
 * システムRAM量からTierを自動判定する。
 * テスト容易性のため totalMemoryGB を外部注入可能。
 */
export function detectTier(totalMemoryGB?: number): TierConfig {
  const ramGB = totalMemoryGB ?? totalmem() / (1024 ** 3);

  if (Number.isNaN(ramGB) || ramGB <= 0) {
    throw new InvalidConfigError(
      'totalMemoryGB',
      `RAM量の値が不正です: ${ramGB}`,
    );
  }

  for (const tier of TIER_DEFINITIONS) {
    if (ramGB >= tier.ramRange.min && ramGB < tier.ramRange.max) {
      return { ...tier };
    }
  }

  // Fallback: 最後のTier（Ultra）
  const lastTier = TIER_DEFINITIONS[TIER_DEFINITIONS.length - 1]!;
  return { ...lastTier };
}

/**
 * 設定ファイルによるTier設定の上書きを適用する。
 * level, name, ramRange は上書き不可。
 */
export function applyConfigOverrides(
  baseTier: TierConfig,
  overrides: Partial<TierConfigOverrides> | null,
): TierConfig {
  if (!overrides) return baseTier;

  return {
    ...baseTier,
    primaryModel: overrides.primaryModel ?? baseTier.primaryModel,
    fallbackModel: overrides.fallbackModel !== undefined
      ? overrides.fallbackModel
      : baseTier.fallbackModel,
    contextLimit: overrides.contextLimit ?? baseTier.contextLimit,
    timeout: {
      ...baseTier.timeout,
      ...overrides.timeout,
    },
  };
}
