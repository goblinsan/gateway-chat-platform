import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../agents/registry', () => {
  const AGENTS = [
    { id: 'local-analyst', name: 'Local Analyst', icon: '🔍', color: '#3b82f6', providerName: 'lm-studio-a', model: 'local-model', costClass: 'free', systemPrompt: 'You are a precise local analyst.', temperature: 0.3, routingPolicy: { preferredProvider: 'lm-studio-a', allowedProviders: ['lm-studio-a', 'lm-studio-b'], maxCostClass: 'free' }, endpointConfig: { modelParams: { notesSync: { repoPath: '/opt/notes' } } }, enabled: true },
    { id: 'creative-builder', name: 'Creative Builder', icon: '🎨', color: '#a855f7', providerName: 'lm-studio-b', model: 'local-model', costClass: 'free', systemPrompt: 'builder', temperature: 0.9, enabled: true },
    { id: 'fast-helper', name: 'Fast Cheap Helper', icon: '⚡', color: '#22c55e', providerName: 'openai', model: 'gpt-4o-mini', costClass: 'cheap', systemPrompt: 'helper', temperature: 0.5, maxTokens: 512, routingPolicy: { preferredProvider: 'openai', promptLengthThreshold: 1000, allowPaidFallback: true }, enabled: true },
  ]
  return {
    listAgents: () => AGENTS,
    getAgent: (id: string) => AGENTS.find((a) => a.id === id),
    getAgentRegistry: () => ({ list: () => AGENTS, get: (id: string) => AGENTS.find((a) => a.id === id) }),
  }
})

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
    { name: 'lm-studio-a', listModels: vi.fn().mockResolvedValue(['local-model', 'overridden-model']) },
    { name: 'lm-studio-b', listModels: vi.fn().mockResolvedValue(['builder-model']) },
    { name: 'openai', listModels: vi.fn().mockResolvedValue(['gpt-4o', 'gpt-4o-mini']) },
  ]),
}

vi.mock('../config/providerRegistry', () => ({
  getProviderRegistry: () => MOCK_REGISTRY,
}))

const mockUpsertConversation = vi.fn()
const mockPersistMessage = vi.fn()
const mockPersistUsageLog = vi.fn()
const mockSyncAgentConversationToNotes = vi.fn()

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({
    conversation: {},
    message: {},
    usageLog: {},
    userPersona: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  }),
}))

vi.mock('../services/persistence', () => ({
  upsertConversation: (...args: unknown[]) => mockUpsertConversation(...args),
  persistMessage: (...args: unknown[]) => mockPersistMessage(...args),
  persistUsageLog: (...args: unknown[]) => mockPersistUsageLog(...args),
}))

vi.mock('../services/notesSync', () => ({
  syncAgentConversationToNotes: (...args: unknown[]) => mockSyncAgentConversationToNotes(...args),
}))

vi.mock('../services/quotaService', () => ({
  checkQuota: vi.fn().mockResolvedValue(null),
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
    { name: 'lm-studio-a', listModels: vi.fn().mockResolvedValue(['local-model', 'overridden-model']) },
    { name: 'lm-studio-b', listModels: vi.fn().mockResolvedValue(['builder-model']) },
    { name: 'openai', listModels: vi.fn().mockResolvedValue(['gpt-4o', 'gpt-4o-mini']) },
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

  it('uses modelOverride instead of agent model when provided', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: [{ role: 'user', content: 'Hello' }],
        modelOverride: 'gpt-4o',
      },
    })

    const call = MOCK_REGISTRY.sendChatWithChain.mock.calls[0]
    const [, request] = call as [string[], { model: string }]
    expect(request.model).toBe('gpt-4o')
  })

  it('uses the agent model when modelOverride is not provided', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    const call = MOCK_REGISTRY.sendChatWithChain.mock.calls[0]
    const [, request] = call as [string[], { model: string }]
    // local-analyst uses 'local-model'
    expect(request.model).toBe('local-model')
  })

  it('rejects an unknown modelOverride', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        messages: [{ role: 'user', content: 'Hello' }],
        modelOverride: 'not-a-real-model',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toContain('Unknown model override')
  })

  it('persists model and provider on the assistant message when threadId is provided', async () => {
    MOCK_REGISTRY.sendChatWithChain.mockResolvedValueOnce({
      response: {
        id: 'resp-2',
        model: 'overridden-model',
        message: { role: 'assistant', content: 'Response!' },
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      usedProvider: 'lm-studio-a',
    })

    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        threadId: 'test-thread-persist',
        messages: [{ role: 'user', content: 'Test model persistence' }],
        modelOverride: 'overridden-model',
      },
    })

    expect(res.statusCode).toBe(200)
    // Allow async persistence to flush
    await new Promise((resolve) => setTimeout(resolve, 0))

    const assistantCall = mockPersistMessage.mock.calls.find(
      (c: unknown[]) => (c[1] as { role: string }).role === 'assistant',
    )
    expect(assistantCall).toBeDefined()
    const persistedMsg = assistantCall![1] as { model: string; provider: string }
    expect(persistedMsg.model).toBe('overridden-model')
    expect(persistedMsg.provider).toBe('lm-studio-a')
  })

  it('syncs thread conversations into notes when the agent enables notes sync', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        threadId: 'ancr-coach-thread',
        messages: [{ role: 'user', content: 'I finished the translation matrix today.' }],
      },
    })

    expect(res.statusCode).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockUpsertConversation).toHaveBeenCalled()
    expect(mockPersistMessage).toHaveBeenCalled()
    expect(mockSyncAgentConversationToNotes).toHaveBeenCalled()
  })
})
