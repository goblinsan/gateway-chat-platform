import type { PrismaClient, Agent as PrismaAgent } from '@prisma/client'
import type { AgentConfig, CostClass, RoutingPolicy, ModelEndpointConfig, ContextSource } from '@gateway/shared'

/**
 * Seed definitions for the default agents.
 * These are loaded on first startup if the DB has no agent records.
 */
const SEED_AGENTS: AgentConfig[] = [
  {
    id: 'local-analyst',
    name: 'Local Analyst',
    icon: '🔍',
    color: '#3b82f6',
    providerName: 'lm-studio-a',
    model: 'local-model',
    costClass: 'free',
    systemPrompt:
      'You are a precise local analyst. Respond with structured, data-driven analysis. Be concise and factual.',
    temperature: 0.3,
    routingPolicy: {
      preferredProvider: 'lm-studio-a',
      allowedProviders: ['lm-studio-a', 'lm-studio-b'],
      maxCostClass: 'free',
    },
  },
  {
    id: 'creative-builder',
    name: 'Creative Builder',
    icon: '🎨',
    color: '#a855f7',
    providerName: 'lm-studio-b',
    model: 'local-model',
    costClass: 'free',
    systemPrompt:
      'You are a creative builder. Explore imaginative solutions, generate ideas freely, and embrace lateral thinking.',
    temperature: 0.9,
    routingPolicy: {
      preferredProvider: 'lm-studio-b',
      allowedProviders: ['lm-studio-a', 'lm-studio-b'],
      maxCostClass: 'free',
    },
  },
  {
    id: 'deep-reasoner',
    name: 'Premium Deep Reasoner',
    icon: '🧠',
    color: '#f59e0b',
    providerName: 'openai',
    model: 'gpt-4o',
    costClass: 'premium',
    systemPrompt:
      'You are a deep reasoning assistant. Break down complex problems step-by-step, show your work, and arrive at well-supported conclusions.',
    temperature: 0.2,
    enableReasoning: true,
    routingPolicy: {
      preferredProvider: 'openai',
      requiresReasoning: true,
    },
  },
  {
    id: 'fast-helper',
    name: 'Fast Cheap Helper',
    icon: '⚡',
    color: '#22c55e',
    providerName: 'openai',
    model: 'gpt-4o-mini',
    costClass: 'cheap',
    systemPrompt:
      'You are a fast, concise helper. Give short, direct answers. Avoid unnecessary elaboration.',
    temperature: 0.5,
    maxTokens: 512,
    routingPolicy: {
      preferredProvider: 'openai',
      promptLengthThreshold: 1000,
      allowPaidFallback: true,
    },
  },
  {
    id: 'tool-agent',
    name: 'Tool Agent',
    icon: '🔧',
    color: '#ef4444',
    providerName: 'openai',
    model: 'gpt-4o',
    costClass: 'premium',
    systemPrompt:
      'You are a tool-use agent. When completing tasks, prefer structured outputs and leverage available tools effectively.',
    temperature: 0.0,
    featureFlags: { tools: true },
    routingPolicy: {
      preferredProvider: 'openai',
      requiresTools: true,
    },
  },
  {
    id: 'auto-router',
    name: 'Auto Router',
    icon: '🤖',
    color: '#6366f1',
    providerName: 'auto',
    model: 'auto',
    costClass: 'free',
    systemPrompt: 'You are an intelligent assistant. Respond helpfully and concisely.',
    routingPolicy: { allowPaidFallback: true },
  },
]

// --- Prisma <-> AgentConfig conversion ---

function parseJsonField<T>(raw: string | null): T | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function dbRowToConfig(row: PrismaAgent): AgentConfig {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    providerName: row.providerName,
    model: row.model,
    costClass: row.costClass as CostClass,
    systemPrompt: row.systemPrompt ?? undefined,
    temperature: row.temperature ?? undefined,
    maxTokens: row.maxTokens ?? undefined,
    enableReasoning: row.enableReasoning || undefined,
    featureFlags: parseJsonField<Record<string, boolean>>(row.featureFlags),
    routingPolicy: parseJsonField<RoutingPolicy>(row.routingPolicy),
    endpointConfig: parseJsonField<ModelEndpointConfig>(row.endpointConfig),
    contextSources: parseJsonField<ContextSource[]>(row.contextSources),
    enabled: row.enabled,
    source: 'database',
  }
}

function configToDbData(config: AgentConfig) {
  return {
    id: config.id,
    name: config.name,
    icon: config.icon,
    color: config.color,
    providerName: config.providerName,
    model: config.model,
    costClass: config.costClass,
    systemPrompt: config.systemPrompt ?? null,
    temperature: config.temperature ?? null,
    maxTokens: config.maxTokens ?? null,
    enableReasoning: config.enableReasoning ?? false,
    featureFlags: config.featureFlags ? JSON.stringify(config.featureFlags) : null,
    routingPolicy: config.routingPolicy ? JSON.stringify(config.routingPolicy) : null,
    endpointConfig: config.endpointConfig ? JSON.stringify(config.endpointConfig) : null,
    contextSources: config.contextSources ? JSON.stringify(config.contextSources) : null,
    enabled: config.enabled ?? true,
  }
}

// --- Dynamic Agent Registry ---

/**
 * Dynamic agent registry backed by SQLite.
 * On init, seeds the DB with defaults if empty, then caches agents in memory.
 * Supports runtime CRUD for external config server management.
 */
export class AgentRegistry {
  private cache = new Map<string, AgentConfig>()
  private prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  /** Load agents from DB into cache. Seeds defaults if the table is empty. */
  async init(): Promise<void> {
    const count = await this.prisma.agent.count()
    if (count === 0) {
      for (const seed of SEED_AGENTS) {
        await this.prisma.agent.create({ data: configToDbData(seed) })
      }
    }
    await this.reload()
  }

  /** Reload the in-memory cache from the database. */
  async reload(): Promise<void> {
    const rows = await this.prisma.agent.findMany()
    this.cache.clear()
    for (const row of rows) {
      const config = dbRowToConfig(row)
      this.cache.set(config.id, config)
    }
  }

  /** List all agents. When enabledOnly is true, filters to enabled agents. */
  list(enabledOnly = true): AgentConfig[] {
    const all = Array.from(this.cache.values())
    return enabledOnly ? all.filter((a) => a.enabled !== false) : all
  }

  /** Look up a single agent by id. Returns undefined if not found or disabled. */
  get(id: string): AgentConfig | undefined {
    const agent = this.cache.get(id)
    if (!agent || agent.enabled === false) return undefined
    return agent
  }

  /** Create a new agent. Returns the created config. */
  async create(config: AgentConfig): Promise<AgentConfig> {
    const existing = await this.prisma.agent.findUnique({ where: { id: config.id } })
    if (existing) {
      throw new Error(`Agent '${config.id}' already exists`)
    }
    const row = await this.prisma.agent.create({ data: configToDbData(config) })
    const created = dbRowToConfig(row)
    this.cache.set(created.id, created)
    return created
  }

  /** Update an existing agent. Merges partial fields. Returns the updated config. */
  async update(id: string, partial: Partial<AgentConfig>): Promise<AgentConfig> {
    const existing = await this.prisma.agent.findUnique({ where: { id } })
    if (!existing) {
      throw new Error(`Agent '${id}' not found`)
    }
    // Merge the existing DB record with the partial update
    const merged = { ...dbRowToConfig(existing), ...partial, id }
    const row = await this.prisma.agent.update({
      where: { id },
      data: configToDbData(merged),
    })
    const updated = dbRowToConfig(row)
    this.cache.set(id, updated)
    return updated
  }

  /** Delete an agent by id. */
  async delete(id: string): Promise<void> {
    await this.prisma.agent.delete({ where: { id } })
    this.cache.delete(id)
  }

  /** Bulk upsert agents — used for syncing from a remote config server. */
  async sync(configs: AgentConfig[]): Promise<{ created: number; updated: number }> {
    let created = 0
    let updated = 0
    for (const config of configs) {
      const existing = await this.prisma.agent.findUnique({ where: { id: config.id } })
      if (existing) {
        await this.prisma.agent.update({ where: { id: config.id }, data: configToDbData(config) })
        updated++
      } else {
        await this.prisma.agent.create({ data: configToDbData(config) })
        created++
      }
    }
    await this.reload()
    return { created, updated }
  }
}

// --- Singleton management ---

let _registry: AgentRegistry | undefined

/** Initialize the global agent registry. Call once during server startup. */
export async function initAgentRegistry(prisma: PrismaClient): Promise<AgentRegistry> {
  _registry = new AgentRegistry(prisma)
  await _registry.init()
  return _registry
}

/** Get the global agent registry. Throws if not yet initialized. */
export function getAgentRegistry(): AgentRegistry {
  if (!_registry) {
    throw new Error('AgentRegistry not initialized — call initAgentRegistry() first')
  }
  return _registry
}

/** Set the global registry instance (for testing). */
export function setAgentRegistry(registry: AgentRegistry): void {
  _registry = registry
}

// --- Backward-compatible helpers (used by existing routes) ---

/** Return all enabled agent configurations. */
export function listAgents(): AgentConfig[] {
  return getAgentRegistry().list()
}

/** Look up a single agent by id. Returns undefined if not found. */
export function getAgent(id: string): AgentConfig | undefined {
  return getAgentRegistry().get(id)
}
