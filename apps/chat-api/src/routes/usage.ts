import type { FastifyInstance } from 'fastify'
import { MODEL_RATES } from '../services/costEstimator'

export default async function usageRoutes(app: FastifyInstance) {
  app.get('/usage/summary', async (_req, reply) => {
    return reply.status(410).send({ error: 'Usage summary moved out of chat-api SQLite persistence' })
  })

  app.get('/usage/rates', async (_req, reply) => {
    const rates = Object.entries(MODEL_RATES).map(([model, pricing]) => ({
      model,
      inputPer1MTokens: pricing.input,
      outputPer1MTokens: pricing.output,
    }))
    return reply.send({ rates })
  })
}
