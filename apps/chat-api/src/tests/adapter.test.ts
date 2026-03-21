import { describe, it, expect, vi, afterEach } from 'vitest'
import { LmStudioAdapter } from '../providers/lmStudio'
import { OpenAiAdapter } from '../providers/openai'
import type { ProviderAdapter } from '@gateway/shared'

const MOCK_CHAT_RESPONSE = {
  id: 'chatcmpl-abc123',
  model: 'test-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello there!' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
}

const MOCK_MODELS_RESPONSE = {
  data: [
    { id: 'model-a', object: 'model' },
    { id: 'model-b', object: 'model' },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ──────────────────────────────────────────────────────────────────────────────
// Interface compliance: both adapters must satisfy ProviderAdapter
// ──────────────────────────────────────────────────────────────────────────────
describe('ProviderAdapter interface compliance', () => {
  it('LmStudioAdapter satisfies the ProviderAdapter interface', () => {
    const adapter: ProviderAdapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
    expect(typeof adapter.sendChat).toBe('function')
    expect(typeof adapter.streamChat).toBe('function')
    expect(typeof adapter.listModels).toBe('function')
    expect(typeof adapter.testConnection).toBe('function')
    expect(adapter.name).toBe('lm-studio-a')
  })

  it('OpenAiAdapter satisfies the ProviderAdapter interface', () => {
    const adapter: ProviderAdapter = new OpenAiAdapter('openai', 'sk-test-key')
    expect(typeof adapter.sendChat).toBe('function')
    expect(typeof adapter.streamChat).toBe('function')
    expect(typeof adapter.listModels).toBe('function')
    expect(typeof adapter.testConnection).toBe('function')
    expect(adapter.name).toBe('openai')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// LmStudioAdapter
// ──────────────────────────────────────────────────────────────────────────────
describe('LmStudioAdapter', () => {
  describe('sendChat', () => {
    it('returns a normalized ChatResponse on success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_CHAT_RESPONSE),
        }),
      )

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
      const result = await adapter.sendChat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.id).toBe('chatcmpl-abc123')
      expect(result.model).toBe('test-model')
      expect(result.message.role).toBe('assistant')
      expect(result.message.content).toBe('Hello there!')
      expect(result.finishReason).toBe('stop')
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      })
    })

    it('throws on non-OK HTTP response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service Unavailable'),
        }),
      )

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
      await expect(
        adapter.sendChat({ model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow('HTTP 503')
    })

    it('throws on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
      await expect(
        adapter.sendChat({ model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow('ECONNREFUSED')
    })
  })

  describe('listModels', () => {
    it('returns normalized ModelInfo array', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_MODELS_RESPONSE),
        }),
      )

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
      const models = await adapter.listModels()

      expect(models).toHaveLength(2)
      expect(models[0]).toEqual({ id: 'model-a', name: 'model-a' })
      expect(models[1]).toEqual({ id: 'model-b', name: 'model-b' })
    })

    it('throws on non-OK HTTP response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      )

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
      await expect(adapter.listModels()).rejects.toThrow('HTTP 500')
    })
  })

  describe('testConnection', () => {
    it('returns ok when host is reachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      )

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
      const result = await adapter.testConnection()

      expect(result.status).toBe('ok')
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('returns error when host is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:9999')
      const result = await adapter.testConnection()

      expect(result.status).toBe('error')
      expect(result.error).toContain('ECONNREFUSED')
    })

    it('returns error for non-OK HTTP status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 503 }),
      )

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
      const result = await adapter.testConnection()

      expect(result.status).toBe('error')
      expect(result.error).toContain('HTTP 503')
    })
  })

  describe('streamChat', () => {
    it('emits token and done events from SSE stream', async () => {
      const sseLines = [
        'data: {"id":"1","model":"m","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
        'data: {"id":"2","model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ].join('\n')

      const encoder = new TextEncoder()
      const encoded = encoder.encode(sseLines)
      let consumed = false

      const mockReader = {
        read: vi.fn().mockImplementationOnce(() => {
          consumed = true
          return Promise.resolve({ done: false, value: encoded })
        }).mockImplementationOnce(() => Promise.resolve({ done: true, value: undefined })),
        releaseLock: vi.fn(),
      }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          body: { getReader: () => mockReader },
        }),
      )

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
      const events: import('@gateway/shared').StreamEvent[] = []
      await adapter.streamChat(
        { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] },
        e => events.push(e),
      )

      expect(consumed).toBe(true)
      const tokenEvents = events.filter(e => e.type === 'token')
      expect(tokenEvents.length).toBeGreaterThan(0)
      expect(tokenEvents[0].token).toBe('Hello')
    })

    it('emits error event on non-OK HTTP response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          text: () => Promise.resolve('unavailable'),
        }),
      )

      const adapter = new LmStudioAdapter('lm-studio-a', 'http://localhost:1234')
      const events: import('@gateway/shared').StreamEvent[] = []
      await adapter.streamChat(
        { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] },
        e => events.push(e),
      )

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('error')
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// OpenAiAdapter
// ──────────────────────────────────────────────────────────────────────────────
describe('OpenAiAdapter', () => {
  describe('sendChat', () => {
    it('returns a normalized ChatResponse on success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_CHAT_RESPONSE),
        }),
      )

      const adapter = new OpenAiAdapter('openai', 'sk-test-key')
      const result = await adapter.sendChat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.id).toBe('chatcmpl-abc123')
      expect(result.model).toBe('test-model')
      expect(result.message.role).toBe('assistant')
      expect(result.message.content).toBe('Hello there!')
      expect(result.finishReason).toBe('stop')
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      })
    })

    it('throws on non-OK HTTP response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limit exceeded'),
        }),
      )

      const adapter = new OpenAiAdapter('openai', 'sk-test-key')
      await expect(
        adapter.sendChat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow('HTTP 429')
    })

    it('includes Authorization header in requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_CHAT_RESPONSE),
      })
      vi.stubGlobal('fetch', mockFetch)

      const adapter = new OpenAiAdapter('openai', 'sk-secret-key')
      await adapter.sendChat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
      })

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = options.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer sk-secret-key')
    })
  })

  describe('listModels', () => {
    it('returns normalized ModelInfo array', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_MODELS_RESPONSE),
        }),
      )

      const adapter = new OpenAiAdapter('openai', 'sk-test-key')
      const models = await adapter.listModels()

      expect(models).toHaveLength(2)
      expect(models[0]).toEqual({ id: 'model-a', name: 'model-a' })
    })
  })

  describe('testConnection', () => {
    it('returns ok on successful response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      )

      const adapter = new OpenAiAdapter('openai', 'sk-test-key')
      const result = await adapter.testConnection()

      expect(result.status).toBe('ok')
    })

    it('returns ok on 401 (host reachable, invalid key)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 401 }),
      )

      const adapter = new OpenAiAdapter('openai', 'bad-key')
      const result = await adapter.testConnection()

      expect(result.status).toBe('ok')
    })

    it('returns error on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

      const adapter = new OpenAiAdapter('openai', 'sk-test-key')
      const result = await adapter.testConnection()

      expect(result.status).toBe('error')
      expect(result.error).toContain('ECONNREFUSED')
    })
  })
})
