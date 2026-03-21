import type { FastifyInstance } from 'fastify'
import { getPrismaClient } from '../services/db'

export default async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/stats', async (_req, reply) => {
    const prisma = getPrismaClient()

    const [requestsByAgent, costByProvider, recentActivity] = await Promise.all([
      prisma.usageLog.groupBy({
        by: ['agentId'],
        _count: { id: true },
        _sum: { totalTokens: true, estimatedCostUsd: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.usageLog.groupBy({
        by: ['provider'],
        _count: { id: true },
        _sum: { estimatedCostUsd: true, totalTokens: true },
        orderBy: { _sum: { estimatedCostUsd: 'desc' } },
      }),
      prisma.usageLog.findMany({
        where: { estimatedCostUsd: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          agentId: true,
          provider: true,
          model: true,
          totalTokens: true,
          estimatedCostUsd: true,
          latencyMs: true,
          createdAt: true,
        },
      }),
    ])

    return reply.send({
      requestsByAgent: requestsByAgent.map((r) => ({
        agentId: r.agentId,
        requestCount: r._count.id,
        totalTokens: r._sum.totalTokens ?? 0,
        totalCostUsd: r._sum.estimatedCostUsd ?? 0,
      })),
      costByProvider: costByProvider.map((r) => ({
        provider: r.provider,
        requestCount: r._count.id,
        totalTokens: r._sum.totalTokens ?? 0,
        totalCostUsd: r._sum.estimatedCostUsd ?? 0,
      })),
      recentActivity,
    })
  })

  app.get('/admin/logs', async (req, reply) => {
    const prisma = getPrismaClient()
    const { limit = '50', offset = '0', agentId, provider } = req.query as {
      limit?: string
      offset?: string
      agentId?: string
      provider?: string
    }

    const where: Record<string, unknown> = {}
    if (agentId) where['agentId'] = agentId
    if (provider) where['provider'] = provider

    const [logs, total] = await Promise.all([
      prisma.usageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(limit, 10), 200),
        skip: parseInt(offset, 10),
        include: {
          conversation: { select: { id: true, title: true } },
        },
      }),
      prisma.usageLog.count({ where }),
    ])

    return reply.send({ logs, total })
  })
}
