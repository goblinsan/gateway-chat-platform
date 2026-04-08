import { vi, describe, it, expect, beforeEach } from 'vitest'
import Fastify from 'fastify'
import usageRoutes from '../routes/usage'

const mockGetUserUsageSummary = vi.fn()

vi.mock('../services/quotaService', () => ({
  getUserUsageSummary: (...args: unknown[]) => mockGetUserUsageSummary(...args),
}))

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({}),
}))

// Keep MODEL_RATES predictable for tests
vi.mock('../services/costEstimator', () => ({
  MODEL_RATES: {
    'gpt-4o': { input: 5.0, output: 15.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
  },
}))

async function buildApp() {
  const app = Fastify({ logger: false })
  app.decorateRequest('userId', 'me')
  await app.register(usageRoutes, { prefix: '/api' })
  return app
}

describe('GET /api/usage/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserUsageSummary.mockResolvedValue({
      userId: 'me',
      periodHours: 24,
      entries: [],
      totalTokens: 0,
      totalCostUsd: 0,
      totalRequests: 0,
    })
  })

  it('returns a summary object with expected fields', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/usage/summary' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('userId')
    expect(body).toHaveProperty('periodHours', 24)
    expect(body).toHaveProperty('entries')
    expect(body).toHaveProperty('totalTokens')
    expect(body).toHaveProperty('totalCostUsd')
    expect(body).toHaveProperty('totalRequests')
  })

  it('passes custom hours parameter to service', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/api/usage/summary?hours=48' })
    expect(mockGetUserUsageSummary).toHaveBeenCalledWith(expect.anything(), 'me', 48)
  })

  it('caps hours at 720', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/api/usage/summary?hours=9999' })
    expect(mockGetUserUsageSummary).toHaveBeenCalledWith(expect.anything(), 'me', 720)
  })

  it('rejects non-numeric hours', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/usage/summary?hours=abc' })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/usage/rates', () => {
  it('returns an array of model rate entries', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/usage/rates' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('rates')
    expect(Array.isArray(body.rates)).toBe(true)
    expect(body.rates[0]).toHaveProperty('model')
    expect(body.rates[0]).toHaveProperty('inputPer1MTokens')
    expect(body.rates[0]).toHaveProperty('outputPer1MTokens')
  })

  it('includes expected models', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/usage/rates' })
    const body = JSON.parse(res.body)
    const models = body.rates.map((r: { model: string }) => r.model)
    expect(models).toContain('gpt-4o')
    expect(models).toContain('gpt-4o-mini')
  })
})
