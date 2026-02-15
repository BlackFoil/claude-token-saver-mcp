// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

// --- 型定義 ---

/** offload_work ツールのサポート言語 */
const supportedLanguages = [
  'typescript', 'javascript', 'python', 'go', 'rust',
  'java', 'c', 'cpp', 'csharp', 'ruby', 'php', 'swift',
  'kotlin', 'scala', 'shell', 'sql', 'html', 'css', 'markdown',
] as const;

/** offload_work ツールの出力フォーマット */
const outputFormats = ['code', 'diff', 'explanation', 'raw'] as const;

// --- Zod スキーマ ---

/**
 * offload_work ツール入力のバリデーションスキーマ
 *
 * task: 必須、最大50,000文字
 * context: 任意、最大100,000文字
 * language: 任意、サポート言語の列挙値
 * output_format: 任意、出力フォーマットの列挙値
 */
export const offloadWorkSchema = z.object({
  task: z
    .string({ required_error: 'task は必須です' })
    .min(1, 'task は空文字列にできません')
    .max(50_000, 'task は50,000文字以内である必要があります'),
  context: z
    .string()
    .max(100_000, 'context は100,000文字以内である必要があります')
    .optional(),
  language: z
    .enum(supportedLanguages, {
      errorMap: () => ({
        message: `language は次のいずれかである必要があります: ${supportedLanguages.join(', ')}`,
      }),
    })
    .optional(),
  output_format: z
    .enum(outputFormats, {
      errorMap: () => ({
        message: `output_format は次のいずれかである必要があります: ${outputFormats.join(', ')}`,
      }),
    })
    .optional(),
});

/**
 * compress_context ツール入力のバリデーションスキーマ
 *
 * content: 必須、最大200,000文字
 * focus: 任意、最大500文字
 * max_length: 任意、100〜10,000の整数
 */
export const compressContextSchema = z.object({
  content: z
    .string({ required_error: 'content は必須です' })
    .min(1, 'content は空文字列にできません')
    .max(200_000, 'content は200,000文字以内である必要があります'),
  focus: z
    .string()
    .max(500, 'focus は500文字以内である必要があります')
    .optional(),
  max_length: z
    .number({ invalid_type_error: 'max_length は数値である必要があります' })
    .int('max_length は整数である必要があります')
    .min(100, 'max_length は100以上である必要があります')
    .max(10_000, 'max_length は10,000以下である必要があります')
    .optional(),
});

// --- 推論型 ---

export type OffloadWorkInput = z.infer<typeof offloadWorkSchema>;
export type CompressContextInput = z.infer<typeof compressContextSchema>;

// --- バリデーション結果型 ---

export interface ValidatedOffloadWorkInput {
  readonly input: OffloadWorkInput;
  readonly totalBytes: number;
  readonly estimatedTokens: number;
}

export interface ValidatedCompressContextInput {
  readonly input: CompressContextInput;
  readonly totalBytes: number;
  readonly estimatedTokens: number;
  readonly requiresTruncation: boolean;
}

// --- 内部ヘルパー ---

/**
 * テキストのトークン数を簡易推定する
 *
 * 英語は約4文字/token、日本語は約2文字/token。
 * 多言語対応のため保守的に3文字/tokenで推定。
 * tiktokenライブラリへの依存を避けつつ安全マージンを確保する。
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3);
}

// --- バリデーション関数 ---

/**
 * offload_work ツールの入力をバリデーションする
 *
 * zodスキーマによる型・値チェックに加え、
 * 合計バイト数の上限チェックとトークン数推定を行う。
 *
 * @param input - MCPリクエストから受け取った未検証の入力
 * @param maxRequestSizeBytes - リクエストサイズ上限（バイト数）
 * @returns バリデーション済み入力とメタデータ
 * @throws zodバリデーション失敗時、またはサイズ超過時
 */
export function validateOffloadWorkInput(
  input: unknown,
  maxRequestSizeBytes: number,
): ValidatedOffloadWorkInput {
  // zodによるスキーマバリデーション
  const parseResult = offloadWorkSchema.safeParse(input);
  if (!parseResult.success) {
    const messages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `入力バリデーションエラー (CTS-5001): ${messages}`,
    );
  }

  const validated = parseResult.data;

  // 合計バイト数の計算
  const taskBytes = Buffer.byteLength(validated.task, 'utf-8');
  const contextBytes = validated.context
    ? Buffer.byteLength(validated.context, 'utf-8')
    : 0;
  const totalBytes = taskBytes + contextBytes;

  // サイズ上限チェック
  if (totalBytes > maxRequestSizeBytes) {
    throw new Error(
      `リクエストサイズ (${totalBytes}B) が上限 (${maxRequestSizeBytes}B) を超えています (CTS-5002)`,
    );
  }

  const combinedText = validated.task + (validated.context ?? '');
  const estimatedTokens = estimateTokenCount(combinedText);

  return {
    input: validated,
    totalBytes,
    estimatedTokens,
  };
}

/**
 * compress_context ツールの入力をバリデーションする
 *
 * zodスキーマによる型・値チェックに加え、
 * バイト数上限チェック、トークン数推定、切り詰め判定を行う。
 *
 * @param input - MCPリクエストから受け取った未検証の入力
 * @param maxRequestSizeBytes - リクエストサイズ上限（バイト数）
 * @param contextLimitTokens - 現在のTierのコンテキストトークン上限
 * @returns バリデーション済み入力とメタデータ
 * @throws zodバリデーション失敗時、またはサイズ超過時
 */
export function validateCompressContextInput(
  input: unknown,
  maxRequestSizeBytes: number,
  contextLimitTokens: number,
): ValidatedCompressContextInput {
  // zodによるスキーマバリデーション
  const parseResult = compressContextSchema.safeParse(input);
  if (!parseResult.success) {
    const messages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `入力バリデーションエラー (CTS-5001): ${messages}`,
    );
  }

  const validated = parseResult.data;

  // バイト数の計算
  const totalBytes = Buffer.byteLength(validated.content, 'utf-8');

  // サイズ上限チェック
  if (totalBytes > maxRequestSizeBytes) {
    throw new Error(
      `リクエストサイズ (${totalBytes}B) が上限 (${maxRequestSizeBytes}B) を超えています (CTS-5002)`,
    );
  }

  const estimatedTokens = estimateTokenCount(validated.content);
  const requiresTruncation = estimatedTokens > contextLimitTokens;

  return {
    input: validated,
    totalBytes,
    estimatedTokens,
    requiresTruncation,
  };
}
