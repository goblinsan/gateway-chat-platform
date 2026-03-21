import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
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

  it('returns all 5 seeded agents', async () => {
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/agents' })
    const body = JSON.parse(res.payload)

    expect(body.agents).toHaveLength(5)
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
