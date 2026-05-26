import type { FastifyInstance } from 'fastify'
import {
  AgentServiceError,
  createScheduleInAgentService,
  deleteScheduleInAgentService,
  listSchedulesFromAgentService,
} from '../services/agentServiceClient'

export default async function schedulesRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      kind?: string
      prompt?: string
      run_at?: string
      recurrence?: string
      thread_id?: string
      agent_id?: string
      payload?: Record<string, unknown>
    }
  }>('/schedules', async (req, reply) => {
    const prompt = (req.body.prompt ?? '').trim()
    const runAt = (req.body.run_at ?? '').trim()
    if (!prompt) return reply.status(400).send({ error: 'prompt is required' })
    if (!runAt) return reply.status(400).send({ error: 'run_at is required' })

    try {
      const schedule = await createScheduleInAgentService(req.userId, {
        kind: req.body.kind,
        prompt,
        run_at: runAt,
        recurrence: req.body.recurrence,
        thread_id: req.body.thread_id,
        agent_id: req.body.agent_id,
        payload: req.body.payload,
      })
      return reply.status(201).send(schedule)
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'create schedule')
    }
  })

  app.get<{ Querystring: { limit?: string } }>('/schedules', async (req, reply) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    try {
      const schedules = await listSchedulesFromAgentService(
        req.userId,
        Number.isFinite(limit) ? limit : undefined,
      )
      return reply.send({ schedules })
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'list schedules')
    }
  })

  app.delete<{ Params: { id: string } }>('/schedules/:id', async (req, reply) => {
    try {
      await deleteScheduleInAgentService(req.userId, req.params.id)
      return reply.status(204).send()
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'delete schedule')
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
    return reply.status(404).send({ error: 'schedule not found' })
  }
  req.log.error({ err, op }, 'schedule operation failed')
  const message = err instanceof Error ? err.message : String(err)
  return reply.status(502).send({ error: message })
}
