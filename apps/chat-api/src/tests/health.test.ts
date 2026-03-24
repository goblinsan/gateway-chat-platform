import { describe, it, expect, vi } from 'vitest'

vi.mock('../config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    BUILD_VERSION: '1.0.0',
    BUILD_COMMIT: 'abc123',
    LM_STUDIO_A_BASE_URL: undefined,
    LM_STUDIO_B_BASE_URL: undefined,
    OPENAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    GOOGLE_API_KEY: undefined,
  }),
}))

vi.mock('../services/providerCheck', () => ({
  checkProvider: vi.fn().mockResolvedValue({ status: 'ok', latencyMs: 10 }),
}))

import Fastify from 'fastify'
import healthRoutes from '../routes/health'

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
