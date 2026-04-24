import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockEnv = {
  AGENT_SERVICE_URL: 'http://agent-service:8080',
  AGENT_SERVICE_API_KEY: 'test-api-key',
  AGENT_SERVICE_TIMEOUT_MS: 5000,
  AGENT_SERVICE_RETRY_COUNT: 2,
}

vi.mock('../config/env', () => ({
  getEnv: () => mockEnv,
}))

import { sendToAgentService, AgentServiceError } from '../services/agentServiceClient'

const MOCK_REQUEST = {
  agentId: 'local-analyst',
  model: 'local-model',
  messages: [
    { role: 'system' as const, content: 'You are an analyst.' },
    { role: 'user' as const, content: 'Analyze this.' },
  ],
  temperature: 0.3,
}

const MOCK_RESPONSE = {
  agentId: 'local-analyst',
  usedProvider: 'lm-studio-a',
  model: 'local-model',
  message: { role: 'assistant' as const, content: 'Analysis complete.' },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
}

describe('sendToAgentService', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    mockEnv.AGENT_SERVICE_URL = 'http://agent-service:8080'
    mockEnv.AGENT_SERVICE_API_KEY = 'test-api-key'
    mockEnv.AGENT_SERVICE_TIMEOUT_MS = 5000
    mockEnv.AGENT_SERVICE_RETRY_COUNT = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('sends request to AGENT_SERVICE_URL/run with Authorization header', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    })

    await sendToAgentService(MOCK_REQUEST)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://agent-service:8080/run')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-api-key')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('sends the normalized request payload as JSON body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    })

    await sendToAgentService(MOCK_REQUEST)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as typeof MOCK_REQUEST
    expect(body.agentId).toBe('local-analyst')
    expect(body.model).toBe('local-model')
    expect(body.messages).toHaveLength(2)
    expect(body.temperature).toBe(0.3)
  })

  it('returns the normalized response from the agent-service', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    })

    const result = await sendToAgentService(MOCK_REQUEST)

    expect(result.agentId).toBe('local-analyst')
    expect(result.usedProvider).toBe('lm-studio-a')
    expect(result.model).toBe('local-model')
    expect(result.message.content).toBe('Analysis complete.')
    expect(result.usage?.totalTokens).toBe(15)
  })

  it('omits Authorization header when AGENT_SERVICE_API_KEY is not set', async () => {
    mockEnv.AGENT_SERVICE_API_KEY = undefined as unknown as string

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    })

    await sendToAgentService(MOCK_REQUEST)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('throws AgentServiceError when AGENT_SERVICE_URL is not configured', async () => {
    mockEnv.AGENT_SERVICE_URL = undefined as unknown as string

    await expect(sendToAgentService(MOCK_REQUEST)).rejects.toThrow(AgentServiceError)
    await expect(sendToAgentService(MOCK_REQUEST)).rejects.toThrow('AGENT_SERVICE_URL is not configured')
  })

  it('throws AgentServiceError on non-ok HTTP response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    })

    await expect(sendToAgentService(MOCK_REQUEST)).rejects.toThrow(AgentServiceError)
  })

  it('includes the HTTP status code in the AgentServiceError message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    })

    await expect(sendToAgentService(MOCK_REQUEST)).rejects.toThrow('503')
  })

  it('retries on server errors and eventually throws after max retries', async () => {
    mockEnv.AGENT_SERVICE_RETRY_COUNT = 2

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })

    await expect(sendToAgentService(MOCK_REQUEST)).rejects.toThrow(AgentServiceError)
    // 1 initial attempt + 2 retries = 3 total calls
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 4xx client errors', async () => {
    mockEnv.AGENT_SERVICE_RETRY_COUNT = 2

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => 'Unprocessable Entity',
    })

    await expect(sendToAgentService(MOCK_REQUEST)).rejects.toThrow(AgentServiceError)
    // Only 1 call — no retry on client errors
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('succeeds on the second attempt after a transient server error', async () => {
    mockEnv.AGENT_SERVICE_RETRY_COUNT = 2

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Transient error',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      })

    const result = await sendToAgentService(MOCK_REQUEST)

    expect(result.agentId).toBe('local-analyst')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
