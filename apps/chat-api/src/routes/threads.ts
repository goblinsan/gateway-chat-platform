import type { FastifyInstance } from 'fastify'
import {
  AgentServiceError,
  deleteThreadInAgentService,
  fetchThreadFromAgentService,
  fetchThreadsFromAgentService,
  renameThreadInAgentService,
} from '../services/agentServiceClient'

// threadsRoutes exposes per-user thread browsing for the chat web UI and the
// iOS GatewayApp.  All routes resolve the caller from req.userId (populated by
// the userIdentity plugin) and proxy to agent-service's /internal/threads
// endpoints, so threads stay in sync across devices without each client
// maintaining its own copy.
export default async function threadsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>('/threads', async (req, reply) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    try {
      const threads = await fetchThreadsFromAgentService(req.userId, Number.isFinite(limit) ? limit : undefined)
      return reply.send({ threads })
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'list threads')
    }
  })

  app.get<{ Params: { id: string } }>('/threads/:id', async (req, reply) => {
    try {
      const result = await fetchThreadFromAgentService(req.userId, req.params.id)
      return reply.send(result)
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'load thread')
    }
  })

  app.patch<{ Params: { id: string }; Body: { title?: string } }>(
    '/threads/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: { title: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const title = (req.body.title ?? '').trim()
      if (!title) return reply.status(400).send({ error: 'title is required' })
      try {
        await renameThreadInAgentService(req.userId, req.params.id, title)
        return reply.status(204).send()
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'rename thread')
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/threads/:id', async (req, reply) => {
    try {
      await deleteThreadInAgentService(req.userId, req.params.id)
      return reply.status(204).send()
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'delete thread')
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
    return reply.status(404).send({ error: 'thread not found' })
  }
  req.log.error({ err, op }, 'thread operation failed')
  const message = err instanceof Error ? err.message : String(err)
  return reply.status(502).send({ error: message })
}
