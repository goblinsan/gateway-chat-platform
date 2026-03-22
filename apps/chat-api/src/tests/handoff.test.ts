import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../agents/registry', () => {
  const AGENTS = [
    { id: 'local-analyst', name: 'Local Analyst', icon: '🔍', color: '#3b82f6', providerName: 'lm-studio-a', model: 'local-model', costClass: 'free', systemPrompt: 'analyst', enabled: true },
    { id: 'creative-builder', name: 'Creative Builder', icon: '🎨', color: '#a855f7', providerName: 'lm-studio-b', model: 'local-model', costClass: 'free', systemPrompt: 'builder', enabled: true },
    { id: 'fast-helper', name: 'Fast Cheap Helper', icon: '⚡', color: '#22c55e', providerName: 'openai', model: 'gpt-4o-mini', costClass: 'cheap', systemPrompt: 'helper', temperature: 0.5, maxTokens: 512, enabled: true },
  ]
  return {
    listAgents: () => AGENTS,
    getAgent: (id: string) => AGENTS.find((a) => a.id === id),
    getAgentRegistry: () => ({ list: () => AGENTS, get: (id: string) => AGENTS.find((a) => a.id === id) }),
  }
})

import handoffRoutes from '../routes/handoff'

describe('POST /api/chat/handoff', () => {
  it('returns thread context for valid agents', async () => {
    const app = Fastify()
    await app.register(handoffRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/handoff',
      payload: {
        fromAgentId: 'local-analyst',
        toAgentId: 'fast-helper',
        messages: [{ role: 'user', content: 'Analyze this data.' }],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.toAgentId).toBe('fast-helper')
    expect(Array.isArray(body.threadContext)).toBe(true)
    expect(body.handoffNote).toContain('Local Analyst')
  })

  it('returns 404 for unknown fromAgentId', async () => {
    const app = Fastify()
    await app.register(handoffRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/handoff',
      payload: {
        fromAgentId: 'nonexistent-agent',
        toAgentId: 'fast-helper',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('nonexistent-agent')
  })

  it('returns 404 for unknown toAgentId', async () => {
    const app = Fastify()
    await app.register(handoffRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/handoff',
      payload: {
        fromAgentId: 'local-analyst',
        toAgentId: 'nonexistent-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('nonexistent-agent')
  })

  it('returns 400 when messages missing', async () => {
    const app = Fastify()
    await app.register(handoffRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/handoff',
      payload: {
        fromAgentId: 'local-analyst',
        toAgentId: 'fast-helper',
      },
    })

    expect(res.statusCode).toBe(400)
  })
})
