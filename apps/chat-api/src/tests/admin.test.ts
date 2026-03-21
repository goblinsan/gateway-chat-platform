import { vi, describe, it, expect, beforeEach } from 'vitest'
import Fastify from 'fastify'
import adminRoutes from '../routes/admin'

const mockCount = vi.fn()

const mockPrisma = {
  usageLog: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
    count: mockCount,
  },
}

vi.mock('../services/db', () => ({
  getPrismaClient: () => mockPrisma,
}))

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(adminRoutes, { prefix: '/api' })
  return app
}

describe('GET /api/admin/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.usageLog.groupBy
      .mockResolvedValueOnce([
        { agentId: 'agent-1', _count: { id: 5 }, _sum: { totalTokens: 1000, estimatedCostUsd: 0.01 } },
      ])
      .mockResolvedValueOnce([
        { provider: 'openai', _count: { id: 5 }, _sum: { estimatedCostUsd: 0.01, totalTokens: 1000 } },
      ])
    mockPrisma.usageLog.findMany.mockResolvedValueOnce([
      {
        id: 'log-1',
        agentId: 'agent-1',
        provider: 'openai',
        model: 'gpt-4o',
        totalTokens: 200,
        estimatedCostUsd: 0.002,
        latencyMs: 350,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
    ])
  })

  it('returns stats with requestsByAgent, costByProvider, recentActivity', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('requestsByAgent')
    expect(body).toHaveProperty('costByProvider')
    expect(body).toHaveProperty('recentActivity')
  })

  it('maps requestsByAgent correctly', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats' })
    const body = JSON.parse(res.body)
    expect(body.requestsByAgent).toHaveLength(1)
    expect(body.requestsByAgent[0]).toEqual({
      agentId: 'agent-1',
      requestCount: 5,
      totalTokens: 1000,
      totalCostUsd: 0.01,
    })
  })

  it('maps costByProvider correctly', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats' })
    const body = JSON.parse(res.body)
    expect(body.costByProvider).toHaveLength(1)
    expect(body.costByProvider[0]).toEqual({
      provider: 'openai',
      requestCount: 5,
      totalTokens: 1000,
      totalCostUsd: 0.01,
    })
  })

  it('handles empty data (no usage logs)', async () => {
    vi.resetAllMocks()
    mockPrisma.usageLog.groupBy.mockResolvedValue([])
    mockPrisma.usageLog.findMany.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.requestsByAgent).toEqual([])
    expect(body.costByProvider).toEqual([])
    expect(body.recentActivity).toEqual([])
  })
})

describe('GET /api/admin/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.usageLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        agentId: 'agent-1',
        provider: 'openai',
        model: 'gpt-4o',
        totalTokens: 200,
        estimatedCostUsd: 0.002,
        latencyMs: 350,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        conversation: { id: 'thread-1', title: 'Test conversation' },
      },
    ])
    mockCount.mockResolvedValue(1)
  })

  it('returns logs and total count', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/logs' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('logs')
    expect(body).toHaveProperty('total', 1)
    expect(body.logs).toHaveLength(1)
  })

  it('respects limit and offset query params', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/api/admin/logs?limit=10&offset=5' })
    expect(mockPrisma.usageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 5 }),
    )
  })

  it('filters by agentId when provided', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/api/admin/logs?agentId=agent-1' })
    expect(mockPrisma.usageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agentId: 'agent-1' } }),
    )
  })

  it('filters by provider when provided', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/api/admin/logs?provider=openai' })
    expect(mockPrisma.usageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: 'openai' } }),
    )
  })

  it('caps limit at 200', async () => {
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/api/admin/logs?limit=500' })
    expect(mockPrisma.usageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    )
  })
})
