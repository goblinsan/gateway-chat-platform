import type { FastifyInstance } from 'fastify'
import type { UserProfile } from '@gateway/shared'
import {
  AgentServiceError,
  getUserProfileFromAgentService,
  updateUserProfileInAgentService,
} from '../services/agentServiceClient'

export default async function profileRoutes(app: FastifyInstance) {
  app.get('/profile', async (req, reply) => {
    try {
      const profile = await getUserProfileFromAgentService(req.userId)
      return reply.send({ profile })
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'get profile')
    }
  })

  app.put<{ Body: { profile?: UserProfile } }>('/profile', async (req, reply) => {
    if (!req.body.profile) {
      return reply.status(400).send({ error: 'profile is required' })
    }
    try {
      const profile = await updateUserProfileInAgentService(req.userId, req.body.profile)
      return reply.send({ profile })
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'update profile')
    }
  })
}

function sendAgentServiceError(
  reply: import('fastify').FastifyReply,
  req: import('fastify').FastifyRequest,
  err: unknown,
  op: string,
) {
  req.log.error({ err, op }, 'profile operation failed')
  const message = err instanceof AgentServiceError || err instanceof Error ? err.message : String(err)
  return reply.status(502).send({ error: message })
}