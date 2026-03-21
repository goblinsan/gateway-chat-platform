import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
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
