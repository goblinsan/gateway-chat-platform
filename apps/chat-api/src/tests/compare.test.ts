import { describe, it, expect, vi, beforeEach } from 'vitest'

const MOCK_REGISTRY = {
  sendChatWithChain: vi.fn().mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Compare response' },
      finishReason: 'stop',
    },
    usedProvider: 'lm-studio-a',
  }),
  getAll: vi.fn().mockReturnValue([
    { name: 'lm-studio-a' },
    { name: 'lm-studio-b' },
  ]),
}

vi.mock('../config/providerRegistry', () => ({
  getProviderRegistry: () => MOCK_REGISTRY,
}))

import Fastify from 'fastify'
import compareRoutes from '../routes/compare'

beforeEach(() => {
  vi.clearAllMocks()
  MOCK_REGISTRY.sendChatWithChain.mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Compare response' },
      finishReason: 'stop',
    },
    usedProvider: 'lm-studio-a',
  })
  MOCK_REGISTRY.getAll.mockReturnValue([{ name: 'lm-studio-a' }, { name: 'lm-studio-b' }])
})

describe('POST /api/chat/compare', () => {
  it('returns results array with responses from all providers', async () => {
    const app = Fastify()
    await app.register(compareRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/compare',
      payload: { messages: [{ role: 'user', content: 'Hello' }] },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.results).toBeDefined()
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.length).toBe(2)
  })

  it('handles provider errors gracefully', async () => {
    MOCK_REGISTRY.sendChatWithChain.mockRejectedValueOnce(new Error('Provider down'))

    const app = Fastify()
    await app.register(compareRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/compare',
      payload: { messages: [{ role: 'user', content: 'Hello' }] },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    const errResult = body.results.find((r: { error?: string }) => r.error)
    expect(errResult).toBeDefined()
    expect(errResult.error).toBe('Provider down')
  })

  it('returns 400 when messages missing', async () => {
    const app = Fastify()
    await app.register(compareRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/compare',
      payload: { providerIds: ['lm-studio-a'] },
    })

    expect(res.statusCode).toBe(400)
  })

  it('accepts optional providerIds filter', async () => {
    const app = Fastify()
    await app.register(compareRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/compare',
      payload: {
        messages: [{ role: 'user', content: 'Hello' }],
        providerIds: ['lm-studio-a'],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.results).toHaveLength(1)
    expect(body.results[0].provider).toBe('lm-studio-a')
  })
})
