import type { FastifyInstance } from 'fastify'
import { getPrismaClient } from '../services/db'
import { getUserUsageSummary } from '../services/quotaService'
import { MODEL_RATES } from '../services/costEstimator'

const summaryQuerySchema = {
  type: 'object',
  properties: {
    hours: { type: 'string', pattern: '^[0-9]+$' },
  },
  additionalProperties: false,
} as const

export default async function usageRoutes(app: FastifyInstance) {
  /**
   * GET /api/usage/summary
   * Returns per-model usage and quota status for the authenticated user.
   * Optional ?hours=N (default 24) sets the rolling window for period totals.
   */
  app.get(
    '/usage/summary',
    {
      schema: { querystring: summaryQuerySchema },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { hours = '24' } = req.query as { hours?: string }
      const periodHours = Math.min(parseInt(hours, 10) || 24, 720) // cap at 30 days
      const prisma = getPrismaClient()
      const summary = await getUserUsageSummary(prisma, req.userId, periodHours)
      return reply.send(summary)
    },
  )

  /**
   * GET /api/usage/rates
   * Returns the static per-model pricing table used for cost estimation.
   * Free/local models without a pricing entry are omitted (cost is always $0).
   */
  app.get(
    '/usage/rates',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      const rates = Object.entries(MODEL_RATES).map(([model, pricing]) => ({
        model,
        inputPer1MTokens: pricing.input,
        outputPer1MTokens: pricing.output,
      }))
      return reply.send({ rates })
    },
  )
}
