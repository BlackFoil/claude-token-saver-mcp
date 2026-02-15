// Copyright 2026 PulseAgent Team
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

const modelPricingSchema = z.object({
  inputPer1MTokens: z.number().positive().max(1000),
  outputPer1MTokens: z.number().positive().max(1000),
});

const ollamaConfigSchema = z.object({
  baseUrl: z.string().url().default('http://127.0.0.1:11434'),
});

const tierOverrideSchema = z
  .object({
    forceLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    primaryModel: z.string().min(1).optional(),
    fallbackModel: z.union([z.string().min(1), z.null()]).optional(),
    contextLimit: z.number().int().min(1000).max(128000).optional(),
  })
  .nullable()
  .default(null);

const timeoutOverrideSchema = z
  .object({
    requestTimeout: z.number().int().min(10_000).optional(),
    heartbeatTimeout: z.number().int().min(5_000).optional(),
    firstTokenTimeout: z.number().int().min(10_000).optional(),
    queueTimeout: z.number().int().min(5_000).optional(),
  })
  .nullable()
  .default(null);

const queueConfigSchema = z.object({
  maxQueueLength: z.number().int().min(1).max(100).default(10),
  maxRequestSizeBytes: z.number().int().min(1024).default(200 * 1024),
  queueTimeoutMs: z.number().int().min(5_000).default(60_000),
  rateLimitPerMinute: z.number().int().min(1).optional(),
});

const costConfigSchema = z.object({
  comparisonModel: z.string().min(1).default('claude-sonnet-4-5'),
  pricing: z.record(z.string(), modelPricingSchema).optional(),
});

const securityConfigSchema = z.object({
  enableInputSanitization: z.boolean().default(true),
});

const logLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
  .default('info');

export const appConfigSchema = z.object({
  ollama: ollamaConfigSchema.default({}),
  tier: tierOverrideSchema,
  timeout: timeoutOverrideSchema,
  queue: queueConfigSchema.default({}),
  cost: costConfigSchema.default({}),
  security: securityConfigSchema.default({}),
  logLevel: logLevelSchema,
});

export type AppConfigInput = z.input<typeof appConfigSchema>;
export type AppConfig = z.output<typeof appConfigSchema>;
