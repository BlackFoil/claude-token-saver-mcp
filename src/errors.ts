// Copyright 2026 claude-token-saver-mcp Contributors
// SPDX-License-Identifier: Apache-2.0

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type CTSErrorCode =
  | 'CTS-1001' | 'CTS-1002'
  | 'CTS-2001' | 'CTS-2002'
  | 'CTS-3001'
  | 'CTS-4001' | 'CTS-4002'
  | 'CTS-5001' | 'CTS-5002'
  | 'CTS-6001';

export interface MCPErrorResponse {
  readonly code: CTSErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export class CTSError extends Error {
  readonly code: CTSErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly fallbackToCloud: boolean;
  readonly timestamp: string;

  constructor(
    code: CTSErrorCode,
    message: string,
    options: {
      httpStatus?: number;
      retryable?: boolean;
      fallbackToCloud?: boolean;
      cause?: Error;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'CTSError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? 500;
    this.retryable = options.retryable ?? false;
    this.fallbackToCloud = options.fallbackToCloud ?? true;
    this.timestamp = new Date().toISOString();
  }

  toMCPError(): MCPErrorResponse {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

// --- Ollama接続エラー (CTS-1xxx) ---

export class OllamaConnectionError extends CTSError {
  constructor(codeOrMessage: 'CTS-1001' | 'CTS-1002' | string, message?: string, cause?: Error) {
    const isCode = codeOrMessage === 'CTS-1001' || codeOrMessage === 'CTS-1002';
    const code: CTSErrorCode = isCode ? codeOrMessage : 'CTS-1001';
    const msg = isCode ? (message ?? codeOrMessage) : codeOrMessage;
    super(code, msg, {
      httpStatus: 503,
      retryable: true,
      fallbackToCloud: true,
      cause,
    });
    this.name = 'OllamaConnectionError';
  }
}

export class OllamaNotRunningError extends OllamaConnectionError {
  constructor(message?: string | Error, cause?: Error) {
    const msg = typeof message === 'string'
      ? message
      : 'Ollamaが起動していません。`ollama serve` を実行してください。';
    const errCause = message instanceof Error ? message : cause;
    super('CTS-1001', msg, errCause);
    this.name = 'OllamaNotRunningError';
  }
}

export class OllamaVersionError extends OllamaConnectionError {
  constructor(messageOrCurrentVersion: string, requiredVersion?: string) {
    const msg = requiredVersion
      ? `Ollamaバージョン ${messageOrCurrentVersion} は非対応です。${requiredVersion} 以上が必要です。`
      : messageOrCurrentVersion;
    super('CTS-1002', msg);
    this.name = 'OllamaVersionError';
  }
}

// --- Ollamaタイムアウトエラー (CTS-2xxx) ---

export class OllamaTimeoutError extends CTSError {
  readonly timeoutMs: number;

  constructor(
    code: 'CTS-2001' | 'CTS-2002',
    message: string,
    timeoutMs: number,
    cause?: Error,
  ) {
    super(code, message, {
      httpStatus: 504,
      retryable: false,
      fallbackToCloud: true,
      cause,
    });
    this.name = 'OllamaTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class ModelLoadTimeoutError extends OllamaTimeoutError {
  constructor(messageOrModelName: string, timeoutMs: number) {
    const isCustomMsg = messageOrModelName.includes(' ');
    super(
      'CTS-2001',
      isCustomMsg
        ? messageOrModelName
        : `モデル ${messageOrModelName} のロードが ${timeoutMs / 1000}秒 でタイムアウトしました。`,
      timeoutMs,
    );
    this.name = 'ModelLoadTimeoutError';
  }
}

export class GenerationTimeoutError extends OllamaTimeoutError {
  readonly tier: number;

  constructor(messageOrTimeoutMs: string | number, timeoutMsOrTier: number) {
    if (typeof messageOrTimeoutMs === 'string') {
      // client.ts pattern: new GenerationTimeoutError(message, timeoutMs)
      super('CTS-2002', messageOrTimeoutMs, timeoutMsOrTier);
      this.tier = 0;
    } else {
      // errors.ts pattern: new GenerationTimeoutError(timeoutMs, tier)
      super(
        'CTS-2002',
        `Tier ${timeoutMsOrTier} の生成が ${messageOrTimeoutMs / 1000}秒 でタイムアウトしました。クラウドAPIで直接処理してください。`,
        messageOrTimeoutMs,
      );
      this.tier = timeoutMsOrTier;
    }
    this.name = 'GenerationTimeoutError';
  }
}

// --- モデルエラー (CTS-3xxx) ---

export class ModelNotFoundError extends CTSError {
  constructor(modelNameOrMessage: string) {
    const isCustomMsg = modelNameOrMessage.includes(' ');
    super(
      'CTS-3001',
      isCustomMsg ? modelNameOrMessage : `モデル ${modelNameOrMessage} が見つかりません。自動pullを試行します。`,
      {
        httpStatus: 404,
        retryable: true,
        fallbackToCloud: false,
      },
    );
    this.name = 'ModelNotFoundError';
  }
}

// --- キューエラー (CTS-4xxx) ---

export class QueueError extends CTSError {
  constructor(
    code: 'CTS-4001' | 'CTS-4002',
    message: string,
    options?: { retryable?: boolean },
  ) {
    super(code, message, {
      httpStatus: 429,
      retryable: options?.retryable ?? false,
      fallbackToCloud: true,
    });
    this.name = 'QueueError';
  }
}

export class QueueFullError extends QueueError {
  constructor(currentSize: number, maxSize: number) {
    super(
      'CTS-4001',
      `キューが満杯です（${currentSize}/${maxSize}）。クラウドAPIで直接処理してください。`,
      { retryable: false },
    );
    this.name = 'QueueFullError';
  }
}

export class RateLimitError extends QueueError {
  constructor(limitPerMinute: number) {
    super(
      'CTS-4002',
      `レートリミット超過: ${limitPerMinute}リクエスト/分の上限に達しました。`,
      { retryable: true },
    );
    this.name = 'RateLimitError';
  }
}

// --- 入力バリデーションエラー (CTS-5xxx) ---

export class InputValidationError extends CTSError {
  constructor(code: 'CTS-5001' | 'CTS-5002', message: string) {
    super(code, message, {
      httpStatus: 400,
      retryable: false,
      fallbackToCloud: false,
    });
    this.name = 'InputValidationError';
  }
}

export class PromptInjectionError extends InputValidationError {
  constructor(detectedPattern: string) {
    super(
      'CTS-5001',
      `プロンプトインジェクションの疑いを検出しました: ${detectedPattern}`,
    );
    this.name = 'PromptInjectionError';
  }
}

export class ContextOverflowError extends InputValidationError {
  constructor(inputTokens: number, maxTokens: number, tier: number) {
    super(
      'CTS-5002',
      `入力トークン数 (${inputTokens}) がTier ${tier} の上限 (${maxTokens}) を超えています。`,
    );
    this.name = 'ContextOverflowError';
  }
}

// --- 設定エラー (CTS-6xxx) ---

export class ConfigError extends CTSError {
  constructor(code: 'CTS-6001', message: string) {
    super(code, message, {
      httpStatus: 500,
      retryable: false,
      fallbackToCloud: false,
    });
    this.name = 'ConfigError';
  }
}

export class InvalidConfigError extends ConfigError {
  constructor(configKey: string, reason: string) {
    super('CTS-6001', `設定エラー: ${configKey} — ${reason}`);
    this.name = 'InvalidConfigError';
  }
}

// --- MCP CallToolResult変換ヘルパー ---

export function ctsErrorToCallToolResult(error: unknown): CallToolResult {
  if (error instanceof CTSError) {
    const lines: string[] = [
      `[${error.code}] ${error.message}`,
    ];

    if (error.fallbackToCloud) {
      lines.push('');
      lines.push('FALLBACK: このタスクはクラウドAPIで直接処理してください。');
    }

    if (error.retryable) {
      lines.push('RETRY: このエラーは一時的です。しばらく後に再試行できます。');
    }

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
        },
      ],
      isError: true,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: 'text',
        text: `[CTS-0000] 予期しないエラーが発生しました: ${message}`,
      },
    ],
    isError: true,
  };
}
