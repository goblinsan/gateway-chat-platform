import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkProvider } from '../services/providerCheck'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('checkProvider', () => {
  it('returns ok for a reachable provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))

    const result = await checkProvider('lm-studio-a', 'http://localhost:1234')
    expect(result.status).toBe('ok')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('returns error for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const result = await checkProvider('lm-studio-a', 'http://localhost:9999')
    expect(result.status).toBe('error')
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('returns ok for 401 (key invalid but host reachable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    const result = await checkProvider('openai', 'https://api.openai.com', 'bad-key')
    expect(result.status).toBe('ok')
  })
})
