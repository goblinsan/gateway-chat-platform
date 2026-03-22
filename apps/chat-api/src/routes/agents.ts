import type { FastifyInstance } from 'fastify'
import type { AgentConfig, AgentListItem } from '@gateway/shared'
import { listAgents, getAgentRegistry } from '../agents/registry'

/** Strip server-side fields from an AgentConfig for public consumption. */
function toPublicItem(agent: AgentConfig): AgentListItem {
  const {
    systemPrompt: _s,
    routingPolicy: _r,
    endpointConfig: _e,
    contextSources: _c,
    ...rest
  } = agent
  return rest
}

/**
 * Public agent list + management endpoints for external config servers.
 */
export default async function agentRoutes(app: FastifyInstance) {
  // --- Public: list agents ---
  app.get('/agents', async (_req, reply) => {
    const agents = listAgents()
    return reply.send({ agents: agents.map(toPublicItem) })
  })

  // --- Management API ---

  /** GET /agents/manage — list all agents with full config (including disabled). */
  app.get('/agents/manage', async (_req, reply) => {
    const registry = getAgentRegistry()
    const agents = registry.list(false)
    return reply.send({ agents })
  })

  /** GET /agents/manage/:id — get a single agent's full config. */
  app.get<{ Params: { id: string } }>('/agents/manage/:id', async (req, reply) => {
    const registry = getAgentRegistry()
    const allAgents = registry.list(false)
    const agent = allAgents.find((a) => a.id === req.params.id)
    if (!agent) {
      return reply.status(404).send({ error: `Agent '${req.params.id}' not found` })
    }
    return reply.send(agent)
  })

  /** POST /agents/manage — create a new agent. */
  app.post<{ Body: AgentConfig }>('/agents/manage', {
    schema: {
      body: {
        type: 'object',
        required: ['id', 'name', 'providerName', 'model', 'costClass'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9_-]+$' },
          name: { type: 'string', minLength: 1, maxLength: 128 },
          icon: { type: 'string', maxLength: 8 },
          color: { type: 'string', maxLength: 16 },
          providerName: { type: 'string', minLength: 1, maxLength: 64 },
          model: { type: 'string', minLength: 1, maxLength: 128 },
          costClass: { type: 'string', enum: ['free', 'cheap', 'premium'] },
          systemPrompt: { type: 'string', maxLength: 32768 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          maxTokens: { type: 'integer', minimum: 1, maximum: 1000000 },
          enableReasoning: { type: 'boolean' },
          enabled: { type: 'boolean' },
          featureFlags: { type: 'object' },
          routingPolicy: { type: 'object' },
          endpointConfig: { type: 'object' },
          contextSources: { type: 'array' },
        },
      },
    },
  }, async (req, reply) => {
    const registry = getAgentRegistry()
    try {
      const config: AgentConfig = {
        icon: '🤖',
        color: '#6366f1',
        ...req.body,
      }
      const created = await registry.create(config)
      req.log.info({ agentId: created.id }, 'Agent created')
      return reply.status(201).send(created)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create agent'
      return reply.status(409).send({ error: message })
    }
  })

  /** PUT /agents/manage/:id — update an existing agent. */
  app.put<{ Params: { id: string }; Body: Partial<AgentConfig> }>('/agents/manage/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 128 },
          icon: { type: 'string', maxLength: 8 },
          color: { type: 'string', maxLength: 16 },
          providerName: { type: 'string', minLength: 1, maxLength: 64 },
          model: { type: 'string', minLength: 1, maxLength: 128 },
          costClass: { type: 'string', enum: ['free', 'cheap', 'premium'] },
          systemPrompt: { type: 'string', maxLength: 32768 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          maxTokens: { type: 'integer', minimum: 1, maximum: 1000000 },
          enableReasoning: { type: 'boolean' },
          enabled: { type: 'boolean' },
          featureFlags: { type: 'object' },
          routingPolicy: { type: 'object' },
          endpointConfig: { type: 'object' },
          contextSources: { type: 'array' },
        },
      },
    },
  }, async (req, reply) => {
    const registry = getAgentRegistry()
    try {
      const updated = await registry.update(req.params.id, req.body)
      req.log.info({ agentId: updated.id }, 'Agent updated')
      return reply.send(updated)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update agent'
      return reply.status(404).send({ error: message })
    }
  })

  /** DELETE /agents/manage/:id — remove an agent. */
  app.delete<{ Params: { id: string } }>('/agents/manage/:id', async (req, reply) => {
    const registry = getAgentRegistry()
    try {
      await registry.delete(req.params.id)
      req.log.info({ agentId: req.params.id }, 'Agent deleted')
      return reply.status(204).send()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete agent'
      return reply.status(404).send({ error: message })
    }
  })

  /** POST /agents/manage/sync — bulk upsert agents from a remote config source. */
  app.post<{ Body: { agents: AgentConfig[] } }>('/agents/manage/sync', {
    schema: {
      body: {
        type: 'object',
        required: ['agents'],
        properties: {
          agents: { type: 'array', minItems: 1, maxItems: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const registry = getAgentRegistry()
    const result = await registry.sync(req.body.agents)
    req.log.info(result, 'Agent sync completed')
    return reply.send(result)
  })

  /** POST /agents/manage/reload — force reload agents from database into cache. */
  app.post('/agents/manage/reload', async (req, reply) => {
    const registry = getAgentRegistry()
    await registry.reload()
    const count = registry.list(false).length
    req.log.info({ count }, 'Agent cache reloaded')
    return reply.send({ reloaded: count })
  })
}
