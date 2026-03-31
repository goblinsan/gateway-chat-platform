import type { FastifyInstance } from 'fastify'
import { acknowledgeInboxMessage, listInboxMessages, publishInboxMessage } from '../services/inbox'

const inboxQuerySchema = {
  type: 'object',
  properties: {
    userId: { type: 'string', maxLength: 128 },
    channelId: { type: 'string', maxLength: 128 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    unreadOnly: { type: 'boolean' },
  },
} as const

const publishBodySchema = {
  type: 'object',
  required: ['agentId', 'content'],
  properties: {
    userId: { type: 'string', maxLength: 128 },
    channelId: { type: 'string', maxLength: 128 },
    agentId: { type: 'string', minLength: 1, maxLength: 64 },
    content: { type: 'string', minLength: 1, maxLength: 32768 },
    kind: { type: 'string', maxLength: 64 },
    threadId: { type: 'string', maxLength: 128 },
    threadTitle: { type: 'string', maxLength: 256 },
    title: { type: 'string', maxLength: 256 },
    metadata: { type: 'object' },
  },
} as const

const ackBodySchema = {
  type: 'object',
  properties: {
    userId: { type: 'string', maxLength: 128 },
    channelId: { type: 'string', maxLength: 128 },
  },
} as const

export default async function inboxRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { userId?: string; channelId?: string; limit?: number; unreadOnly?: boolean }
  }>('/inbox', { schema: { querystring: inboxQuerySchema } }, async (req, reply) => {
    const result = await listInboxMessages(req.query)
    return reply.send({
      userId: result.scope.userId,
      channelId: result.scope.channelId,
      unreadCount: result.unreadCount,
      items: result.items,
    })
  })

  app.post<{
    Body: {
      userId?: string
      channelId?: string
      agentId: string
      content: string
      kind?: string
      threadId?: string
      threadTitle?: string
      title?: string
      metadata?: Record<string, unknown>
    }
  }>('/inbox/messages', { schema: { body: publishBodySchema } }, async (req, reply) => {
    const item = await publishInboxMessage(req.body)
    return reply.status(201).send(item)
  })

  app.post<{
    Params: { id: string }
    Body: { userId?: string; channelId?: string }
  }>('/inbox/:id/ack', { schema: { body: ackBodySchema } }, async (req, reply) => {
    await acknowledgeInboxMessage({
      id: req.params.id,
      userId: req.body?.userId,
      channelId: req.body?.channelId,
    })
    return reply.send({ ok: true })
  })
}
