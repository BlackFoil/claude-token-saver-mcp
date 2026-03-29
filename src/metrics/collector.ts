// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * Prometheus-compatible metrics collector (P5-001).
 * Collects counters, gauges, and latency histograms and exports
 * them in Prometheus text exposition format or as a JSON snapshot.
 */

/** Snapshot of all metrics at a point in time. */
export interface MetricsSnapshot {
  readonly requestsTotal: number;
  readonly requestsByTool: Readonly<Record<string, number>>;
  readonly errorsTotal: number;
  readonly errorsByCode: Readonly<Record<string, number>>;
  readonly queueLength: number;
  readonly ollamaHealthy: boolean;
  readonly loadedModelsCount: number;
  readonly latencyQuantiles: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly totalSavingsUsd: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly uptimeMs: number;
}

export class MetricsCollector {
  // Counters
  private requestsTotal = 0;
  private requestsByTool: Record<string, number> = {};
  private errorsTotal = 0;
  private errorsByCode: Record<string, number> = {};

  // Gauges
  private queueLength = 0;
  private ollamaHealthy = false;
  private loadedModelsCount = 0;

  // Latency observations (raw values kept for quantile calculation)
  private latencyValues: number[] = [];

  // Cost / token counters
  private totalSavingsUsd = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  // Startup timestamp
  private readonly startedAt: number;

  constructor() {
    this.startedAt = Date.now();
  }

  // --------------- Recording methods ---------------

  /**
   * Record a tool request with its duration and outcome.
   * If the request failed, an optional error code may be provided.
   */
  recordRequest(
    toolName: string,
    durationMs: number,
    success: boolean,
    errorCode?: string,
  ): void {
    this.requestsTotal += 1;
    this.requestsByTool[toolName] =
      (this.requestsByTool[toolName] ?? 0) + 1;

    this.latencyValues.push(durationMs);

    if (!success) {
      this.errorsTotal += 1;
      if (errorCode) {
        this.errorsByCode[errorCode] =
          (this.errorsByCode[errorCode] ?? 0) + 1;
      }
    }
  }

  /** Record token usage from a single request. */
  recordTokens(inputTokens: number, outputTokens: number): void {
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
  }

  /** Record cost savings from a single request (USD). */
  recordSavings(savingsUsd: number): void {
    this.totalSavingsUsd += savingsUsd;
  }

  // --------------- Gauge setters ---------------

  updateQueueLength(length: number): void {
    this.queueLength = length;
  }

  updateOllamaHealth(healthy: boolean): void {
    this.ollamaHealthy = healthy;
  }

  updateLoadedModels(count: number): void {
    this.loadedModelsCount = count;
  }

  // --------------- Export: Prometheus text ---------------

  /**
   * Export all metrics in the Prometheus text exposition format
   * (https://prometheus.io/docs/instrumenting/exposition_formats/).
   */
  toPrometheusText(): string {
    const lines: string[] = [];

    // --- requests total ---
    lines.push('# HELP cts_requests_total Total number of tool requests');
    lines.push('# TYPE cts_requests_total counter');
    const toolNames = Object.keys(this.requestsByTool).sort();
    if (toolNames.length === 0) {
      lines.push('cts_requests_total 0');
    } else {
      for (const tool of toolNames) {
        lines.push(
          `cts_requests_total{tool="${tool}"} ${this.requestsByTool[tool] ?? 0}`,
        );
      }
    }

    // --- errors total ---
    lines.push('# HELP cts_errors_total Total number of errors');
    lines.push('# TYPE cts_errors_total counter');
    const errorCodes = Object.keys(this.errorsByCode).sort();
    if (errorCodes.length === 0) {
      lines.push('cts_errors_total 0');
    } else {
      for (const code of errorCodes) {
        lines.push(
          `cts_errors_total{code="${code}"} ${this.errorsByCode[code] ?? 0}`,
        );
      }
    }

    // --- latency summary ---
    lines.push('# HELP cts_request_duration_ms Request duration in milliseconds');
    lines.push('# TYPE cts_request_duration_ms summary');
    const { p50, p95, p99 } = this.computeQuantiles();
    lines.push(`cts_request_duration_ms{quantile="0.5"} ${p50}`);
    lines.push(`cts_request_duration_ms{quantile="0.95"} ${p95}`);
    lines.push(`cts_request_duration_ms{quantile="0.99"} ${p99}`);

    // --- gauges ---
    lines.push('# HELP cts_queue_length Current queue length');
    lines.push('# TYPE cts_queue_length gauge');
    lines.push(`cts_queue_length ${this.queueLength}`);

    lines.push('# HELP cts_ollama_healthy Whether Ollama is healthy');
    lines.push('# TYPE cts_ollama_healthy gauge');
    lines.push(`cts_ollama_healthy ${this.ollamaHealthy ? 1 : 0}`);

    lines.push('# HELP cts_loaded_models_count Number of loaded models');
    lines.push('# TYPE cts_loaded_models_count gauge');
    lines.push(`cts_loaded_models_count ${this.loadedModelsCount}`);

    // --- cost / tokens ---
    lines.push('# HELP cts_savings_usd_total Total cost savings in USD');
    lines.push('# TYPE cts_savings_usd_total counter');
    lines.push(`cts_savings_usd_total ${parseFloat(this.totalSavingsUsd.toFixed(4))}`);

    lines.push('# HELP cts_tokens_total Total tokens processed');
    lines.push('# TYPE cts_tokens_total counter');
    lines.push(`cts_tokens_total{direction="input"} ${this.totalInputTokens}`);
    lines.push(`cts_tokens_total{direction="output"} ${this.totalOutputTokens}`);

    return lines.join('\n') + '\n';
  }

  // --------------- Export: JSON ---------------

  /** Return a JSON-serialisable snapshot of all metrics. */
  toJSON(): MetricsSnapshot {
    const { p50, p95, p99 } = this.computeQuantiles();
    return {
      requestsTotal: this.requestsTotal,
      requestsByTool: { ...this.requestsByTool },
      errorsTotal: this.errorsTotal,
      errorsByCode: { ...this.errorsByCode },
      queueLength: this.queueLength,
      ollamaHealthy: this.ollamaHealthy,
      loadedModelsCount: this.loadedModelsCount,
      latencyQuantiles: { p50, p95, p99 },
      totalSavingsUsd: parseFloat(this.totalSavingsUsd.toFixed(4)),
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  // --------------- Internals ---------------

  /**
   * Compute quantiles from the stored latency observations.
   * Uses nearest-rank percentile method.
   */
  private computeQuantiles(): { p50: number; p95: number; p99: number } {
    if (this.latencyValues.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }
    const sorted = [...this.latencyValues].sort((a, b) => a - b);
    return {
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
    };
  }
}

/**
 * Nearest-rank percentile on a **pre-sorted** array.
 * Returns the value at ceil(p * N) - 1 (0-indexed).
 */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index] ?? 0;
}
