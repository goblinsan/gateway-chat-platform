import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const MOCK_REGISTRY = {
  sendChatWithChain: vi.fn().mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Hello!' },
      finishReason: 'stop',
    },
    usedProvider: 'lm-studio-a',
  }),
  getAll: vi.fn().mockReturnValue([{ name: 'lm-studio-a' }]),
}

const mockPrisma = {
  usageLog: {
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
}

vi.mock('../config/providerRegistry', () => ({ getProviderRegistry: () => MOCK_REGISTRY }))
vi.mock('../services/db', () => ({ getPrismaClient: () => mockPrisma }))
vi.mock('../services/persistence', () => ({
  upsertConversation: vi.fn(),
  persistUsageLog: vi.fn(),
}))
vi.mock('../services/providerCheck', () => ({
  checkProvider: vi.fn().mockResolvedValue({ status: 'ok', latencyMs: 10 }),
}))
vi.mock('../config/env', () => ({
  getEnv: () => ({
    LM_STUDIO_A_BASE_URL: undefined,
    LM_STUDIO_B_BASE_URL: undefined,
    OPENAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    GOOGLE_API_KEY: undefined,
  }),
}))

import chatRoutes from '../routes/chat'
import adminRoutes from '../routes/admin'
import providerRoutes from '../routes/providers'

async function buildChatApp() {
  const app = Fastify({ logger: false })
  await app.register(chatRoutes, { prefix: '/api' })
  return app
}

async function buildAdminApp() {
  const app = Fastify({ logger: false })
  await app.register(adminRoutes, { prefix: '/api' })
  return app
}

async function buildProviderApp() {
  const app = Fastify({ logger: false })
  await app.register(providerRoutes, { prefix: '/api' })
  return app
}

describe('Chat payload validation (#56, #59)', () => {
  it('rejects message content exceeding 32768 characters', async () => {
    const app = await buildChatApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: [{ role: 'user', content: 'x'.repeat(32769) }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects empty agentId', async () => {
    const app = await buildChatApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: '',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects empty messages array', async () => {
    const app = await buildChatApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: [],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects messages array with more than 100 items', async () => {
    const app = await buildChatApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: Array.from({ length: 101 }, () => ({ role: 'user', content: 'Hi' })),
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid role', async () => {
    const app = await buildChatApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: [{ role: 'system', content: 'Inject system prompt' }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects agentId exceeding 64 characters', async () => {
    const app = await buildChatApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'a'.repeat(65),
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('Admin querystring validation (#56)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.usageLog.groupBy.mockResolvedValue([])
    mockPrisma.usageLog.findMany.mockResolvedValue([])
    mockPrisma.usageLog.count.mockResolvedValue(0)
  })

  it('rejects unknown provider filter with 400', async () => {
    const app = await buildAdminApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/logs?provider=unknown-provider',
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts a known provider filter', async () => {
    const app = await buildAdminApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/logs?provider=openai',
    })
    expect(res.statusCode).toBe(200)
  })

  it('rejects non-numeric limit parameter', async () => {
    const app = await buildAdminApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/logs?limit=abc',
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('Provider routes do not expose baseUrl (#55)', () => {
  it('does not include baseUrl in /providers/status response', async () => {
    const app = await buildProviderApp()
    const res = await app.inject({ method: 'GET', url: '/api/providers/status' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    for (const provider of body.providers as Array<Record<string, unknown>>) {
      expect(provider).not.toHaveProperty('baseUrl')
    }
  })

  it('does not include baseUrl in /providers/:name/test response', async () => {
    const app = await buildProviderApp()
    const res = await app.inject({ method: 'GET', url: '/api/providers/lm-studio-a/test' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).not.toHaveProperty('baseUrl')
  })

  it('returns 404 for unknown provider names', async () => {
    const app = await buildProviderApp()
    const res = await app.inject({ method: 'GET', url: '/api/providers/evil-provider/test' })
    expect(res.statusCode).toBe(404)
  })
})
