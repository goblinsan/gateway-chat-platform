import type { FastifyInstance } from 'fastify'

export default async function personaRoutes(app: FastifyInstance) {
  app.all('/personas', async (_req, reply) => {
    return reply.status(410).send({ error: 'Personas moved out of chat-api SQLite persistence' })
  })

  app.all('/personas/*', async (_req, reply) => {
    return reply.status(410).send({ error: 'Personas moved out of chat-api SQLite persistence' })
  })
}
