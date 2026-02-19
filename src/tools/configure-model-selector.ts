// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

/**
 * configure_model_selector MCP Tool Handler (DMS-032)
 *
 * Runtime management of model selector settings:
 * - blocked_models: Models to exclude from recommendations
 * - license_filter: Allowed license types
 * - custom_recommendations: User-defined model overrides per category/tier
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AppConfig } from '../config/schema.js';
import type { Logger } from 'pino';
import { LICENSE_TYPES } from '../model-selector/types.js';
import { ctsErrorToCallToolResult, CTSError, InvalidConfigError } from '../errors.js';

export interface ConfigureModelSelectorContext {
  config: AppConfig;
  logger: Logger;
}

type SettingName = 'blocked_models' | 'license_filter' | 'custom_recommendations';
type ActionName = 'get' | 'set' | 'add' | 'remove';

const VALID_SETTINGS: readonly SettingName[] = ['blocked_models', 'license_filter', 'custom_recommendations'];
const VALID_ACTIONS: readonly ActionName[] = ['get', 'set', 'add', 'remove'];

interface ConfigureInput {
  setting: SettingName;
  action: ActionName;
  values?: string[];
  custom_config?: Record<string, Record<string, string[]>>;
}

function validateInput(args: Record<string, unknown>): ConfigureInput {
  const setting = args['setting'];
  if (typeof setting !== 'string' || !(VALID_SETTINGS as readonly string[]).includes(setting)) {
    throw new InvalidConfigError(
      'setting',
      `Invalid setting "${String(setting)}". Must be one of: ${VALID_SETTINGS.join(', ')}`,
    );
  }

  const action = args['action'];
  if (typeof action !== 'string' || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    throw new InvalidConfigError(
      'action',
      `Invalid action "${String(action)}". Must be one of: ${VALID_ACTIONS.join(', ')}`,
    );
  }

  const values = args['values'];
  if (values !== undefined && values !== null) {
    if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
      throw new InvalidConfigError('values', 'Must be an array of strings');
    }
  }

  const customConfig = args['custom_config'];
  if (customConfig !== undefined && customConfig !== null) {
    if (typeof customConfig !== 'object' || Array.isArray(customConfig)) {
      throw new InvalidConfigError('custom_config', 'Must be an object { category: { tier: modelId[] } }');
    }
  }

  // Validate action-setting combinations
  if (setting === 'custom_recommendations' && action !== 'get' && action !== 'set') {
    throw new InvalidConfigError(
      'action',
      `custom_recommendations only supports "get" and "set" actions. Use "set" with custom_config to replace.`,
    );
  }

  if (setting !== 'custom_recommendations' && action !== 'get' && (!values || values.length === 0)) {
    throw new InvalidConfigError('values', `"${action}" action requires non-empty values array`);
  }

  if (setting === 'custom_recommendations' && action === 'set' && !customConfig) {
    throw new InvalidConfigError('custom_config', '"set" action for custom_recommendations requires custom_config');
  }

  return {
    setting: setting as SettingName,
    action: action as ActionName,
    values: values as string[] | undefined,
    custom_config: customConfig as Record<string, Record<string, string[]>> | undefined,
  };
}

function validateLicenseValues(values: string[]): void {
  const validSet = new Set<string>(LICENSE_TYPES);
  const invalid = values.filter((v) => !validSet.has(v));
  if (invalid.length > 0) {
    throw new InvalidConfigError(
      'values',
      `Invalid license type(s): ${invalid.join(', ')}. Valid types: ${LICENSE_TYPES.join(', ')}`,
    );
  }
}

function handleBlockedModels(
  action: ActionName,
  config: AppConfig,
  values?: string[],
): string {
  const current = config.modelSelector.blockedModels;

  if (action === 'get') {
    if (current.length === 0) return 'No blocked models configured.';
    return `**Blocked Models (${current.length}):**\n${current.map((m) => `- \`${m}\``).join('\n')}`;
  }

  if (action === 'set') {
    config.modelSelector.blockedModels = values!;
    return `Blocked models updated to ${values!.length} entries:\n${values!.map((m) => `- \`${m}\``).join('\n')}`;
  }

  if (action === 'add') {
    const newModels = values!.filter((v) => !current.includes(v.toLowerCase()));
    config.modelSelector.blockedModels = [...current, ...newModels];
    return `Added ${newModels.length} model(s) to blocklist. Total: ${config.modelSelector.blockedModels.length}`;
  }

  // remove
  const removeSet = new Set(values!.map((v) => v.toLowerCase()));
  config.modelSelector.blockedModels = current.filter((m) => !removeSet.has(m.toLowerCase()));
  return `Removed ${values!.length} model(s) from blocklist. Remaining: ${config.modelSelector.blockedModels.length}`;
}

function handleLicenseFilter(
  action: ActionName,
  config: AppConfig,
  values?: string[],
): string {
  const current = config.modelSelector.licenseFilter;

  if (action === 'get') {
    if (current.length === 0) return 'No license filter active (all licenses allowed).';
    return `**License Filter (${current.length}):**\n${current.map((l) => `- ${l}`).join('\n')}`;
  }

  if (values) validateLicenseValues(values);

  if (action === 'set') {
    config.modelSelector.licenseFilter = values!;
    if (values!.length === 0) return 'License filter cleared. All licenses are now allowed.';
    return `License filter updated to ${values!.length} types:\n${values!.map((l) => `- ${l}`).join('\n')}`;
  }

  if (action === 'add') {
    const newLicenses = values!.filter((v) => !current.includes(v));
    config.modelSelector.licenseFilter = [...current, ...newLicenses];
    return `Added ${newLicenses.length} license type(s). Total: ${config.modelSelector.licenseFilter.length}`;
  }

  // remove
  const removeSet = new Set(values!);
  config.modelSelector.licenseFilter = current.filter((l) => !removeSet.has(l));
  return `Removed ${values!.length} license type(s). Remaining: ${config.modelSelector.licenseFilter.length}`;
}

function handleCustomRecommendations(
  action: ActionName,
  config: AppConfig,
  customConfig?: Record<string, Record<string, string[]>>,
): string {
  const current = config.modelSelector.customRecommendations;

  if (action === 'get') {
    const entries = Object.entries(current);
    if (entries.length === 0) return 'No custom recommendations configured.';

    const lines: string[] = ['**Custom Recommendations:**', ''];
    for (const [category, tiers] of entries) {
      lines.push(`### ${category}`);
      for (const [tier, models] of Object.entries(tiers)) {
        lines.push(`- **Tier ${tier}:** ${models.join(', ')}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // action === 'set'
  config.modelSelector.customRecommendations = customConfig!;
  const categoryCount = Object.keys(customConfig!).length;
  if (categoryCount === 0) return 'Custom recommendations cleared.';
  return `Custom recommendations updated for ${categoryCount} category(ies).`;
}

/**
 * Handle configure_model_selector tool call.
 */
export async function handleConfigureModelSelector(
  args: Record<string, unknown>,
  ctx: ConfigureModelSelectorContext,
): Promise<CallToolResult> {
  try {
    if (!ctx.config.modelSelector.enabled) {
      throw new InvalidConfigError(
        'modelSelector.enabled',
        'Model selector is disabled. Set MODEL_SELECTOR_ENABLED=true or modelSelector.enabled=true in config.',
      );
    }

    const input = validateInput(args);
    let resultText: string;

    switch (input.setting) {
      case 'blocked_models':
        resultText = handleBlockedModels(input.action, ctx.config, input.values);
        break;
      case 'license_filter':
        resultText = handleLicenseFilter(input.action, ctx.config, input.values);
        break;
      case 'custom_recommendations':
        resultText = handleCustomRecommendations(input.action, ctx.config, input.custom_config);
        break;
      default:
        throw new InvalidConfigError('setting', `Unknown setting: ${input.setting as string}`);
    }

    ctx.logger.info({
      setting: input.setting,
      action: input.action,
    }, 'configure_model_selector completed');

    return {
      content: [{ type: 'text', text: `## Model Selector Configuration\n\n${resultText}` }],
    };
  } catch (error) {
    if (error instanceof CTSError) {
      return ctsErrorToCallToolResult(error);
    }
    return ctsErrorToCallToolResult(error);
  }
}
