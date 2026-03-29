// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * CLAUDE.md LLM用途 Column Parser (DMS-022)
 * Design: docs/design/dynamic-model-selector-design.md §1.4
 *
 * Parses a CLAUDE.md Markdown table to extract the "LLM用途" column,
 * mapping each role to a TaskCategory for use with recommend_model.
 *
 * This is a reference implementation intended for Claude Code integration.
 * Parse failures return an empty array (never throw).
 */

import { TASK_CATEGORIES, type TaskCategory } from './types.js';

export interface RoleCategoryMapping {
  /** Role name from the table (e.g., "PM / Coder 1", "Coder 2") */
  role: string;
  /** Task category extracted from LLM用途 column */
  category: TaskCategory;
}

/**
 * Parse a CLAUDE.md content string and extract role→category mappings
 * from the team table's "LLM用途" column.
 *
 * @param markdownContent - Full CLAUDE.md content as a string
 * @returns Array of role-category mappings. Empty array if parsing fails or no LLM用途 column exists.
 */
export function parseClaudeMdRoles(markdownContent: string): RoleCategoryMapping[] {
  try {
    const lines = markdownContent.split('\n');
    const results: RoleCategoryMapping[] = [];

    // Find table header row containing "LLM用途"
    let headerIdx = -1;
    let llmColumnIdx = -1;
    let roleColumnIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line.startsWith('|') || !line.endsWith('|')) continue;

      const cells = parseTableRow(line);
      const llmIdx = cells.findIndex((c) =>
        c === 'LLM用途' || c.toLowerCase() === 'llm usage' || c.toLowerCase() === 'llm用途',
      );

      if (llmIdx >= 0) {
        headerIdx = i;
        llmColumnIdx = llmIdx;
        // Find role column (first column, or one labeled 役割/Role)
        roleColumnIdx = cells.findIndex((c) =>
          c === '役割' || c.toLowerCase() === 'role' || c === '役割 (Role)',
        );
        if (roleColumnIdx < 0) roleColumnIdx = 0; // Default to first column
        break;
      }
    }

    if (headerIdx < 0 || llmColumnIdx < 0) {
      return []; // No LLM用途 column found
    }

    // Skip separator row (|:---|:---|...)
    const startRow = headerIdx + 2;

    for (let i = startRow; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line.startsWith('|') || !line.endsWith('|')) break; // End of table

      const cells = parseTableRow(line);
      if (cells.length <= Math.max(llmColumnIdx, roleColumnIdx)) continue;

      const role = cells[roleColumnIdx]!.trim();
      const llmValue = cells[llmColumnIdx]!.trim().toLowerCase();

      if (!role || !llmValue) continue;

      // Skip non-local-LLM roles (e.g., "Cloud API", "-", "N/A")
      if (isCloudOrSkip(llmValue)) continue;

      // Match to TaskCategory
      const category = matchCategory(llmValue);
      if (category) {
        results.push({ role, category });
      }
    }

    return results;
  } catch {
    return []; // Never throw
  }
}

/**
 * Extract unique categories from parsed mappings.
 */
export function extractUniqueCategories(mappings: RoleCategoryMapping[]): TaskCategory[] {
  return [...new Set(mappings.map((m) => m.category))];
}

// ── Internal Helpers ────────────────────────────────────────

function parseTableRow(line: string): string[] {
  // Split by | and remove first/last empty elements
  const parts = line.split('|');
  // Remove leading and trailing empty strings from split
  if (parts.length > 0 && parts[0]!.trim() === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1]!.trim() === '') parts.pop();
  return parts.map((p) => p.trim());
}

function isCloudOrSkip(value: string): boolean {
  const skipPatterns = [
    'cloud', 'cloud api', 'api', 'n/a', 'na', '-', '—', 'none', 'なし',
  ];
  return skipPatterns.includes(value);
}

function matchCategory(value: string): TaskCategory | null {
  // Direct match
  if ((TASK_CATEGORIES as readonly string[]).includes(value)) {
    return value as TaskCategory;
  }

  // Alias mapping
  const aliases: Record<string, TaskCategory> = {
    'code': 'coding',
    'コード': 'coding',
    'コーディング': 'coding',
    'プログラミング': 'coding',
    'coding-agent': 'coding-agent',
    'agent': 'coding-agent',
    'エージェント': 'coding-agent',
    'japanese': 'japanese-text',
    'japanese-text': 'japanese-text',
    '日本語': 'japanese-text',
    '日本語テキスト': 'japanese-text',
    'japanese-coding': 'japanese-coding',
    '日本語コーディング': 'japanese-coding',
    'translation': 'translation',
    '翻訳': 'translation',
    'translate': 'translation',
    'summarization': 'summarization',
    '要約': 'summarization',
    'summarize': 'summarization',
    'summary': 'summarization',
    'general': 'general',
    '汎用': 'general',
    'その他': 'general',
  };

  return aliases[value] ?? null;
}
