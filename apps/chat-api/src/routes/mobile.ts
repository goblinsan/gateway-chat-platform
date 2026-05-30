import type { FastifyInstance } from 'fastify'

export default async function mobileRoutes(app: FastifyInstance) {
  app.all('/mobile/*', async (_req, reply) => {
    return reply.status(410).send({ error: 'Legacy mobile alerts moved to agent-service notifications' })
  })
}
