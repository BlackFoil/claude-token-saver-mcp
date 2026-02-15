/**
 * Tier definitions for claude-token-saver-mcp.
 * RAM-based tiering: Light (Tier 1), Standard (Tier 2), Ultra (Tier 3).
 */

export type TierLevel = 1 | 2 | 3;

export interface TimeoutConfig {
  /** リクエスト全体のタイムアウト (ms) */
  requestTimeout: number;
  /** チャンク間最大間隔 (ms) */
  heartbeatTimeout: number;
  /** 初回トークン到着までの猶予 (ms) */
  firstTokenTimeout: number;
}

export interface TierConfig {
  level: TierLevel;
  name: string;
  primaryModel: string;
  fallbackModel: string | null;
  contextLimit: number;
  ramRange: {
    min: number;
    max: number;
  };
  timeout: TimeoutConfig;
}

export interface TierConfigOverrides {
  primaryModel: string;
  fallbackModel: string | null;
  contextLimit: number;
  timeout: Partial<TimeoutConfig>;
}

export const TIER_DEFINITIONS: readonly TierConfig[] = [
  {
    level: 1,
    name: 'Light',
    primaryModel: 'phi4:latest',
    fallbackModel: 'phi4-mini:latest',
    contextLimit: 4_000,
    ramRange: { min: 0, max: 16 },
    timeout: {
      requestTimeout: 60_000,
      heartbeatTimeout: 30_000,
      firstTokenTimeout: 120_000,
    },
  },
  {
    level: 2,
    name: 'Standard',
    primaryModel: 'qwen2.5-coder:7b',
    fallbackModel: null,
    contextLimit: 12_000,
    ramRange: { min: 16, max: 48 },
    timeout: {
      requestTimeout: 90_000,
      heartbeatTimeout: 30_000,
      firstTokenTimeout: 120_000,
    },
  },
  {
    level: 3,
    name: 'Ultra',
    primaryModel: 'qwen2.5-coder:32b',
    fallbackModel: null,
    contextLimit: 32_000,
    ramRange: { min: 48, max: Infinity },
    timeout: {
      requestTimeout: 180_000,
      heartbeatTimeout: 45_000,
      firstTokenTimeout: 180_000,
    },
  },
] as const;
