import type { FastifyInstance } from 'fastify'
import {
  AgentServiceError,
  deleteNotificationInAgentService,
  fetchNotificationsFromAgentService,
  markAllNotificationsReadInAgentService,
  markNotificationReadInAgentService,
} from '../services/agentServiceClient'

export default async function notificationsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { unreadOnly?: string; limit?: string } }>('/notifications', async (req, reply) => {
    const unreadOnly = req.query.unreadOnly == null ? true : req.query.unreadOnly !== 'false'
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    try {
      const notifications = await fetchNotificationsFromAgentService(
        req.userId,
        unreadOnly,
        Number.isFinite(limit) ? limit : undefined,
      )
      return reply.send({ notifications })
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'list notifications')
    }
  })

  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (req, reply) => {
    try {
      await markNotificationReadInAgentService(req.userId, req.params.id)
      return reply.status(204).send()
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'mark notification read')
    }
  })

  app.post('/notifications/read-all', async (req, reply) => {
    try {
      await markAllNotificationsReadInAgentService(req.userId)
      return reply.status(204).send()
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'mark all notifications read')
    }
  })

  app.delete<{ Params: { id: string } }>('/notifications/:id', async (req, reply) => {
    try {
      await deleteNotificationInAgentService(req.userId, req.params.id)
      return reply.status(204).send()
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'delete notification')
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
    return reply.status(404).send({ error: 'notification not found' })
  }
  req.log.error({ err, op }, 'notifications operation failed')
  const message = err instanceof Error ? err.message : String(err)
  return reply.status(502).send({ error: message })
}
