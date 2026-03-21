import { describe, it, expect, vi, afterEach } from 'vitest'
import { withRetry, withTimeout, isRetryableError } from '../utils/retry'
import { normalizeFinishReason, normalizeUsage, normalizeChatResponse, parseStreamLine } from '../providers/normalize'

afterEach(() => {
  vi.restoreAllMocks()
})

// ──────────────────────────────────────────────────────────────────────────────
// Retry utilities
// ──────────────────────────────────────────────────────────────────────────────
describe('isRetryableError', () => {
  it('returns true for network errors', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true)
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true)
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true)
  })

  it('returns true for rate limit errors', () => {
    expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true)
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true)
  })

  it('returns false for non-retryable errors', () => {
    expect(isRetryableError(new Error('HTTP 400: Bad Request'))).toBe(false)
    expect(isRetryableError(new Error('HTTP 401: Unauthorized'))).toBe(false)
    expect(isRetryableError(null)).toBe(false)
  })
})

describe('withRetry', () => {
  it('returns immediately when the function succeeds on the first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success')
    const result = await withRetry(fn)
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on retryable errors and returns when a subsequent attempt succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws immediately on non-retryable errors without retry', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 400: Bad Request'))
    await expect(withRetry(fn, { maxAttempts: 3, initialDelayMs: 0 })).rejects.toThrow(
      'HTTP 400',
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting all retry attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(withRetry(fn, { maxAttempts: 2, initialDelayMs: 0 })).rejects.toThrow(
      'ECONNREFUSED',
    )
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('withTimeout', () => {
  it('resolves when the promise completes before the timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000)
    expect(result).toBe(42)
  })

  it('rejects when the timeout elapses before the promise resolves', async () => {
    const neverResolves = new Promise<never>(() => undefined)
    await expect(withTimeout(neverResolves, 1)).rejects.toThrow('timed out')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Normalization helpers
// ──────────────────────────────────────────────────────────────────────────────
describe('normalizeFinishReason', () => {
  it('maps known finish reasons correctly', () => {
    expect(normalizeFinishReason('stop')).toBe('stop')
    expect(normalizeFinishReason('length')).toBe('length')
    expect(normalizeFinishReason('tool_calls')).toBe('tool_calls')
  })

  it('returns null for unknown or missing values', () => {
    expect(normalizeFinishReason(null)).toBeNull()
    expect(normalizeFinishReason(undefined)).toBeNull()
    expect(normalizeFinishReason('unknown_value')).toBeNull()
  })
})

describe('normalizeUsage', () => {
  it('maps prompt, completion, and total token counts', () => {
    const result = normalizeUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    })
    expect(result).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
  })

  it('returns undefined when raw usage is not provided', () => {
    expect(normalizeUsage(undefined)).toBeUndefined()
  })
})

describe('normalizeChatResponse', () => {
  it('maps a full OpenAI response to the normalized shape', () => {
    const raw = {
      id: 'cmpl-xyz',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hi there' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    }

    const result = normalizeChatResponse(raw)

    expect(result.id).toBe('cmpl-xyz')
    expect(result.model).toBe('gpt-4o')
    expect(result.message).toEqual({ role: 'assistant', content: 'Hi there' })
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 4, totalTokens: 12 })
  })
})

describe('parseStreamLine', () => {
  it('returns null for blank or non-data lines', () => {
    expect(parseStreamLine('')).toBeNull()
    expect(parseStreamLine('event: ping')).toBeNull()
  })

  it('returns a done event for the [DONE] sentinel', () => {
    expect(parseStreamLine('data: [DONE]')).toEqual({ type: 'done' })
  })

  it('returns a token event for a delta with content', () => {
    const line =
      'data: {"id":"1","model":"m","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}'
    expect(parseStreamLine(line)).toEqual({ type: 'token', token: 'Hi' })
  })

  it('returns a done event with finishReason when finish_reason is set', () => {
    const line =
      'data: {"id":"1","model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}'
    const result = parseStreamLine(line)
    expect(result?.type).toBe('done')
    expect(result?.finishReason).toBe('stop')
  })

  it('returns null for malformed JSON', () => {
    expect(parseStreamLine('data: {not valid json}')).toBeNull()
  })
})
