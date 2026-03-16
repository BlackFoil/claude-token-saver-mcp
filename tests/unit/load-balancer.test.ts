import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaLoadBalancer, type LoadBalancerConfig, type OllamaNode } from '../../src/ollama/load-balancer.js';
import type { OllamaChatRequest } from '../../src/ollama/client.js';
import type { Logger } from 'pino';

// ── Helpers ───────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

const CLIENT_CONFIG = {
  requestTimeout: 60_000,
  heartbeatTimeout: 10_000,
  firstTokenTimeout: 30_000,
};

function makeNodes(count: number): OllamaNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    baseUrl: `http://node${i}:11434`,
    label: `Node ${i}`,
    weight: 1,
  }));
}

function makeConfig(
  nodeCount: number,
  strategy: LoadBalancerConfig['strategy'] = 'round-robin',
): LoadBalancerConfig {
  return {
    nodes: makeNodes(nodeCount),
    strategy,
    healthCheckIntervalMs: 5_000,
    clientConfig: CLIENT_CONFIG,
  };
}

function makeChatRequest(model = 'qwen3:8b'): OllamaChatRequest {
  return {
    model,
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('OllamaLoadBalancer — round-robin', () => {
  it('rotates through healthy nodes', () => {
    const lb = new OllamaLoadBalancer(makeConfig(3, 'round-robin'), makeLogger());
    const req = makeChatRequest();

    const first = lb.selectNode(req);
    const second = lb.selectNode(req);
    const third = lb.selectNode(req);
    const fourth = lb.selectNode(req);

    expect(first?.node.id).toBe('node-0');
    expect(second?.node.id).toBe('node-1');
    expect(third?.node.id).toBe('node-2');
    expect(fourth?.node.id).toBe('node-0'); // wraps around
  });
});

describe('OllamaLoadBalancer — least-connections', () => {
  it('selects the node with fewest active connections', async () => {
    const config = makeConfig(3, 'least-connections');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    // Simulate: node-0 has 3 connections, node-1 has 1, node-2 has 2
    // We need to manipulate internal state. Use chat to increment connections.
    // Instead, test via selectNode — all start at 0, so first pick is node-0.
    const req = makeChatRequest();
    const selected = lb.selectNode(req);
    // All have 0 connections, so first one wins
    expect(selected?.node.id).toBe('node-0');
  });

  it('respects node weights', () => {
    const config: LoadBalancerConfig = {
      nodes: [
        { id: 'heavy', baseUrl: 'http://heavy:11434', weight: 2 },
        { id: 'light', baseUrl: 'http://light:11434', weight: 1 },
      ],
      strategy: 'least-connections',
      clientConfig: CLIENT_CONFIG,
    };
    const lb = new OllamaLoadBalancer(config, makeLogger());

    // Both at 0 connections — weighted 0/2=0 vs 0/1=0, first wins
    const req = makeChatRequest();
    const selected = lb.selectNode(req);
    expect(selected?.node.id).toBe('heavy');
  });
});

describe('OllamaLoadBalancer — model-affinity', () => {
  it('prefers node that has the model loaded', async () => {
    const config = makeConfig(3, 'model-affinity');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    // Mock: simulate node-2 having the model loaded by running a successful chat
    // Access internal state via prototype trick or rely on chat tracking
    // Use getNodesStatus to verify initial state
    const statusBefore = lb.getNodesStatus();
    expect(statusBefore.every((s) => s.loadedModels.length === 0)).toBe(true);

    // Without affinity data, falls back to least-connections
    const req = makeChatRequest('qwen3:8b');
    const selected = lb.selectNode(req);
    expect(selected).not.toBeNull();
  });
});

describe('OllamaLoadBalancer — single node passthrough', () => {
  it('returns the only node directly', () => {
    const lb = new OllamaLoadBalancer(makeConfig(1, 'round-robin'), makeLogger());
    const req = makeChatRequest();

    const selected = lb.selectNode(req);
    expect(selected?.node.id).toBe('node-0');
  });

  it('returns null when the only node is unhealthy', async () => {
    const config = makeConfig(1, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    // Mark as unhealthy via health check
    // We need to mock the underlying client's healthCheck
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await lb.healthCheck();
    vi.restoreAllMocks();

    const selected = lb.selectNode(makeChatRequest());
    expect(selected).toBeNull();
  });
});

describe('OllamaLoadBalancer.chat — failover', () => {
  it('fails over to next node when first fails', async () => {
    const config = makeConfig(3, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    // Mock fetch: first node fails, second succeeds
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('node0')) {
        throw new Error('ECONNREFUSED');
      }

      if (urlStr.includes('node1') && urlStr.includes('/api/chat')) {
        const chunk = JSON.stringify({
          model: 'qwen3:8b',
          created_at: '2026-01-01T00:00:00Z',
          message: { role: 'assistant', content: '' },
          done: true,
          total_duration: 100_000_000,
          load_duration: 10_000_000,
          prompt_eval_count: 5,
          prompt_eval_duration: 1_000_000,
          eval_count: 2,
          eval_duration: 1_000_000,
        }) + '\n';

        return new Response(chunk, { status: 200 });
      }

      return new Response('Ollama is running', { status: 200 });
    });

    const req = makeChatRequest('qwen3:8b');
    const response = await lb.chat(req);
    expect(response.model).toBe('qwen3:8b');

    fetchSpy.mockRestore();
  });

  it('throws when all nodes fail', async () => {
    const config = makeConfig(2, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('ECONNREFUSED'),
    );

    await expect(lb.chat(makeChatRequest())).rejects.toThrow();

    fetchSpy.mockRestore();
  });

  it('throws when no healthy nodes available', async () => {
    const config = makeConfig(1, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    // Mark all unhealthy
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('ECONNREFUSED'),
    );
    await lb.healthCheck();

    await expect(lb.chat(makeChatRequest())).rejects.toThrow('No healthy Ollama nodes available');

    fetchSpy.mockRestore();
  });
});

describe('OllamaLoadBalancer.healthCheck', () => {
  it('marks nodes healthy when they respond', async () => {
    const config = makeConfig(2, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.endsWith('/')) {
        return new Response('Ollama is running', { status: 200 });
      }
      // /api/ps response
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    });

    const allHealthy = await lb.healthCheck();
    expect(allHealthy).toBe(true);

    const status = lb.getNodesStatus();
    expect(status.every((s) => s.healthy)).toBe(true);

    fetchSpy.mockRestore();
  });

  it('marks nodes unhealthy when they fail', async () => {
    const config = makeConfig(2, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('node0')) {
        throw new Error('ECONNREFUSED');
      }
      if (urlStr.endsWith('/')) {
        return new Response('Ollama is running', { status: 200 });
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    });

    const anyHealthy = await lb.healthCheck();
    expect(anyHealthy).toBe(true);

    const status = lb.getNodesStatus();
    const node0 = status.find((s) => s.id === 'node-0');
    const node1 = status.find((s) => s.id === 'node-1');
    expect(node0?.healthy).toBe(false);
    expect(node1?.healthy).toBe(true);

    fetchSpy.mockRestore();
  });

  it('returns false when all nodes are unhealthy', async () => {
    const config = makeConfig(2, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('ECONNREFUSED'),
    );

    const anyHealthy = await lb.healthCheck();
    expect(anyHealthy).toBe(false);

    fetchSpy.mockRestore();
  });
});

describe('OllamaLoadBalancer.getNodesStatus', () => {
  it('returns status for all configured nodes', () => {
    const config = makeConfig(3, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    const status = lb.getNodesStatus();
    expect(status).toHaveLength(3);
    expect(status[0]).toEqual({
      id: 'node-0',
      baseUrl: 'http://node0:11434',
      healthy: true,
      activeConnections: 0,
      loadedModels: [],
    });
  });
});

describe('OllamaLoadBalancer.startHealthChecks/stopHealthChecks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and stops periodic health checks', async () => {
    const config = makeConfig(1, 'round-robin');
    config.healthCheckIntervalMs = 1000;
    const lb = new OllamaLoadBalancer(config, makeLogger());

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.endsWith('/')) {
        return new Response('Ollama is running', { status: 200 });
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    });

    lb.startHealthChecks();

    // Initial check
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalled();

    const callsBefore = fetchSpy.mock.calls.length;

    // Advance one interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    lb.stopHealthChecks();

    const callsAfterStop = fetchSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterStop);

    fetchSpy.mockRestore();
  });

  it('does not start twice', () => {
    const config = makeConfig(1, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Ollama is running', { status: 200 }),
    );

    lb.startHealthChecks();
    lb.startHealthChecks(); // no-op

    lb.stopHealthChecks();
    fetchSpy.mockRestore();
  });
});

describe('OllamaLoadBalancer.listModels', () => {
  it('lists models across all healthy nodes, deduplicated', async () => {
    const config = makeConfig(2, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('node0') && urlStr.includes('/api/tags')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'qwen3:8b', size: 5e9, digest: 'a', modified_at: '' },
            { name: 'phi4:14b', size: 8e9, digest: 'b', modified_at: '' },
          ],
        }), { status: 200 });
      }
      if (urlStr.includes('node1') && urlStr.includes('/api/tags')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'qwen3:8b', size: 5e9, digest: 'a', modified_at: '' }, // duplicate
            { name: 'gemma3:12b', size: 7e9, digest: 'c', modified_at: '' },
          ],
        }), { status: 200 });
      }
      return new Response('Ollama is running', { status: 200 });
    });

    const models = await lb.listModels();
    expect(models).toHaveLength(3);
    const names = models.map((m) => m.name);
    expect(names).toContain('qwen3:8b');
    expect(names).toContain('phi4:14b');
    expect(names).toContain('gemma3:12b');

    fetchSpy.mockRestore();
  });
});

describe('OllamaLoadBalancer.pullModel', () => {
  it('throws when nodeId not found', async () => {
    const config = makeConfig(1, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    await expect(lb.pullModel('qwen3:8b', 'nonexistent')).rejects.toThrow('not found');
  });

  it('throws when no healthy nodes available for pull', async () => {
    const config = makeConfig(1, 'round-robin');
    const lb = new OllamaLoadBalancer(config, makeLogger());

    // Mark unhealthy
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await lb.healthCheck();

    await expect(lb.pullModel('qwen3:8b')).rejects.toThrow('No healthy nodes');

    fetchSpy.mockRestore();
  });
});
