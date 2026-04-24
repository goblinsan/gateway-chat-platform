/**
 * Tests for execution-mode-aware routing in POST /api/chat (Issue #108).
 *
 * Agents with executionMode='orchestrated' must be forwarded to the agent-service.
 * Agents with executionMode='direct_provider' (or no mode) must use the provider registry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../agents/registry', () => {
  const AGENTS = [
    {
      id: 'direct-agent',
      name: 'Direct Agent',
      icon: '🔍',
      color: '#3b82f6',
      providerName: 'lm-studio-a',
      model: 'local-model',
      costClass: 'free',
      systemPrompt: 'You are a direct agent.',
      temperature: 0.3,
      executionMode: 'direct_provider',
      enabled: true,
    },
    {
      id: 'orchestrated-agent',
      name: 'Orchestrated Agent',
      icon: '🤖',
      color: '#6366f1',
      providerName: 'lm-studio-a',
      model: 'local-model',
      costClass: 'free',
      systemPrompt: 'You are orchestrated.',
      temperature: 0.5,
      executionMode: 'orchestrated',
      enabled: true,
    },
    {
      id: 'legacy-agent',
      name: 'Legacy Agent (no executionMode)',
      icon: '⚡',
      color: '#22c55e',
      providerName: 'lm-studio-b',
      model: 'local-model',
      costClass: 'free',
      systemPrompt: 'Legacy prompt.',
      temperature: 0.7,
      // no executionMode — should behave like direct_provider
      enabled: true,
    },
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
      message: { role: 'assistant', content: 'Direct provider response.' },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
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

const mockSendToAgentService = vi.fn().mockResolvedValue({
  agentId: 'orchestrated-agent',
  usedProvider: 'agent-service',
  model: 'local-model',
  message: { role: 'assistant', content: 'Orchestrated response.' },
  usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
})

vi.mock('../services/agentServiceClient', () => ({
  sendToAgentService: (...args: unknown[]) => mockSendToAgentService(...args),
  AgentServiceError: class AgentServiceError extends Error {
    constructor(msg: string) { super(msg); this.name = 'AgentServiceError' }
  },
}))

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({
    userPersona: { findFirst: vi.fn().mockResolvedValue(null) },
  }),
}))

vi.mock('../services/persistence', () => ({
  upsertConversation: vi.fn(),
  persistMessage: vi.fn(),
  persistUsageLog: vi.fn(),
}))

vi.mock('../services/notesSync', () => ({
  syncAgentConversationToNotes: vi.fn(),
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
      message: { role: 'assistant', content: 'Direct provider response.' },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    },
    usedProvider: 'lm-studio-a',
  })
  mockSendToAgentService.mockResolvedValue({
    agentId: 'orchestrated-agent',
    usedProvider: 'agent-service',
    model: 'local-model',
    message: { role: 'assistant', content: 'Orchestrated response.' },
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
  })
})

describe('POST /api/chat — execution-mode routing', () => {
  it('routes direct_provider agents through the provider registry', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'direct-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(MOCK_REGISTRY.sendChatWithChain).toHaveBeenCalledOnce()
    expect(mockSendToAgentService).not.toHaveBeenCalled()

    const body = JSON.parse(res.payload)
    expect(body.message.content).toBe('Direct provider response.')
    expect(body.usedProvider).toBe('lm-studio-a')
  })

  it('routes orchestrated agents through the agent-service', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'orchestrated-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockSendToAgentService).toHaveBeenCalledOnce()
    expect(MOCK_REGISTRY.sendChatWithChain).not.toHaveBeenCalled()

    const body = JSON.parse(res.payload)
    expect(body.message.content).toBe('Orchestrated response.')
    expect(body.usedProvider).toBe('agent-service')
  })

  it('passes correct payload to agent-service for orchestrated agents', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'orchestrated-agent',
        messages: [{ role: 'user', content: 'Orchestrate me.' }],
      },
    })

    const call = mockSendToAgentService.mock.calls[0]
    const [request] = call as [{ agentId: string; model: string; messages: unknown[] }]
    expect(request.agentId).toBe('orchestrated-agent')
    expect(request.model).toBe('local-model')
    expect(request.messages.length).toBeGreaterThan(0)
  })

  it('routes legacy agents (no executionMode) through the provider registry', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'legacy-agent',
        messages: [{ role: 'user', content: 'Hello from legacy agent.' }],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(MOCK_REGISTRY.sendChatWithChain).toHaveBeenCalledOnce()
    expect(mockSendToAgentService).not.toHaveBeenCalled()
  })

  it('returns 502 when agent-service fails for an orchestrated agent', async () => {
    mockSendToAgentService.mockRejectedValueOnce(new Error('agent-service unreachable'))

    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'orchestrated-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(502)
  })

  it('includes usage data from agent-service in the response', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'orchestrated-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 })
  })

  it('includes routingExplanation in orchestrated agent response', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'orchestrated-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.routingExplanation).toBeDefined()
    expect(body.routingExplanation.selectedProvider).toBeDefined()
  })
})
