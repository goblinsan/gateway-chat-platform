import type { PrismaClient, Agent as PrismaAgent } from '@prisma/client'
import type { AgentConfig, CostClass, ExecutionMode, RoutingPolicy, ModelEndpointConfig, ContextSource } from '@gateway/shared'

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
    executionMode: (row.executionMode as ExecutionMode) || undefined,
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
    executionMode: config.executionMode ?? 'direct_provider',
    enabled: config.enabled ?? true,
  }
}

// --- Dynamic Agent Registry ---

/**
 * Dynamic agent registry backed by SQLite.
 * On init, it loads existing agent records and keeps them cached in memory.
 * Supports runtime CRUD for external config server management.
 */
export class AgentRegistry {
  private cache = new Map<string, AgentConfig>()
  private prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  /** Load agents from DB into cache. */
  async init(): Promise<void> {
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

  /** Bulk sync agents — used for syncing from a remote config server. */
  async sync(configs: AgentConfig[]): Promise<{ created: number; updated: number }> {
    let created = 0
    let updated = 0
    const desiredIds = new Set(configs.map((config) => config.id))

    await this.prisma.$transaction(async (tx) => {
      const existingRows = await tx.agent.findMany({ select: { id: true } })
      const existingIds = new Set(existingRows.map((row) => row.id))

      for (const config of configs) {
        if (existingIds.has(config.id)) {
          await tx.agent.update({ where: { id: config.id }, data: configToDbData(config) })
          updated++
        } else {
          await tx.agent.create({ data: configToDbData(config) })
          created++
        }
      }

      for (const existingId of existingIds) {
        if (!desiredIds.has(existingId)) {
          await tx.agent.delete({ where: { id: existingId } })
        }
      }
    })

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
