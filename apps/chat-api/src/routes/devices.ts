import type { FastifyInstance } from 'fastify'
import {
  AgentServiceError,
  registerDeviceTokenInAgentService,
  unregisterDeviceTokenInAgentService,
} from '../services/agentServiceClient'

export default async function devicesRoutes(app: FastifyInstance) {
  app.post<{ Body: { platform?: string; token?: string; app_version?: string } }>(
    '/devices',
    async (req, reply) => {
      const platform = (req.body.platform ?? 'ios').trim()
      const token = (req.body.token ?? '').trim()
      if (!token) return reply.status(400).send({ error: 'token is required' })

      try {
        await registerDeviceTokenInAgentService(req.userId, {
          platform,
          token,
          app_version: req.body.app_version,
        })
        return reply.status(204).send()
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'register device token')
      }
    },
  )

  app.delete<{ Params: { token: string } }>('/devices/:token', async (req, reply) => {
    try {
      await unregisterDeviceTokenInAgentService(req.userId, req.params.token)
      return reply.status(204).send()
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'delete device token')
    }
  })
}

function sendAgentServiceError(
  reply: import('fastify').FastifyReply,
  req: import('fastify').FastifyRequest,
  err: unknown,
  op: string,
) {
  if (err instanceof AgentServiceError && err.statusCode === 404) {
    return reply.status(404).send({ error: 'device token not found' })
  }
  req.log.error({ err, op }, 'device token operation failed')
  const message = err instanceof Error ? err.message : String(err)
  return reply.status(502).send({ error: message })
}
