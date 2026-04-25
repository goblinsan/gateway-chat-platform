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
      id: 'orchestrated-notes-agent',
      name: 'Orchestrated Notes Agent',
      icon: '📝',
      color: '#f59e0b',
      providerName: 'lm-studio-a',
      model: 'local-model',
      costClass: 'free',
      systemPrompt: 'You are an orchestrated notes agent.',
      temperature: 0.5,
      executionMode: 'orchestrated',
      enabled: true,
      endpointConfig: { modelParams: { notesSync: { repoPath: '/opt/notes' } } },
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
  streamChatWithChain: vi.fn().mockImplementation(
    async (_chain: string[], _req: unknown, onEvent: (e: { type: string; token?: string; usage?: unknown }) => void) => {
      onEvent({ type: 'token', token: 'Direct ' })
      onEvent({ type: 'token', token: 'stream.' })
      onEvent({ type: 'done', usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } })
      return 'lm-studio-a'
    },
  ),
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

const mockStreamFromAgentService = vi.fn().mockImplementation(
  async (_request: unknown, onEvent: (event: { type: 'token' | 'done'; token?: string; model?: string; status?: string; orchestrationState?: unknown }) => void) => {
    onEvent({ type: 'token', token: 'Orchestrated ' })
    onEvent({ type: 'token', token: 'response.' })
    onEvent({ type: 'done', model: 'local-model', status: 'completed' })
    return {
      agentId: 'orchestrated-agent',
      usedProvider: 'agent-service',
      model: 'local-model',
      message: { role: 'assistant', content: 'Orchestrated response.' },
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      status: 'completed',
    }
  },
)

vi.mock('../services/agentServiceClient', () => ({
  sendToAgentService: (...args: unknown[]) => mockSendToAgentService(...args),
  streamFromAgentService: (...args: unknown[]) => mockStreamFromAgentService(...args),
  AgentServiceError: class AgentServiceError extends Error {
    constructor(msg: string) { super(msg); this.name = 'AgentServiceError' }
  },
}))

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({
    userPersona: { findFirst: vi.fn().mockResolvedValue(null) },
  }),
}))

const mockUpsertConversation = vi.fn()
const mockPersistMessage = vi.fn()
const mockPersistUsageLog = vi.fn()
const mockSyncAgentConversationToNotes = vi.fn()

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
      message: { role: 'assistant', content: 'Direct provider response.' },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    },
    usedProvider: 'lm-studio-a',
  })
  MOCK_REGISTRY.streamChatWithChain.mockImplementation(
    async (_chain: string[], _req: unknown, onEvent: (e: { type: string; token?: string; usage?: unknown }) => void) => {
      onEvent({ type: 'token', token: 'Direct ' })
      onEvent({ type: 'token', token: 'stream.' })
      onEvent({ type: 'done', usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } })
      return 'lm-studio-a'
    },
  )
  mockSendToAgentService.mockResolvedValue({
    agentId: 'orchestrated-agent',
    usedProvider: 'agent-service',
    model: 'local-model',
    message: { role: 'assistant', content: 'Orchestrated response.' },
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
  })
  mockStreamFromAgentService.mockImplementation(
    async (_request: unknown, onEvent: (event: { type: 'token' | 'done'; token?: string; model?: string; status?: string; orchestrationState?: unknown }) => void) => {
      onEvent({ type: 'token', token: 'Orchestrated ' })
      onEvent({ type: 'token', token: 'response.' })
      onEvent({ type: 'done', model: 'local-model', status: 'completed' })
      return {
        agentId: 'orchestrated-agent',
        usedProvider: 'agent-service',
        model: 'local-model',
        message: { role: 'assistant', content: 'Orchestrated response.' },
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        status: 'completed',
      }
    },
  )
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

  it('returns 502 when agent-service times out for an orchestrated agent', async () => {
    mockSendToAgentService.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' }),
    )

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
    const body = JSON.parse(res.payload)
    expect(body.error).toBeDefined()
  })

  it('direct_provider agent is unaffected when agent-service is unavailable', async () => {
    // Simulate agent-service being completely down — direct agents must still work.
    mockSendToAgentService.mockRejectedValue(new Error('Connection refused'))

    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'direct-agent',
        messages: [{ role: 'user', content: 'Hello from direct agent.' }],
      },
    })

    // The direct agent must succeed regardless of agent-service state.
    expect(res.statusCode).toBe(200)
    expect(MOCK_REGISTRY.sendChatWithChain).toHaveBeenCalledOnce()
    expect(mockSendToAgentService).not.toHaveBeenCalled()

    const body = JSON.parse(res.payload)
    expect(body.message.content).toBe('Direct provider response.')
    expect(body.usedProvider).toBe('lm-studio-a')
  })

  it('legacy agent (no executionMode) is unaffected when agent-service is unavailable', async () => {
    mockSendToAgentService.mockRejectedValue(new Error('Connection refused'))

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

/**
 * Streaming endpoint tests for execution-mode-aware routing (Issues #110, #111, #112).
 *
 * Verifies that /api/chat/stream correctly translates orchestrator events into the
 * SSE contract and that gateway-chat-platform remains the owner of persistence and
 * notes sync regardless of whether execution is delegated to agent-service.
 */
describe('POST /api/chat/stream — execution-mode routing', () => {
  function parseSseEvents(rawBody: string): Array<Record<string, unknown>> {
    return rawBody
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
  }

  it('emits orchestrated SSE token events from the agent-service stream', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'orchestrated-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(200)
    const events = parseSseEvents(res.payload)
    const tokenEvents = events.filter((e) => e.type === 'token')
    expect(tokenEvents).toHaveLength(2)
    expect(tokenEvents.map((event) => event.token).join('')).toBe('Orchestrated response.')
  })

  it('emits a done event after the orchestrated response', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'orchestrated-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(200)
    const events = parseSseEvents(res.payload)
    const doneEvents = events.filter((e) => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].usedProvider).toBe('agent-service')
  })

  it('surfaces paused orchestrated runs in the done event without persisting a partial assistant turn', async () => {
    mockStreamFromAgentService.mockImplementationOnce(
      async (_request: unknown, onEvent: (event: { type: 'token' | 'done'; token?: string; model?: string; status?: string; orchestrationState?: unknown }) => void) => {
        onEvent({
          type: 'done',
          model: 'local-model',
          status: 'approval_required',
          orchestrationState: {
            checkpointId: 'approval-1',
            reason: 'Action requires approval',
          },
        })
        return {
          agentId: 'orchestrated-agent',
          usedProvider: 'agent-service',
          model: 'local-model',
          message: { role: 'assistant', content: '' },
          status: 'approval_required',
          orchestrationState: {
            checkpointId: 'approval-1',
            reason: 'Action requires approval',
          },
        }
      },
    )

    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'orchestrated-agent',
        threadId: 'paused-thread-1',
        messages: [{ role: 'user', content: 'Do the protected action.' }],
      },
    })

    expect(res.statusCode).toBe(200)
    const events = parseSseEvents(res.payload)
    const doneEvents = events.filter((event) => event.type === 'done')
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].status).toBe('approval_required')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockPersistMessage).not.toHaveBeenCalled()
  })

  it('persists user and assistant messages for orchestrated streaming runs', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'orchestrated-agent',
        threadId: 'stream-thread-1',
        messages: [{ role: 'user', content: 'Orchestrate me.' }],
      },
    })

    // Allow async persistence to flush
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockUpsertConversation).toHaveBeenCalled()

    const userCall = mockPersistMessage.mock.calls.find(
      (c: unknown[]) => (c[1] as { role: string }).role === 'user',
    )
    expect(userCall).toBeDefined()
    expect((userCall![1] as { content: string }).content).toBe('Orchestrate me.')

    const assistantCall = mockPersistMessage.mock.calls.find(
      (c: unknown[]) => (c[1] as { role: string }).role === 'assistant',
    )
    expect(assistantCall).toBeDefined()
    expect((assistantCall![1] as { content: string }).content).toBe('Orchestrated response.')

    expect(mockPersistUsageLog).toHaveBeenCalled()
  })

  it('persists the model returned by agent-service for orchestrated streaming runs', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'orchestrated-agent',
        threadId: 'stream-thread-model',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    const assistantCall = mockPersistMessage.mock.calls.find(
      (c: unknown[]) => (c[1] as { role: string }).role === 'assistant',
    )
    expect(assistantCall).toBeDefined()
    expect((assistantCall![1] as { model: string }).model).toBe('local-model')
    expect((assistantCall![1] as { provider: string }).provider).toBe('agent-service')
  })

  it('persists user and assistant messages for direct_provider streaming runs', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'direct-agent',
        threadId: 'stream-thread-direct',
        messages: [{ role: 'user', content: 'Hello direct.' }],
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    const userCall = mockPersistMessage.mock.calls.find(
      (c: unknown[]) => (c[1] as { role: string }).role === 'user',
    )
    expect(userCall).toBeDefined()

    const assistantCall = mockPersistMessage.mock.calls.find(
      (c: unknown[]) => (c[1] as { role: string }).role === 'assistant',
    )
    expect(assistantCall).toBeDefined()
    // Accumulated tokens from the mock: 'Direct ' + 'stream.'
    expect((assistantCall![1] as { content: string }).content).toBe('Direct stream.')
  })

  it('does not persist messages when threadId is absent', async () => {
    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'orchestrated-agent',
        messages: [{ role: 'user', content: 'No thread.' }],
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockPersistMessage).not.toHaveBeenCalled()
    expect(mockPersistUsageLog).not.toHaveBeenCalled()
  })

  it('calls syncAgentConversationToNotes after orchestrated streaming run when notes sync is configured', async () => {
    mockStreamFromAgentService.mockImplementationOnce(
      async (_request: unknown, onEvent: (event: { type: 'token' | 'done'; token?: string; model?: string; status?: string }) => void) => {
        onEvent({ type: 'token', token: 'Notes ' })
        onEvent({ type: 'token', token: 'response.' })
        onEvent({ type: 'done', model: 'local-model', status: 'completed' })
        return {
          agentId: 'orchestrated-notes-agent',
          usedProvider: 'agent-service',
          model: 'local-model',
          message: { role: 'assistant', content: 'Notes response.' },
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
          status: 'completed',
        }
      },
    )

    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'orchestrated-notes-agent',
        threadId: 'stream-notes-thread',
        messages: [{ role: 'user', content: 'Sync to notes.' }],
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockSyncAgentConversationToNotes).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'orchestrated-notes-agent' }),
      expect.objectContaining({
        threadId: 'stream-notes-thread',
        source: 'chat',
        userMessage: 'Sync to notes.',
        assistantMessage: 'Notes response.',
      }),
    )
  })

  it('emits an error SSE event when agent-service times out during a streaming request', async () => {
    mockStreamFromAgentService.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' }),
    )

    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'orchestrated-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    // The streaming connection is established (200) before execution begins.
    // Failures are communicated via SSE error events on the open stream.
    expect(res.statusCode).toBe(200)
    const events = parseSseEvents(res.payload)
    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].error).toContain('aborted')
  })

  it('direct_provider streaming is unaffected when agent-service is unavailable', async () => {
    mockStreamFromAgentService.mockRejectedValue(new Error('Connection refused'))

    const app = Fastify()
    await app.register(chatRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        agentId: 'direct-agent',
        messages: [{ role: 'user', content: 'Hello direct stream.' }],
      },
    })

    // Direct-provider streaming must succeed regardless of agent-service state.
    expect(res.statusCode).toBe(200)
    expect(mockStreamFromAgentService).not.toHaveBeenCalled()
    expect(MOCK_REGISTRY.streamChatWithChain).toHaveBeenCalledOnce()
  })
})
