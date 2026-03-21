import { describe, it, expect, vi, beforeEach } from 'vitest'

const MOCK_REGISTRY = {
  sendChatWithChain: vi.fn().mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Hello from the agent!' },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    },
    usedProvider: 'lm-studio-a',
  }),
  getAll: vi.fn().mockReturnValue([
    { name: 'lm-studio-a' },
    { name: 'lm-studio-b' },
    { name: 'openai' },
  ]),
}

vi.mock('../config/providerRegistry', () => ({
  getProviderRegistry: () => MOCK_REGISTRY,
}))

import Fastify from 'fastify'
import chatRoutes from '../routes/chat'

beforeEach(() => {
  vi.clearAllMocks()
  MOCK_REGISTRY.sendChatWithChain.mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Hello from the agent!' },
      finishReason: 'stop',
    },
    usedProvider: 'lm-studio-a',
  })
  MOCK_REGISTRY.getAll.mockReturnValue([
    { name: 'lm-studio-a' },
    { name: 'lm-studio-b' },
    { name: 'openai' },
  ])
})

describe('POST /api/chat', () => {
  it('returns a successful response for a known agent', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.agentId).toBe('local-analyst')
    expect(body.usedProvider).toBe('lm-studio-a')
    expect(body.message.role).toBe('assistant')
    expect(body.message.content).toBe('Hello from the agent!')
  })

  it('returns 404 for an unknown agentId', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'does-not-exist',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    })

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('does-not-exist')
  })

  it('returns 400 when agentId is missing', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Hi' }] },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when messages array is missing', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { agentId: 'local-analyst' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('injects system prompt before conversation messages', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: [{ role: 'user', content: 'Analyze this.' }],
      },
    })

    const call = MOCK_REGISTRY.sendChatWithChain.mock.calls[0]
    const [, request] = call as [string[], { messages: Array<{ role: string; content: string }> }]
    expect(request.messages[0].role).toBe('system')
    expect(request.messages[1].role).toBe('user')
  })

  it('passes agent temperature and maxTokens to the provider', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    // fast-helper has temperature: 0.5, maxTokens: 512
    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'fast-helper',
        messages: [{ role: 'user', content: 'Quick question.' }],
      },
    })

    const call = MOCK_REGISTRY.sendChatWithChain.mock.calls[0]
    const [, request] = call as [string[], { temperature?: number; maxTokens?: number }]
    expect(request.temperature).toBe(0.5)
    expect(request.maxTokens).toBe(512)
  })

  it('uses routing policy to build the provider chain', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: [{ role: 'user', content: 'Analyze this data.' }],
      },
    })

    const call = MOCK_REGISTRY.sendChatWithChain.mock.calls[0]
    const [chain] = call as [string[], unknown]
    // local-analyst policy: allowedProviders = ['lm-studio-a', 'lm-studio-b']
    expect(chain).toContain('lm-studio-a')
    expect(chain).not.toContain('openai')
  })
})
