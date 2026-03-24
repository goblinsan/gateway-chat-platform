import type { FastifyInstance } from 'fastify'
import { getPrismaClient } from '../services/db'
import { KNOWN_PROVIDER_NAME_SET } from '../config/providers'

const logsQuerySchema = {
  type: 'object',
  properties: {
    limit: { type: 'string', pattern: '^[0-9]+$' },
    offset: { type: 'string', pattern: '^[0-9]+$' },
    agentId: { type: 'string', minLength: 1, maxLength: 64 },
    provider: { type: 'string', minLength: 1, maxLength: 32 },
  },
  additionalProperties: false,
} as const

export default async function adminRoutes(app: FastifyInstance) {
  app.get(
    '/admin/stats',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      req.log.info({ event: 'audit.admin.stats', ip: req.ip }, 'Admin stats accessed')
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
        requestsByAgent: requestsByAgent.map((r: (typeof requestsByAgent)[number]) => ({
          agentId: r.agentId,
          requestCount: r._count.id,
          totalTokens: r._sum.totalTokens ?? 0,
          totalCostUsd: r._sum.estimatedCostUsd ?? 0,
        })),
        costByProvider: costByProvider.map((r: (typeof costByProvider)[number]) => ({
          provider: r.provider,
          requestCount: r._count.id,
          totalTokens: r._sum.totalTokens ?? 0,
          totalCostUsd: r._sum.estimatedCostUsd ?? 0,
        })),
        recentActivity,
      })
    },
  )

  app.get(
    '/admin/logs',
    {
      schema: { querystring: logsQuerySchema },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const prisma = getPrismaClient()
      const { limit = '50', offset = '0', agentId, provider } = req.query as {
        limit?: string
        offset?: string
        agentId?: string
        provider?: string
      }

      // Reject unknown provider names to prevent NoSQL-style injection
      if (provider && !KNOWN_PROVIDER_NAME_SET.has(provider)) {
        return reply.status(400).send({ error: 'Invalid provider filter value' })
      }

      req.log.info({ event: 'audit.admin.logs', ip: req.ip, agentId, provider }, 'Admin logs accessed')

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
    },
  )
}
