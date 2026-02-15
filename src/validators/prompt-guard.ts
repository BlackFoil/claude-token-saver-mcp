// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

interface InjectionPattern {
  readonly pattern: RegExp;
  readonly category: string;
  readonly severity: 'block' | 'warn';
}

export interface InjectionResult {
  readonly blocked: boolean;
  readonly threats: ReadonlyArray<{
    readonly category: string;
    readonly severity: 'block' | 'warn';
    readonly matched: string;
  }>;
}

export interface SanitizeResult {
  readonly sanitized: string;
  readonly detectedCategories: readonly string[];
  readonly redactionCount: number;
}

export const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  // Direct override
  { pattern: /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?|commands?)/i,
    category: 'direct-override', severity: 'block' },
  { pattern: /\boverride\s+(system|previous|all)\s*(prompt|instruction|rule|command)?s?/i,
    category: 'direct-override', severity: 'block' },
  { pattern: /\bdisregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?)/i,
    category: 'direct-override', severity: 'block' },
  { pattern: /\bforget\s+(all\s+)?(previous|prior|your)\s+(instructions?|rules?|context)/i,
    category: 'direct-override', severity: 'block' },

  // Role injection
  { pattern: /\bsystem\s*:/i, category: 'role-injection', severity: 'block' },
  { pattern: /\[SYSTEM\]/i, category: 'role-injection', severity: 'block' },
  { pattern: /<<\s*SYS\s*>>/i, category: 'role-injection', severity: 'block' },
  { pattern: /###\s*Instruction\s*:/i, category: 'role-injection', severity: 'block' },
  { pattern: /\[INST\]/i, category: 'role-injection', severity: 'block' },
  { pattern: /<\|im_start\|>\s*system/i, category: 'role-injection', severity: 'block' },
  { pattern: /<\|system\|>/i, category: 'role-injection', severity: 'block' },
  { pattern: /\bBEGIN\s+SYSTEM\s+PROMPT\b/i, category: 'role-injection', severity: 'block' },
  { pattern: /\bEND\s+SYSTEM\s+PROMPT\b/i, category: 'role-injection', severity: 'block' },

  // Prompt leak
  { pattern: /\b(show|print|display|reveal|output|repeat|echo)\s+(me\s+)?(your|the|system)\s*(prompt|instruction|rule|config)/i,
    category: 'prompt-leak', severity: 'block' },
  { pattern: /\bwhat\s+(are|is)\s+your\s+(system\s+)?(prompt|instruction|rule)/i,
    category: 'prompt-leak', severity: 'block' },

  // Encoding evasion
  { pattern: /\\x[0-9a-fA-F]{2}/g, category: 'encoding-evasion', severity: 'warn' },
  { pattern: /\\u[0-9a-fA-F]{4}/g, category: 'encoding-evasion', severity: 'warn' },
  { pattern: /&#x?[0-9a-fA-F]+;/g, category: 'encoding-evasion', severity: 'warn' },

  // Role switch
  { pattern: /\b(you\s+are\s+now|act\s+as|pretend\s+(to\s+be|you\s+are)|from\s+now\s+on\s+you\s+are)\b/i,
    category: 'role-switch', severity: 'block' },
  { pattern: /\bnew\s+(persona|identity|role|character)\s*:/i,
    category: 'role-switch', severity: 'block' },
];

const SENSITIVE_PATTERNS: readonly {
  pattern: RegExp;
  category: string;
  replacement: string;
}[] = [
  { pattern: /\b(sk-[a-zA-Z0-9]{20,})\b/g,
    category: 'api-key-anthropic', replacement: '[REDACTED:API_KEY]' },
  { pattern: /\b(sk-proj-[a-zA-Z0-9_-]{20,})\b/g,
    category: 'api-key-openai', replacement: '[REDACTED:API_KEY]' },
  { pattern: /\b(ghp_[a-zA-Z0-9]{36,})\b/g,
    category: 'github-pat', replacement: '[REDACTED:GITHUB_TOKEN]' },
  { pattern: /\b(gho_[a-zA-Z0-9]{36,})\b/g,
    category: 'github-oauth', replacement: '[REDACTED:GITHUB_TOKEN]' },
  { pattern: /\b(npm_[a-zA-Z0-9]{36,})\b/g,
    category: 'npm-token', replacement: '[REDACTED:NPM_TOKEN]' },
  { pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    category: 'aws-access-key', replacement: '[REDACTED:AWS_KEY]' },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
    category: 'password', replacement: 'password=[REDACTED:PASSWORD]' },
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
    category: 'private-key', replacement: '[REDACTED:PRIVATE_KEY]' },
  { pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/gi,
    category: 'connection-string', replacement: '[REDACTED:CONNECTION_STRING]' },
  { pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    category: 'jwt', replacement: '[REDACTED:JWT]' },
  { pattern: /(?:\/Users\/|\/home\/|C:\\Users\\)[^\s"']+/g,
    category: 'file-path', replacement: '[REDACTED:FILE_PATH]' },
];

export function detectPromptInjection(text: string): InjectionResult {
  const threats: { category: string; severity: 'block' | 'warn'; matched: string }[] = [];

  for (const { pattern, category, severity } of INJECTION_PATTERNS) {
    // Reset lastIndex for global patterns
    if (pattern.global) pattern.lastIndex = 0;

    const match = pattern.exec(text);
    if (match) {
      threats.push({
        category,
        severity,
        matched: match[0].substring(0, 100),
      });
    }

    // Reset again after exec
    if (pattern.global) pattern.lastIndex = 0;
  }

  const blocked = threats.some((t) => t.severity === 'block');

  return { blocked, threats };
}

export function sanitizeOutput(text: string): SanitizeResult {
  if (!text) {
    return { sanitized: '', detectedCategories: [], redactionCount: 0 };
  }

  let sanitized = text;
  const detectedCategories: string[] = [];
  let redactionCount = 0;

  for (const { pattern, category, replacement } of SENSITIVE_PATTERNS) {
    if (pattern.global) pattern.lastIndex = 0;

    const matches = sanitized.match(pattern);
    if (matches && matches.length > 0) {
      redactionCount += matches.length;
      if (!detectedCategories.includes(category)) {
        detectedCategories.push(category);
      }
      sanitized = sanitized.replace(pattern, replacement);
    }

    if (pattern.global) pattern.lastIndex = 0;
  }

  return { sanitized, detectedCategories, redactionCount };
}
