import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsCollector } from '../../src/metrics/collector.js';
import type { MetricsSnapshot } from '../../src/metrics/collector.js';
import { handleGetMetrics } from '../../src/tools/get-metrics.js';
import type { GetMetricsContext } from '../../src/tools/get-metrics.js';

// --------------- MetricsCollector unit tests ---------------

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  // --- recordRequest ---

  it('increments requestsTotal and per-tool counters', () => {
    collector.recordRequest('offload_work', 100, true);
    collector.recordRequest('offload_work', 200, true);
    collector.recordRequest('compress_context', 50, true);

    const snap = collector.toJSON();
    expect(snap.requestsTotal).toBe(3);
    expect(snap.requestsByTool).toEqual({
      offload_work: 2,
      compress_context: 1,
    });
  });

  it('increments error counters on failed requests', () => {
    collector.recordRequest('offload_work', 100, false, 'CTS-1001');
    collector.recordRequest('offload_work', 200, false, 'CTS-1001');
    collector.recordRequest('offload_work', 300, false, 'CTS-2001');

    const snap = collector.toJSON();
    expect(snap.errorsTotal).toBe(3);
    expect(snap.errorsByCode).toEqual({
      'CTS-1001': 2,
      'CTS-2001': 1,
    });
  });

  it('does not increment errors on successful requests', () => {
    collector.recordRequest('offload_work', 100, true);
    const snap = collector.toJSON();
    expect(snap.errorsTotal).toBe(0);
    expect(snap.errorsByCode).toEqual({});
  });

  it('handles failed request without errorCode', () => {
    collector.recordRequest('offload_work', 100, false);
    const snap = collector.toJSON();
    expect(snap.errorsTotal).toBe(1);
    expect(snap.errorsByCode).toEqual({});
  });

  // --- recordTokens ---

  it('accumulates token counts', () => {
    collector.recordTokens(1000, 500);
    collector.recordTokens(2000, 1500);

    const snap = collector.toJSON();
    expect(snap.totalInputTokens).toBe(3000);
    expect(snap.totalOutputTokens).toBe(2000);
  });

  // --- recordSavings ---

  it('accumulates savings in USD', () => {
    collector.recordSavings(0.5);
    collector.recordSavings(0.75);

    const snap = collector.toJSON();
    expect(snap.totalSavingsUsd).toBe(1.25);
  });

  // --- gauge setters ---

  it('updates queueLength gauge', () => {
    collector.updateQueueLength(5);
    expect(collector.toJSON().queueLength).toBe(5);

    collector.updateQueueLength(0);
    expect(collector.toJSON().queueLength).toBe(0);
  });

  it('updates ollamaHealthy gauge', () => {
    expect(collector.toJSON().ollamaHealthy).toBe(false);

    collector.updateOllamaHealth(true);
    expect(collector.toJSON().ollamaHealthy).toBe(true);

    collector.updateOllamaHealth(false);
    expect(collector.toJSON().ollamaHealthy).toBe(false);
  });

  it('updates loadedModelsCount gauge', () => {
    collector.updateLoadedModels(3);
    expect(collector.toJSON().loadedModelsCount).toBe(3);
  });

  // --- quantile calculation ---

  it('returns zero quantiles when no latency data', () => {
    const snap = collector.toJSON();
    expect(snap.latencyQuantiles).toEqual({ p50: 0, p95: 0, p99: 0 });
  });

  it('computes correct quantiles for a single value', () => {
    collector.recordRequest('test', 500, true);
    const snap = collector.toJSON();
    expect(snap.latencyQuantiles.p50).toBe(500);
    expect(snap.latencyQuantiles.p95).toBe(500);
    expect(snap.latencyQuantiles.p99).toBe(500);
  });

  it('computes correct quantiles for multiple values', () => {
    // Record 100 values: 1, 2, 3, ..., 100
    for (let i = 1; i <= 100; i++) {
      collector.recordRequest('test', i, true);
    }
    const snap = collector.toJSON();
    expect(snap.latencyQuantiles.p50).toBe(50);
    expect(snap.latencyQuantiles.p95).toBe(95);
    expect(snap.latencyQuantiles.p99).toBe(99);
  });

  it('computes quantiles correctly with unordered input', () => {
    const values = [500, 100, 300, 200, 400];
    for (const v of values) {
      collector.recordRequest('test', v, true);
    }
    const snap = collector.toJSON();
    // sorted: [100, 200, 300, 400, 500]
    // p50 = ceil(0.5*5)-1 = 2 -> 300
    // p95 = ceil(0.95*5)-1 = 4 -> 500
    // p99 = ceil(0.99*5)-1 = 4 -> 500
    expect(snap.latencyQuantiles.p50).toBe(300);
    expect(snap.latencyQuantiles.p95).toBe(500);
    expect(snap.latencyQuantiles.p99).toBe(500);
  });

  // --- uptimeMs ---

  it('reports positive uptimeMs', () => {
    const snap = collector.toJSON();
    expect(snap.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  // --- toPrometheusText ---

  describe('toPrometheusText', () => {
    it('produces valid Prometheus text with all metric families', () => {
      collector.recordRequest('offload_work', 2500, true);
      collector.recordRequest('compress_context', 1500, true);
      collector.recordRequest('offload_work', 8000, false, 'CTS-1001');
      collector.recordTokens(50000, 25000);
      collector.recordSavings(1.4567);
      collector.updateQueueLength(3);
      collector.updateOllamaHealth(true);
      collector.updateLoadedModels(2);

      const text = collector.toPrometheusText();

      // Check HELP and TYPE annotations
      expect(text).toContain('# HELP cts_requests_total Total number of tool requests');
      expect(text).toContain('# TYPE cts_requests_total counter');
      expect(text).toContain('# HELP cts_errors_total Total number of errors');
      expect(text).toContain('# TYPE cts_errors_total counter');
      expect(text).toContain('# HELP cts_request_duration_ms Request duration in milliseconds');
      expect(text).toContain('# TYPE cts_request_duration_ms summary');
      expect(text).toContain('# HELP cts_queue_length Current queue length');
      expect(text).toContain('# TYPE cts_queue_length gauge');
      expect(text).toContain('# HELP cts_ollama_healthy Whether Ollama is healthy');
      expect(text).toContain('# TYPE cts_ollama_healthy gauge');
      expect(text).toContain('# HELP cts_loaded_models_count Number of loaded models');
      expect(text).toContain('# TYPE cts_loaded_models_count gauge');
      expect(text).toContain('# HELP cts_savings_usd_total Total cost savings in USD');
      expect(text).toContain('# TYPE cts_savings_usd_total counter');
      expect(text).toContain('# HELP cts_tokens_total Total tokens processed');
      expect(text).toContain('# TYPE cts_tokens_total counter');

      // Check metric values
      expect(text).toContain('cts_requests_total{tool="offload_work"} 2');
      expect(text).toContain('cts_requests_total{tool="compress_context"} 1');
      expect(text).toContain('cts_errors_total{code="CTS-1001"} 1');
      expect(text).toContain('cts_queue_length 3');
      expect(text).toContain('cts_ollama_healthy 1');
      expect(text).toContain('cts_loaded_models_count 2');
      expect(text).toContain('cts_savings_usd_total 1.4567');
      expect(text).toContain('cts_tokens_total{direction="input"} 50000');
      expect(text).toContain('cts_tokens_total{direction="output"} 25000');

      // Check quantile lines
      expect(text).toContain('cts_request_duration_ms{quantile="0.5"}');
      expect(text).toContain('cts_request_duration_ms{quantile="0.95"}');
      expect(text).toContain('cts_request_duration_ms{quantile="0.99"}');

      // Must end with newline
      expect(text.endsWith('\n')).toBe(true);
    });

    it('handles empty state gracefully', () => {
      const text = collector.toPrometheusText();

      expect(text).toContain('cts_requests_total 0');
      expect(text).toContain('cts_errors_total 0');
      expect(text).toContain('cts_queue_length 0');
      expect(text).toContain('cts_ollama_healthy 0');
      expect(text).toContain('cts_loaded_models_count 0');
      expect(text).toContain('cts_savings_usd_total 0');
      expect(text).toContain('cts_tokens_total{direction="input"} 0');
      expect(text).toContain('cts_tokens_total{direction="output"} 0');
      expect(text).toContain('cts_request_duration_ms{quantile="0.5"} 0');
    });

    it('shows ollamaHealthy as 0 when unhealthy', () => {
      collector.updateOllamaHealth(false);
      expect(collector.toPrometheusText()).toContain('cts_ollama_healthy 0');
    });

    it('sorts tool names and error codes alphabetically', () => {
      collector.recordRequest('zebra', 10, false, 'CTS-9999');
      collector.recordRequest('alpha', 20, false, 'CTS-0001');

      const text = collector.toPrometheusText();
      const toolAlphaIdx = text.indexOf('tool="alpha"');
      const toolZebraIdx = text.indexOf('tool="zebra"');
      expect(toolAlphaIdx).toBeLessThan(toolZebraIdx);

      const codeAIdx = text.indexOf('code="CTS-0001"');
      const codeZIdx = text.indexOf('code="CTS-9999"');
      expect(codeAIdx).toBeLessThan(codeZIdx);
    });
  });

  // --- concurrent recording ---

  it('handles many rapid recordings without data loss', () => {
    const count = 10_000;
    for (let i = 0; i < count; i++) {
      collector.recordRequest('tool', i, true);
    }
    const snap = collector.toJSON();
    expect(snap.requestsTotal).toBe(count);
    expect(snap.requestsByTool['tool']).toBe(count);
  });

  // --- toJSON snapshot immutability ---

  it('returns an independent snapshot from toJSON', () => {
    collector.recordRequest('tool_a', 100, true);
    const snap1 = collector.toJSON();

    collector.recordRequest('tool_b', 200, true);
    const snap2 = collector.toJSON();

    expect(snap1.requestsTotal).toBe(1);
    expect(snap2.requestsTotal).toBe(2);
    expect(snap1.requestsByTool).not.toHaveProperty('tool_b');
  });

  // --- savings precision ---

  it('rounds savings to 4 decimal places', () => {
    collector.recordSavings(0.00001);
    collector.recordSavings(0.00002);
    const snap = collector.toJSON();
    expect(snap.totalSavingsUsd).toBe(0);

    collector.recordSavings(0.12345);
    const snap2 = collector.toJSON();
    expect(snap2.totalSavingsUsd).toBe(0.1235);
  });
});

// --------------- handleGetMetrics tool tests ---------------

describe('handleGetMetrics (P5-001)', () => {
  function createCtx(collector?: MetricsCollector): GetMetricsContext {
    return {
      metricsCollector: collector ?? new MetricsCollector(),
      logger: { debug: vi.fn(), info: vi.fn() } as unknown as GetMetricsContext['logger'],
    };
  }

  it('returns JSON format by default', async () => {
    const collector = new MetricsCollector();
    collector.recordRequest('offload_work', 100, true);
    const ctx = createCtx(collector);

    const result = await handleGetMetrics({}, ctx);
    const text = (result.content[0] as { text: string }).text;
    const parsed: MetricsSnapshot = JSON.parse(text);

    expect(result.isError).toBeUndefined();
    expect(parsed.requestsTotal).toBe(1);
    expect(parsed.requestsByTool).toEqual({ offload_work: 1 });
  });

  it('returns JSON when format is explicitly "json"', async () => {
    const ctx = createCtx();
    const result = await handleGetMetrics({ format: 'json' }, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('returns Prometheus text when format is "prometheus"', async () => {
    const collector = new MetricsCollector();
    collector.updateOllamaHealth(true);
    const ctx = createCtx(collector);

    const result = await handleGetMetrics({ format: 'prometheus' }, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('# HELP cts_requests_total');
    expect(text).toContain('cts_ollama_healthy 1');
  });

  it('defaults to JSON for null args', async () => {
    const ctx = createCtx();
    const result = await handleGetMetrics(null, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('defaults to JSON for undefined args', async () => {
    const ctx = createCtx();
    const result = await handleGetMetrics(undefined, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('ignores unknown format values and defaults to JSON', async () => {
    const ctx = createCtx();
    const result = await handleGetMetrics({ format: 'xml' }, ctx);
    const text = (result.content[0] as { text: string }).text;

    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('logs debug message with format', async () => {
    const ctx = createCtx();
    await handleGetMetrics({ format: 'prometheus' }, ctx);

    expect(ctx.logger.debug).toHaveBeenCalledWith({ format: 'prometheus' }, 'get_metrics called');
  });
});
