// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { appConfigSchema, type AppConfig } from './schema.js';
import { InvalidConfigError } from '../errors.js';
import type { CumulativeCost } from '../cost/calculator.js';

const CONFIG_DIR = join(homedir(), '.config', 'claude-token-saver');
export const CONFIG_FILE_PATH = join(CONFIG_DIR, 'config.json');
export const COST_HISTORY_FILE_PATH = join(CONFIG_DIR, 'cost-history.json');

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const bVal = base[key];
    const oVal = override[key];
    if (
      bVal && oVal &&
      typeof bVal === 'object' && typeof oVal === 'object' &&
      !Array.isArray(bVal) && !Array.isArray(oVal) &&
      bVal !== null && oVal !== null
    ) {
      result[key] = deepMerge(
        bVal as Record<string, unknown>,
        oVal as Record<string, unknown>,
      );
    } else {
      result[key] = oVal;
    }
  }
  return result;
}

function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const result = { ...config };

  if (process.env['OLLAMA_BASE_URL']) {
    if (!result['ollama']) result['ollama'] = {};
    (result['ollama'] as Record<string, unknown>)['baseUrl'] = process.env['OLLAMA_BASE_URL'];
  }

  const tierOverride = process.env['TIER_OVERRIDE'];
  if (tierOverride) {
    const level = parseInt(tierOverride, 10);
    if (level === 1 || level === 2 || level === 3) {
      const tier = (result['tier'] as Record<string, unknown>) ?? {};
      tier['forceLevel'] = level;
      result['tier'] = tier;
    }
  }

  if (process.env['MODEL_OVERRIDE']) {
    const tier = (result['tier'] as Record<string, unknown>) ?? {};
    tier['primaryModel'] = process.env['MODEL_OVERRIDE'];
    result['tier'] = tier;
  }

  const queueMaxSize = process.env['QUEUE_MAX_SIZE'];
  if (queueMaxSize) {
    const val = parseInt(queueMaxSize, 10);
    if (!Number.isNaN(val)) {
      if (!result['queue']) result['queue'] = {};
      (result['queue'] as Record<string, unknown>)['maxQueueLength'] = val;
    }
  }

  const queueTimeout = process.env['QUEUE_TIMEOUT_MS'];
  if (queueTimeout) {
    const val = parseInt(queueTimeout, 10);
    if (!Number.isNaN(val)) {
      if (!result['queue']) result['queue'] = {};
      (result['queue'] as Record<string, unknown>)['queueTimeoutMs'] = val;
    }
  }

  const ollamaTimeout = process.env['OLLAMA_TIMEOUT_MS'];
  if (ollamaTimeout) {
    const val = parseInt(ollamaTimeout, 10);
    if (!Number.isNaN(val)) {
      const timeout = (result['timeout'] as Record<string, unknown>) ?? {};
      timeout['requestTimeout'] = val;
      result['timeout'] = timeout;
    }
  }

  const cloudInputPrice = process.env['CLOUD_INPUT_PRICE_PER_MTOKEN'];
  const cloudOutputPrice = process.env['CLOUD_OUTPUT_PRICE_PER_MTOKEN'];
  if (cloudInputPrice || cloudOutputPrice) {
    const cost = (result['cost'] as Record<string, unknown>) ?? {};
    const pricing = (cost['pricing'] as Record<string, unknown>) ?? {};
    const sonnet = (pricing['claude-sonnet-4-5'] as Record<string, unknown>) ?? {};
    if (cloudInputPrice) sonnet['inputPer1MTokens'] = parseFloat(cloudInputPrice);
    if (cloudOutputPrice) sonnet['outputPer1MTokens'] = parseFloat(cloudOutputPrice);
    pricing['claude-sonnet-4-5'] = sonnet;
    cost['pricing'] = pricing;
    result['cost'] = cost;
  }

  if (process.env['LOG_LEVEL']) {
    result['logLevel'] = process.env['LOG_LEVEL'];
  }

  // Model Selector env overrides (DMS-012)
  const msEnabled = process.env['MODEL_SELECTOR_ENABLED'];
  if (msEnabled !== undefined) {
    const ms = (result['modelSelector'] as Record<string, unknown>) ?? {};
    ms['enabled'] = msEnabled === 'true';
    result['modelSelector'] = ms;
  }

  const msPreferQuality = process.env['MODEL_PREFER_QUALITY'];
  if (msPreferQuality !== undefined) {
    const ms = (result['modelSelector'] as Record<string, unknown>) ?? {};
    ms['preferQuality'] = msPreferQuality === 'true';
    result['modelSelector'] = ms;
  }

  const msKeepAlive = process.env['PRELOAD_KEEP_ALIVE'];
  if (msKeepAlive) {
    const ms = (result['modelSelector'] as Record<string, unknown>) ?? {};
    ms['preloadKeepAlive'] = msKeepAlive;
    result['modelSelector'] = ms;
  }

  const msMaxModels = process.env['MAX_SIMULTANEOUS_MODELS'];
  if (msMaxModels) {
    const ms = (result['modelSelector'] as Record<string, unknown>) ?? {};
    if (msMaxModels === 'auto') {
      ms['maxSimultaneousModels'] = 'auto';
    } else {
      const val = parseInt(msMaxModels, 10);
      if (!Number.isNaN(val)) {
        ms['maxSimultaneousModels'] = val;
      }
    }
    result['modelSelector'] = ms;
  }

  return result;
}

export function loadConfig(configFilePath?: string): AppConfig {
  const filePath = configFilePath ?? CONFIG_FILE_PATH;
  let fileConfig: Record<string, unknown> = {};

  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      fileConfig = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      process.stderr.write(`[WARN] 設定ファイルの読み込みに失敗しました: ${filePath}\n`);
    }
  }

  const merged = applyEnvOverrides(
    deepMerge({} as Record<string, unknown>, fileConfig),
  );

  const parseResult = appConfigSchema.safeParse(merged);
  if (!parseResult.success) {
    const messages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new InvalidConfigError('config', messages);
  }

  return parseResult.data;
}

export function loadCostHistory(configDir?: string): CumulativeCost | null {
  const dir = configDir ?? CONFIG_DIR;
  const filePath = join(dir, 'cost-history.json');

  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as CumulativeCost;
    if (typeof data.totalSavingsUsd !== 'number' || data.totalSavingsUsd < 0) {
      process.stderr.write('[WARN] コスト履歴データが不正です。\n');
      return null;
    }
    return data;
  } catch {
    process.stderr.write('[WARN] コスト履歴ファイルの読み込みに失敗しました。\n');
    return null;
  }
}

export function saveCostHistory(
  history: CumulativeCost,
  configDir?: string,
): void {
  const dir = configDir ?? CONFIG_DIR;
  const filePath = join(dir, 'cost-history.json');

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Atomic write: write to temp file, then rename
    const tmpPath = join(dir, `cost-history.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(history, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  } catch {
    process.stderr.write('[WARN] コスト履歴の保存に失敗しました。\n');
  }
}
