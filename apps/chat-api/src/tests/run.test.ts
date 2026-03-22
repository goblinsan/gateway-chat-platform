import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../agents/registry', () => {
  const AGENTS = [
    {
      id: 'local-analyst',
      name: 'Local Analyst',
      icon: '🔍',
      color: '#3b82f6',
      providerName: 'lm-studio-a',
      model: 'local-model',
      costClass: 'free',
      systemPrompt: 'You are a precise local analyst.',
      temperature: 0.3,
      routingPolicy: {
        preferredProvider: 'lm-studio-a',
        allowedProviders: ['lm-studio-a', 'lm-studio-b'],
        maxCostClass: 'free',
      },
      enabled: true,
    },
  ]
  return {
    listAgents: () => AGENTS,
    getAgent: (id: string) => AGENTS.find((a) => a.id === id),
    getAgentRegistry: () => ({
      list: () => AGENTS,
      get: (id: string) => AGENTS.find((a) => a.id === id),
    }),
  }
})

const MOCK_REGISTRY = {
  sendChatWithChain: vi.fn().mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Analysis complete.' },
      finishReason: 'stop',
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
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

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({
    usageLog: { create: vi.fn() },
  }),
}))

vi.mock('../services/persistence', () => ({
  persistUsageLog: vi.fn(),
}))

vi.mock('../services/costEstimator', () => ({
  estimateCostUsd: () => 0,
}))

// TTS client mock
const mockSynthesize = vi.fn()
vi.mock('../services/ttsClient', () => ({
  synthesize: (...args: unknown[]) => mockSynthesize(...args),
}))

// Env mock — default TTS disabled
const mockEnv = {
  TTS_ENABLED: false,
  TTS_BASE_URL: 'http://192.168.0.111:5000',
  TTS_DEFAULT_VOICE: 'assistant_v1',
}
vi.mock('../config/env', () => ({
  getEnv: () => mockEnv,
}))

import Fastify from 'fastify'
import agentRunRoutes from '../routes/run'

beforeEach(() => {
  vi.clearAllMocks()
  mockEnv.TTS_ENABLED = false
  MOCK_REGISTRY.sendChatWithChain.mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Analysis complete.' },
      finishReason: 'stop',
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    },
    usedProvider: 'lm-studio-a',
  })
})

describe('POST /api/agents/:id/run', () => {
  it('returns a successful response for a known agent', async () => {
    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/local-analyst/run',
      payload: { prompt: 'Analyze this data set.' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.agentId).toBe('local-analyst')
    expect(body.usedProvider).toBe('lm-studio-a')
    expect(body.model).toBe('local-model')
    expect(body.content).toBe('Analysis complete.')
    expect(body.latencyMs).toBeTypeOf('number')
    expect(body.usage).toEqual({
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    })
  })

  it('returns 404 for an unknown agent', async () => {
    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/does-not-exist/run',
      payload: { prompt: 'Hello' },
    })

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('does-not-exist')
  })

  it('returns 400 when prompt is missing', async () => {
    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/local-analyst/run',
      payload: {},
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 502 when provider execution fails', async () => {
    MOCK_REGISTRY.sendChatWithChain.mockRejectedValueOnce(
      new Error('All providers failed'),
    )

    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/local-analyst/run',
      payload: { prompt: 'Analyze this.' },
    })

    expect(res.statusCode).toBe(502)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('All providers failed')
  })

  it('injects system prompt before the user prompt', async () => {
    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    await app.inject({
      method: 'POST',
      url: '/api/agents/local-analyst/run',
      payload: { prompt: 'Analyze this.' },
    })

    const call = MOCK_REGISTRY.sendChatWithChain.mock.calls[0]
    const [, request] = call as [string[], { messages: Array<{ role: string; content: string }> }]
    expect(request.messages[0].role).toBe('system')
    expect(request.messages[0].content).toContain('precise local analyst')
    expect(request.messages[1].role).toBe('user')
    expect(request.messages[1].content).toBe('Analyze this.')
  })

  it('accepts optional context and delivery fields', async () => {
    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/local-analyst/run',
      payload: {
        prompt: 'Run report.',
        context: {
          workflowId: 'wf-123',
          source: 'scheduler',
          metadata: { env: 'production' },
        },
        delivery: {
          mode: 'telegram',
          channel: 'ops',
          to: '@admin',
        },
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.agentId).toBe('local-analyst')
    expect(body.content).toBe('Analysis complete.')
  })

  it('response shape matches AgentRunResponse', async () => {
    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/local-analyst/run',
      payload: { prompt: 'Test response shape.' },
    })

    const body = JSON.parse(res.payload)
    // Verify all required fields are present
    expect(body).toHaveProperty('agentId')
    expect(body).toHaveProperty('usedProvider')
    expect(body).toHaveProperty('model')
    expect(body).toHaveProperty('content')
    expect(body).toHaveProperty('latencyMs')
    // Verify no chat-specific fields leak in
    expect(body).not.toHaveProperty('message')
    expect(body).not.toHaveProperty('routingExplanation')
  })

  it('returns TTS metadata when delivery.mode is tts and TTS is enabled', async () => {
    mockEnv.TTS_ENABLED = true
    mockSynthesize.mockResolvedValueOnce({
      contentType: 'audio/wav',
      audioBuffer: Buffer.from('fake audio'),
    })

    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/local-analyst/run',
      payload: {
        prompt: 'Morning briefing.',
        delivery: { mode: 'tts', voice: 'bruvie', format: 'mp3' },
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.tts).toBeDefined()
    expect(body.tts.enabled).toBe(true)
    expect(body.tts.voice).toBe('bruvie')
    expect(body.tts.format).toBe('mp3')
    expect(body.tts.contentType).toBe('audio/wav')
    expect(body.content).toBe('Analysis complete.')

    expect(mockSynthesize).toHaveBeenCalledWith({
      text: 'Analysis complete.',
      voice: 'bruvie',
      format: 'mp3',
    })
  })

  it('returns 409 when delivery.mode is tts but TTS is disabled', async () => {
    mockEnv.TTS_ENABLED = false

    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/local-analyst/run',
      payload: {
        prompt: 'Run report.',
        delivery: { mode: 'tts' },
      },
    })

    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('not enabled')
  })

  it('returns response with tts metadata even when synthesis fails', async () => {
    mockEnv.TTS_ENABLED = true
    mockSynthesize.mockRejectedValueOnce(new Error('Upstream TTS down'))

    const app = Fastify()
    await app.register(agentRunRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/local-analyst/run',
      payload: {
        prompt: 'Try synthesis.',
        delivery: { mode: 'tts' },
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.content).toBe('Analysis complete.')
    expect(body.tts).toBeDefined()
    expect(body.tts.contentType).toBe('')
  })
})
