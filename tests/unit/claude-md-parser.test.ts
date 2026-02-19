import { describe, it, expect } from 'vitest';
import { parseClaudeMdRoles, extractUniqueCategories } from '../../src/model-selector/claude-md-parser.js';

// ── Test Data ────────────────────────────────────────────────

const VALID_TABLE = `
# チーム構成と役割定義

| 役割 (Role) | 担当 | LLM用途 | 備考 |
|:---|:---|:---|:---|
| PM / Coder 1 | Claude Code | Cloud API | 全体統括 |
| Coder 2 | Local LLM | coding | コード生成・最適化 |
| Tester | Local LLM | coding | テストコード作成 |
| Docs | Local LLM | japanese-text | 日本語ドキュメント |
| Translator | Local LLM | translation | 翻訳 |
| Researcher | Claude Code | Cloud API | 調査 |
`;

const TABLE_WITH_ALIASES = `
| 役割 | 担当 | LLM用途 |
|:---|:---|:---|
| Dev | Local | コーディング |
| Writer | Local | 日本語 |
| Agent | Local | エージェント |
| Summary | Local | 要約 |
| General | Local | 汎用 |
`;

const NO_LLM_COLUMN = `
| 役割 | 担当 | 使用ツール |
|:---|:---|:---|
| PM | Claude Code | file-system |
| Coder | Codex CLI | codex-mcp |
`;

const EMPTY_TABLE = `
# Some header

No tables here at all.
Just regular markdown text.
`;

const MALFORMED_TABLE = `
| 役割 | LLM用途
|:---|:---|
This line is not a proper table row
| Valid | coding |
`;

const TABLE_WITH_SKIPS = `
| 役割 | LLM用途 |
|:---|:---|
| PM | Cloud API |
| Coder | coding |
| Researcher | - |
| Writer | N/A |
| Helper | none |
| Translator | translation |
`;

// ── Tests ────────────────────────────────────────────────────

describe('parseClaudeMdRoles (DMS-022)', () => {
  it('extracts role-category mappings from valid table', () => {
    const result = parseClaudeMdRoles(VALID_TABLE);
    expect(result).toEqual([
      { role: 'Coder 2', category: 'coding' },
      { role: 'Tester', category: 'coding' },
      { role: 'Docs', category: 'japanese-text' },
      { role: 'Translator', category: 'translation' },
    ]);
  });

  it('skips Cloud API and other non-local roles', () => {
    const result = parseClaudeMdRoles(VALID_TABLE);
    const roles = result.map((r) => r.role);
    expect(roles).not.toContain('PM / Coder 1');
    expect(roles).not.toContain('Researcher');
  });

  it('handles Japanese aliases for categories', () => {
    const result = parseClaudeMdRoles(TABLE_WITH_ALIASES);
    expect(result).toEqual([
      { role: 'Dev', category: 'coding' },
      { role: 'Writer', category: 'japanese-text' },
      { role: 'Agent', category: 'coding-agent' },
      { role: 'Summary', category: 'summarization' },
      { role: 'General', category: 'general' },
    ]);
  });

  it('returns empty array when no LLM用途 column exists', () => {
    const result = parseClaudeMdRoles(NO_LLM_COLUMN);
    expect(result).toEqual([]);
  });

  it('returns empty array for content with no tables', () => {
    const result = parseClaudeMdRoles(EMPTY_TABLE);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    const result = parseClaudeMdRoles('');
    expect(result).toEqual([]);
  });

  it('handles malformed table rows gracefully', () => {
    const result = parseClaudeMdRoles(MALFORMED_TABLE);
    // Should parse whatever it can, not throw
    expect(Array.isArray(result)).toBe(true);
  });

  it('skips rows with skip patterns (-, N/A, none, Cloud API)', () => {
    const result = parseClaudeMdRoles(TABLE_WITH_SKIPS);
    expect(result).toEqual([
      { role: 'Coder', category: 'coding' },
      { role: 'Translator', category: 'translation' },
    ]);
  });

  it('returns empty array for unrecognized category values', () => {
    const table = `
| 役割 | LLM用途 |
|:---|:---|
| Worker | unknown-category |
`;
    const result = parseClaudeMdRoles(table);
    expect(result).toEqual([]);
  });

  it('handles table with only header and separator (no data rows)', () => {
    const table = `
| 役割 | LLM用途 |
|:---|:---|
`;
    const result = parseClaudeMdRoles(table);
    expect(result).toEqual([]);
  });

  it('handles header with English "LLM Usage" column name', () => {
    const table = `
| Role | LLM Usage |
|:---|:---|
| Coder | coding |
| Writer | japanese-text |
`;
    const result = parseClaudeMdRoles(table);
    expect(result).toEqual([
      { role: 'Coder', category: 'coding' },
      { role: 'Writer', category: 'japanese-text' },
    ]);
  });

  it('defaults to first column as role when no 役割/Role header', () => {
    const table = `
| Name | LLM用途 |
|:---|:---|
| Alice | coding |
| Bob | translation |
`;
    const result = parseClaudeMdRoles(table);
    expect(result[0]!.role).toBe('Alice');
    expect(result[1]!.role).toBe('Bob');
  });
});

describe('extractUniqueCategories', () => {
  it('extracts unique categories from mappings', () => {
    const mappings = parseClaudeMdRoles(VALID_TABLE);
    const categories = extractUniqueCategories(mappings);
    expect(categories).toHaveLength(3);
    expect(categories).toContain('coding');
    expect(categories).toContain('japanese-text');
    expect(categories).toContain('translation');
  });

  it('deduplicates categories', () => {
    const mappings = [
      { role: 'A', category: 'coding' as const },
      { role: 'B', category: 'coding' as const },
      { role: 'C', category: 'general' as const },
    ];
    const categories = extractUniqueCategories(mappings);
    expect(categories).toHaveLength(2);
    expect(categories).toContain('coding');
    expect(categories).toContain('general');
  });

  it('returns empty array for empty input', () => {
    expect(extractUniqueCategories([])).toEqual([]);
  });
});
