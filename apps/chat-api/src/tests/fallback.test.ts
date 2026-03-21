import { describe, it, expect, vi, afterEach } from 'vitest'
import { ProviderRegistry } from '../providers/registry'
import type { ProviderAdapter, ChatRequest } from '@gateway/shared'

const MOCK_RESPONSE = {
  id: 'chatcmpl-1',
  model: 'test-model',
  message: { role: 'assistant' as const, content: 'Hello' },
  finishReason: 'stop' as const,
  usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
}

function makeMockAdapter(
  name: string,
  behaviour: 'success' | 'error' = 'success',
): ProviderAdapter {
  return {
    name,
    sendChat: vi.fn(async (_req: ChatRequest) => {
      if (behaviour === 'error') throw new Error(`${name} unavailable`)
      return MOCK_RESPONSE
    }),
    streamChat: vi.fn(async (_req: ChatRequest, onEvent) => {
      if (behaviour === 'error') throw new Error(`${name} unavailable`)
      onEvent({ type: 'token', token: 'Hi' })
      onEvent({ type: 'done', finishReason: 'stop' })
    }),
    listModels: vi.fn(async () => []),
    testConnection: vi.fn(async () =>
      behaviour === 'error'
        ? { status: 'error' as const, latencyMs: 0, error: `${name} unavailable` }
        : { status: 'ok' as const, latencyMs: 10 },
    ),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProviderRegistry', () => {
  describe('register / get / getAll', () => {
    it('registers an adapter and retrieves it by name', () => {
      const registry = new ProviderRegistry()
      const adapter = makeMockAdapter('lm-studio-a')
      registry.register(adapter)

      expect(registry.get('lm-studio-a')).toBe(adapter)
    })

    it('getAll returns all registered adapters', () => {
      const registry = new ProviderRegistry()
      registry.register(makeMockAdapter('lm-studio-a'))
      registry.register(makeMockAdapter('openai'))

      expect(registry.getAll()).toHaveLength(2)
    })

    it('returns undefined for unknown provider name', () => {
      const registry = new ProviderRegistry()
      expect(registry.get('unknown')).toBeUndefined()
    })
  })

  describe('sendChatWithFallback', () => {
    const request: ChatRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
    }

    it('uses the primary provider when it is available', async () => {
      const registry = new ProviderRegistry()
      const primary = makeMockAdapter('lm-studio-a')
      const fallback = makeMockAdapter('openai')
      registry.register(primary).register(fallback)
      registry.setFallbackChain('lm-studio-a', ['openai'])

      const result = await registry.sendChatWithFallback('lm-studio-a', request)

      expect(result.usedProvider).toBe('lm-studio-a')
      expect(primary.sendChat).toHaveBeenCalledTimes(1)
      expect(fallback.sendChat).not.toHaveBeenCalled()
    })

    it('falls back to the next provider when the primary fails', async () => {
      const registry = new ProviderRegistry()
      const primary = makeMockAdapter('lm-studio-a', 'error')
      const fallback = makeMockAdapter('openai', 'success')
      registry.register(primary).register(fallback)
      registry.setFallbackChain('lm-studio-a', ['openai'])

      const result = await registry.sendChatWithFallback('lm-studio-a', request)

      expect(result.usedProvider).toBe('openai')
      expect(primary.sendChat).toHaveBeenCalledTimes(1)
      expect(fallback.sendChat).toHaveBeenCalledTimes(1)
    })

    it('tries lm-studio-b before openai in a three-tier chain', async () => {
      const registry = new ProviderRegistry()
      const primary = makeMockAdapter('lm-studio-a', 'error')
      const secondary = makeMockAdapter('lm-studio-b', 'error')
      const tertiary = makeMockAdapter('openai', 'success')
      registry.register(primary).register(secondary).register(tertiary)
      registry.setFallbackChain('lm-studio-a', ['lm-studio-b', 'openai'])

      const result = await registry.sendChatWithFallback('lm-studio-a', request)

      expect(result.usedProvider).toBe('openai')
      expect(primary.sendChat).toHaveBeenCalledTimes(1)
      expect(secondary.sendChat).toHaveBeenCalledTimes(1)
      expect(tertiary.sendChat).toHaveBeenCalledTimes(1)
    })

    it('throws when all providers in the chain fail', async () => {
      const registry = new ProviderRegistry()
      registry.register(makeMockAdapter('lm-studio-a', 'error'))
      registry.register(makeMockAdapter('openai', 'error'))
      registry.setFallbackChain('lm-studio-a', ['openai'])

      await expect(registry.sendChatWithFallback('lm-studio-a', request)).rejects.toThrow(
        'openai unavailable',
      )
    })

    it('throws when primary provider is not registered', async () => {
      const registry = new ProviderRegistry()

      await expect(registry.sendChatWithFallback('lm-studio-a', request)).rejects.toThrow()
    })

    it('skips missing fallback adapters and uses the next available one', async () => {
      const registry = new ProviderRegistry()
      const primary = makeMockAdapter('lm-studio-a', 'error')
      const tertiary = makeMockAdapter('openai', 'success')
      // 'lm-studio-b' is in the chain but not registered
      registry.register(primary).register(tertiary)
      registry.setFallbackChain('lm-studio-a', ['lm-studio-b', 'openai'])

      const result = await registry.sendChatWithFallback('lm-studio-a', request)

      expect(result.usedProvider).toBe('openai')
    })
  })

  describe('streamChatWithFallback', () => {
    const request: ChatRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
    }

    it('uses the primary provider and returns its name', async () => {
      const registry = new ProviderRegistry()
      registry.register(makeMockAdapter('lm-studio-a', 'success'))
      registry.register(makeMockAdapter('openai', 'success'))
      registry.setFallbackChain('lm-studio-a', ['openai'])

      const events: import('@gateway/shared').StreamEvent[] = []
      const usedProvider = await registry.streamChatWithFallback(
        'lm-studio-a',
        request,
        e => events.push(e),
      )

      expect(usedProvider).toBe('lm-studio-a')
      expect(events.some(e => e.type === 'token')).toBe(true)
    })

    it('falls back to next provider when primary stream fails', async () => {
      const registry = new ProviderRegistry()
      registry.register(makeMockAdapter('lm-studio-a', 'error'))
      registry.register(makeMockAdapter('openai', 'success'))
      registry.setFallbackChain('lm-studio-a', ['openai'])

      const events: import('@gateway/shared').StreamEvent[] = []
      const usedProvider = await registry.streamChatWithFallback(
        'lm-studio-a',
        request,
        e => events.push(e),
      )

      expect(usedProvider).toBe('openai')
    })

    it('emits error event and throws when all stream providers fail', async () => {
      const registry = new ProviderRegistry()
      registry.register(makeMockAdapter('lm-studio-a', 'error'))
      registry.register(makeMockAdapter('openai', 'error'))
      registry.setFallbackChain('lm-studio-a', ['openai'])

      const events: import('@gateway/shared').StreamEvent[] = []
      await expect(
        registry.streamChatWithFallback('lm-studio-a', request, e => events.push(e)),
      ).rejects.toThrow()

      expect(events.some(e => e.type === 'error')).toBe(true)
    })
  })
})
