import type { FastifyInstance } from 'fastify'

export default async function sessionRoutes(app: FastifyInstance) {
  app.get('/session/me', async (req, reply) => {
    return reply.send({ userId: req.userId })
  })
}
