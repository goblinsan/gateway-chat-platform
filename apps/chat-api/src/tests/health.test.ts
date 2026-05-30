import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('../config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    BUILD_VERSION: '1.0.0',
    BUILD_COMMIT: 'abc123',
    CF_ACCESS_TEAM_DOMAIN: undefined,
    CF_ACCESS_AUD: undefined,
    CHAT_DEFAULT_USER_ID: 'me',
    LM_STUDIO_A_BASE_URL: undefined,
    LM_STUDIO_B_BASE_URL: undefined,
    OPENAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    GOOGLE_API_KEY: 'configured-for-test',
  }),
}))

vi.mock('../services/providerCheck', () => ({
  checkProvider: vi.fn().mockResolvedValue({ status: 'ok', latencyMs: 10 }),
}))

const mockIngestAppleHealthSummary = vi.fn()
const mockIngestPersonalDataBatch = vi.fn()

vi.mock('../services/agentServiceClient', () => ({
  AgentServiceError: class AgentServiceError extends Error {
    constructor(message: string, public readonly statusCode?: number) {
      super(message)
      this.name = 'AgentServiceError'
    }
  },
  ingestAppleHealthSummaryInAgentService: (...args: unknown[]) => mockIngestAppleHealthSummary(...args),
  ingestPersonalDataBatchInAgentService: (...args: unknown[]) => mockIngestPersonalDataBatch(...args),
}))

import Fastify from 'fastify'
import healthRoutes from '../routes/health'
import { checkProvider } from '../services/providerCheck'
import userIdentityPlugin from '../plugins/userIdentity'

beforeEach(() => {
  vi.clearAllMocks()
  mockIngestAppleHealthSummary.mockResolvedValue({ status: 'ok' })
  mockIngestPersonalDataBatch.mockResolvedValue({ status: 'accepted', processing_status: 'queued' })
})

describe('GET /api/health', () => {
  it('returns health response', async () => {
    const app = Fastify()
    await app.register(healthRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)

    const body = JSON.parse(res.payload)
    expect(body.version).toBe('1.0.0')
    expect(body.status).toBe('ok')
    expect(body.dependencies).toBeDefined()
  })

  it('returns 200 when one provider is degraded', async () => {
    const app = Fastify()
    vi.mocked(checkProvider).mockResolvedValueOnce({
      status: 'error',
      latencyMs: 12,
      error: 'HTTP 403',
    })
    await app.register(healthRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)

    const body = JSON.parse(res.payload)
    expect(body.status).toBe('degraded')
  })
})


describe('GET /api/ready', () => {
  it('returns ready response', async () => {
    const app = Fastify()
    await app.register(healthRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/ready' })
    expect(res.statusCode).toBe(200)

    const body = JSON.parse(res.payload)
    expect(body.status).toBe('ready')
  })
})

describe('POST /api/health/apple/summary', () => {
  it('forwards normalized Apple Health summary to agent-service', async () => {
    const app = Fastify()
    await app.register(userIdentityPlugin)
    await app.register(healthRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/health/apple/summary',
      headers: { 'x-user-id': 'alice' },
      payload: {
        date: '2026-05-27',
        timezone: 'America/New_York',
        activity: { steps: 10000, ignored: null },
        nutrition: { protein_grams: 140 },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockIngestAppleHealthSummary).toHaveBeenCalledWith('alice', {
      date: '2026-05-27',
      timezone: 'America/New_York',
      activity: { steps: 10000 },
      nutrition: { protein_grams: 140 },
    })
  })

  it('rejects empty summaries', async () => {
    const app = Fastify()
    await app.register(userIdentityPlugin)
    await app.register(healthRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/health/apple/summary',
      payload: { date: '2026-05-27' },
    })

    expect(res.statusCode).toBe(400)
    expect(mockIngestAppleHealthSummary).not.toHaveBeenCalled()
  })
})

describe('POST /api/personal-data/batches', () => {
  it('forwards a generalized personal data batch to agent-service', async () => {
    const app = Fastify()
    await app.register(userIdentityPlugin)
    await app.register(healthRoutes, { prefix: '/api' })

    const payload = {
      source_system: 'apple_healthkit',
      source_app: 'Apple Health',
      records: [
        {
          source_record_type: 'health.workout',
          source_record_id: 'workout-1',
          value: 3.1,
          unit: 'mile',
        },
      ],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/personal-data/batches',
      headers: { 'x-user-id': 'alice' },
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(mockIngestPersonalDataBatch).toHaveBeenCalledWith('alice', payload)
  })

  it('rejects batches without records', async () => {
    const app = Fastify()
    await app.register(userIdentityPlugin)
    await app.register(healthRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/personal-data/batches',
      payload: { source_system: 'apple_healthkit', records: [] },
    })

    expect(res.statusCode).toBe(400)
    expect(mockIngestPersonalDataBatch).not.toHaveBeenCalled()
  })
})
