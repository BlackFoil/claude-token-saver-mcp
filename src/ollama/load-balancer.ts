// Copyright 2026 claude-token-saver-mcp team
// SPDX-License-Identifier: Apache-2.0

/**
 * Distributed Execution — Multi-Node Ollama Load Balancer (P6-004)
 *
 * Supports round-robin, least-connections, and model-affinity strategies
 * with automatic failover and periodic health checks.
 */

import {
  OllamaClient,
  type OllamaClientConfig,
  type OllamaChatRequest,
  type OllamaChatResponse,
  type OllamaModelInfo,
} from './client.js';
import type { Logger } from 'pino';

// ── Types ─────────────────────────────────────────────────────

export interface OllamaNode {
  /** Unique node identifier */
  id: string;
  /** Base URL of the Ollama instance */
  baseUrl: string;
  /** Optional label */
  label?: string;
  /** Weight for load balancing (default: 1) */
  weight?: number;
}

export type LoadBalancerStrategy = 'round-robin' | 'least-connections' | 'model-affinity';

export interface LoadBalancerConfig {
  /** List of Ollama nodes */
  nodes: OllamaNode[];
  /** Strategy for load balancing */
  strategy: LoadBalancerStrategy;
  /** Health check interval in ms (default: 30000) */
  healthCheckIntervalMs?: number;
  /** Timeout configs inherited by all node clients */
  clientConfig: Omit<OllamaClientConfig, 'baseUrl'>;
}

export interface NodeState {
  client: OllamaClient;
  node: OllamaNode;
  healthy: boolean;
  activeConnections: number;
  loadedModels: Set<string>;
  lastHealthCheck: number;
}

export interface NodeStatus {
  id: string;
  baseUrl: string;
  healthy: boolean;
  activeConnections: number;
  loadedModels: string[];
}

// ── Load Balancer ─────────────────────────────────────────────

export class OllamaLoadBalancer {
  private readonly nodes: Map<string, NodeState>;
  private readonly config: LoadBalancerConfig;
  private readonly logger: Logger;
  private roundRobinIndex = 0;
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  constructor(config: LoadBalancerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.nodes = new Map();

    for (const node of config.nodes) {
      const client = new OllamaClient({
        baseUrl: node.baseUrl,
        ...config.clientConfig,
      });
      this.nodes.set(node.id, {
        client,
        node,
        healthy: true, // assume healthy until first check
        activeConnections: 0,
        loadedModels: new Set(),
        lastHealthCheck: 0,
      });
    }
  }

  /** Select the best node for a request based on strategy. */
  selectNode(request: OllamaChatRequest): NodeState | null {
    const healthyNodes = this.getHealthyNodes();
    if (healthyNodes.length === 0) return null;

    // Single node — passthrough, no overhead
    if (healthyNodes.length === 1) return healthyNodes[0]!;

    switch (this.config.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(healthyNodes);
      case 'least-connections':
        return this.selectLeastConnections(healthyNodes);
      case 'model-affinity':
        return this.selectModelAffinity(healthyNodes, request.model);
      default:
        return this.selectRoundRobin(healthyNodes);
    }
  }

  /** Execute a chat request with automatic failover. */
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const healthyNodes = this.getHealthyNodes();
    if (healthyNodes.length === 0) {
      throw new Error('No healthy Ollama nodes available');
    }

    // Build a try-list: selected first, then remaining healthy nodes
    const selected = this.selectNode(request);
    const tryList: NodeState[] = selected
      ? [selected, ...healthyNodes.filter((n) => n.node.id !== selected.node.id)]
      : healthyNodes;

    let lastError: Error | undefined;

    for (const nodeState of tryList) {
      nodeState.activeConnections++;
      try {
        this.logger.debug(
          { nodeId: nodeState.node.id, model: request.model },
          'Sending chat request to node',
        );
        const response = await nodeState.client.chat(request);
        // Track that this model is loaded on this node
        nodeState.loadedModels.add(request.model);
        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          { nodeId: nodeState.node.id, err: lastError.message },
          'Node failed, trying next',
        );
        // Mark as unhealthy on connection failure
        nodeState.healthy = false;
      } finally {
        nodeState.activeConnections--;
      }
    }

    throw lastError ?? new Error('All Ollama nodes failed');
  }

  /** Health check: check all nodes. Returns true if at least one node is healthy. */
  async healthCheck(): Promise<boolean> {
    const checks = [...this.nodes.values()].map(async (nodeState) => {
      try {
        const healthy = await nodeState.client.healthCheck();
        nodeState.healthy = healthy;
        nodeState.lastHealthCheck = Date.now();

        if (healthy) {
          // Refresh loaded models
          try {
            const running = await nodeState.client.listRunning();
            nodeState.loadedModels = new Set(running.models.map((m) => m.name));
          } catch {
            // Non-fatal: loaded model info is advisory
          }
        }

        this.logger.debug(
          { nodeId: nodeState.node.id, healthy },
          'Health check result',
        );
      } catch {
        nodeState.healthy = false;
        nodeState.lastHealthCheck = Date.now();
      }
    });

    await Promise.all(checks);

    return [...this.nodes.values()].some((n) => n.healthy);
  }

  /** Start periodic health checks. */
  startHealthChecks(): void {
    if (this.healthCheckTimer) return;

    const intervalMs = this.config.healthCheckIntervalMs ?? 30_000;
    this.logger.info({ intervalMs }, 'Starting periodic health checks');

    // Run immediately
    void this.healthCheck().catch((err) => {
      this.logger.warn({ err }, 'Initial health check failed');
    });

    this.healthCheckTimer = setInterval(() => {
      void this.healthCheck().catch((err) => {
        this.logger.warn({ err }, 'Periodic health check failed');
      });
    }, intervalMs);
  }

  /** Stop periodic health checks. */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      this.logger.info('Stopped periodic health checks');
    }
  }

  /** Get status of all nodes. */
  getNodesStatus(): NodeStatus[] {
    return [...this.nodes.values()].map((ns) => ({
      id: ns.node.id,
      baseUrl: ns.node.baseUrl,
      healthy: ns.healthy,
      activeConnections: ns.activeConnections,
      loadedModels: [...ns.loadedModels],
    }));
  }

  /** List models across all healthy nodes (deduplicated by name). */
  async listModels(): Promise<OllamaModelInfo[]> {
    const seen = new Map<string, OllamaModelInfo>();
    const healthyNodes = this.getHealthyNodes();

    const results = await Promise.allSettled(
      healthyNodes.map((ns) => ns.client.listModels()),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const model of result.value) {
          if (!seen.has(model.name)) {
            seen.set(model.name, model);
          }
        }
      }
    }

    return [...seen.values()];
  }

  /** Pull model on a specific node or all healthy nodes. */
  async pullModel(name: string, nodeId?: string): Promise<void> {
    if (nodeId) {
      const nodeState = this.nodes.get(nodeId);
      if (!nodeState) {
        throw new Error(`Node "${nodeId}" not found`);
      }
      await nodeState.client.pullModel(name);
      return;
    }

    // Pull on all healthy nodes
    const healthyNodes = this.getHealthyNodes();
    if (healthyNodes.length === 0) {
      throw new Error('No healthy nodes available for pull');
    }

    const results = await Promise.allSettled(
      healthyNodes.map((ns) => ns.client.pullModel(name)),
    );

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length === results.length) {
      throw new Error(`Failed to pull model "${name}" on all nodes`);
    }
    if (failures.length > 0) {
      this.logger.warn(
        { model: name, failedCount: failures.length, totalCount: results.length },
        'Model pull failed on some nodes',
      );
    }
  }

  // ── Private ─────────────────────────────────────────────────

  private getHealthyNodes(): NodeState[] {
    return [...this.nodes.values()].filter((n) => n.healthy);
  }

  private selectRoundRobin(nodes: NodeState[]): NodeState {
    const index = this.roundRobinIndex % nodes.length;
    this.roundRobinIndex++;
    return nodes[index]!;
  }

  private selectLeastConnections(nodes: NodeState[]): NodeState {
    let best = nodes[0]!;
    for (let i = 1; i < nodes.length; i++) {
      const node = nodes[i]!;
      const weighted = node.activeConnections / (node.node.weight ?? 1);
      const bestWeighted = best.activeConnections / (best.node.weight ?? 1);
      if (weighted < bestWeighted) {
        best = node;
      }
    }
    return best;
  }

  private selectModelAffinity(nodes: NodeState[], model: string): NodeState {
    // Prefer a node that already has the model loaded
    const affinityNode = nodes.find((n) => n.loadedModels.has(model));
    if (affinityNode) return affinityNode;

    // Fall back to least-connections
    return this.selectLeastConnections(nodes);
  }
}
