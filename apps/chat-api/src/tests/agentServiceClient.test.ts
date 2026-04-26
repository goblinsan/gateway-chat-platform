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

import { sendToAgentService, streamFromAgentService, AgentServiceError } from '../services/agentServiceClient'

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

  it('sends chat requests to AGENT_SERVICE_URL/internal/chat with Authorization header', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    })

    await sendToAgentService(MOCK_REQUEST)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://agent-service:8080/internal/chat')
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
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.agent_id).toBe('local-analyst')
    expect((body.model_preferences as Record<string, unknown>).preferred).toBe('local-model')
    expect((body.messages as unknown[]).length).toBe(2)
    expect(body.thread_id).toBeUndefined()
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

  it('routes automation requests to AGENT_SERVICE_URL/internal/automation with normalized body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        run_id: 'run-1',
        status: 'completed',
        output: 'Automation complete.',
        model_backend: 'local-model',
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      }),
    })

    const result = await sendToAgentService({
      ...MOCK_REQUEST,
      workflowId: 'wf-123',
      workflowSource: 'scheduler',
      deliveryMode: 'inbox',
      userId: 'me',
      channelId: 'ops',
      threadId: 'thread-1',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://agent-service:8080/internal/automation')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.source).toBe('scheduler')
    expect(body.job_type).toBe('gateway_workflow')
    expect(body.request_id).toBe('thread-1')
    expect(body.thread_id).toBe('thread-1')
    expect(body.user_id).toBe('me')
    expect(body.agent_id).toBe('local-analyst')
    expect(body.response_mode).toBe('sync')
    expect(result.message.content).toBe('Automation complete.')
    expect(result.usedProvider).toBe('agent-service')
    expect(result.usage?.totalTokens).toBe(20)
  })

  it('maps paused automation responses with orchestration state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        run_id: 'run-2',
        status: 'approval_required',
        output: '',
        model_backend: 'local-model',
        orchestration_state: {
          checkpointId: 'approval-1',
          reason: 'Needs approval',
          toolName: 'file',
          toolParams: { path: '/tmp/out.txt' },
        },
      }),
    })

    const result = await sendToAgentService({
      ...MOCK_REQUEST,
      workflowId: 'wf-approval',
      workflowSource: 'scheduler',
      deliveryMode: 'inbox',
    })

    expect(result.status).toBe('approval_required')
    expect(result.orchestrationState?.checkpointId).toBe('approval-1')
    expect(result.orchestrationState?.toolName).toBe('file')
    expect(result.orchestrationState?.toolParams).toEqual({ path: '/tmp/out.txt' })
  })

  it('streams assistant deltas from AGENT_SERVICE_URL/internal/chat', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode([
            'data: {"type":"run.model_selected","data":{"backend":"local-model"}}',
            '',
            'data: {"type":"run.assistant_delta","data":{"delta":"Hello "}}',
            '',
            'data: {"type":"run.assistant_delta","data":{"delta":"world"}}',
            '',
            'data: {"type":"run.completed","data":{"response":"Hello world","model_backend":"local-model"}}',
            '',
          ].join('\n')))
          controller.close()
        },
      }),
    })

    const events: Array<{ type: string; token?: string }> = []
    const result = await streamFromAgentService(MOCK_REQUEST, (event) => {
      events.push(event as { type: string; token?: string })
    })

    expect(events.filter((event) => event.type === 'token')).toHaveLength(2)
    expect(result.message.content).toBe('Hello world')
    expect(result.model).toBe('local-model')
  })

  it('captures approval details from streamed approval events', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode([
            'data: {"type":"run.approval_requested","data":{"run_id":"run-9","approval_id":"appr-9","tool_name":"http","params":{"url":"https://example.com"},"reason":"Needs review"}}',
            '',
            'data: {"type":"run.paused","data":{"id":"run-9"}}',
            '',
          ].join('\n')))
          controller.close()
        },
      }),
    })

    const result = await streamFromAgentService(MOCK_REQUEST, () => undefined)

    expect(result.status).toBe('approval_required')
    expect(result.orchestrationState?.checkpointId).toBe('appr-9')
    expect(result.orchestrationState?.toolName).toBe('http')
    expect(result.orchestrationState?.toolParams).toEqual({ url: 'https://example.com' })
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
