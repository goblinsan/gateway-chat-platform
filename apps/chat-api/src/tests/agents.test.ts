import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'

const SEED_AGENTS = [
  { id: 'local-analyst', name: 'Local Analyst', icon: '🔍', color: '#3b82f6', providerName: 'lm-studio-a', model: 'local-model', costClass: 'free', systemPrompt: 'analyst prompt', temperature: 0.3, enabled: true },
  { id: 'creative-builder', name: 'Creative Builder', icon: '🎨', color: '#a855f7', providerName: 'lm-studio-b', model: 'local-model', costClass: 'free', systemPrompt: 'builder prompt', temperature: 0.9, enabled: true },
  { id: 'deep-reasoner', name: 'Premium Deep Reasoner', icon: '🧠', color: '#f59e0b', providerName: 'openai', model: 'gpt-4o', costClass: 'premium', systemPrompt: 'reasoner prompt', temperature: 0.2, enableReasoning: true, enabled: true },
  { id: 'fast-helper', name: 'Fast Cheap Helper', icon: '⚡', color: '#22c55e', providerName: 'openai', model: 'gpt-4o-mini', costClass: 'cheap', systemPrompt: 'helper prompt', temperature: 0.5, maxTokens: 512, enabled: true },
  { id: 'tool-agent', name: 'Tool Agent', icon: '🔧', color: '#ef4444', providerName: 'openai', model: 'gpt-4o', costClass: 'premium', systemPrompt: 'tool prompt', temperature: 0.0, featureFlags: { tools: true }, enabled: true },
  { id: 'auto-router', name: 'Auto Router', icon: '🤖', color: '#6366f1', providerName: 'auto', model: 'auto', costClass: 'free', systemPrompt: 'assistant prompt', enabled: true },
]

vi.mock('../agents/registry', () => ({
  listAgents: () => SEED_AGENTS,
  getAgent: (id: string) => SEED_AGENTS.find((a) => a.id === id),
  getAgentRegistry: () => ({
    list: (enabledOnly = true) => enabledOnly ? SEED_AGENTS.filter((a) => a.enabled !== false) : SEED_AGENTS,
    get: (id: string) => SEED_AGENTS.find((a) => a.id === id),
  }),
}))

import agentRoutes from '../routes/agents'

describe('GET /api/agents', () => {
  it('returns a list of agents', async () => {
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/agents' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.agents).toBeDefined()
    expect(Array.isArray(body.agents)).toBe(true)
    expect(body.agents.length).toBeGreaterThan(0)
  })

  it('returns all 6 seeded agents', async () => {
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/agents' })
    const body = JSON.parse(res.payload)

    expect(body.agents).toHaveLength(6)
  })

  it('omits systemPrompt from every agent', async () => {
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/agents' })
    const body = JSON.parse(res.payload)

    for (const agent of body.agents) {
      expect(agent.systemPrompt).toBeUndefined()
    }
  })

  it('each agent exposes required identity fields', async () => {
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/agents' })
    const body = JSON.parse(res.payload)

    for (const agent of body.agents) {
      expect(agent.id).toBeDefined()
      expect(agent.name).toBeDefined()
      expect(agent.icon).toBeDefined()
      expect(agent.color).toBeDefined()
      expect(agent.providerName).toBeDefined()
      expect(agent.model).toBeDefined()
      expect(['free', 'cheap', 'premium']).toContain(agent.costClass)
    }
  })
})
