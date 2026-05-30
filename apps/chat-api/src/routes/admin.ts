import type { FastifyInstance } from 'fastify'

export default async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/stats', async (_req, reply) => {
    return reply.status(410).send({ error: 'Admin stats moved out of chat-api SQLite persistence' })
  })

  app.get('/admin/logs', async (_req, reply) => {
    return reply.status(410).send({ error: 'Admin logs moved out of chat-api SQLite persistence' })
  })
}
