import type { FastifyInstance } from 'fastify'
import {
  approveAgentServiceApproval,
  denyAgentServiceApproval,
  fetchAgentServiceRun,
} from '../services/agentServiceClient'

const approveBodySchema = {
  type: 'object',
  required: ['runId'],
  properties: {
    runId: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const

const denyBodySchema = {
  type: 'object',
  required: ['runId'],
  properties: {
    runId: { type: 'string', minLength: 1, maxLength: 128 },
    reason: { type: 'string', maxLength: 512 },
  },
} as const

export default async function orchestrationRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { runId: string } }>(
    '/orchestrations/approvals/:id/approve',
    { schema: { body: approveBodySchema } },
    async (req, reply) => {
      const { id } = req.params
      const { runId } = req.body

      try {
        await approveAgentServiceApproval(id)
        const run = await waitForRunCompletion(runId)
        return reply.send({
          approvalId: id,
          runId,
          status: run.Status,
          content: run.Response ?? '',
          model: run.ModelBackend,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to approve orchestration'
        req.log.error({ err, approvalId: id, runId }, 'Approval proxy failed')
        return reply.status(502).send({ error: message })
      }
    },
  )

  app.post<{ Params: { id: string }; Body: { runId: string; reason?: string } }>(
    '/orchestrations/approvals/:id/deny',
    { schema: { body: denyBodySchema } },
    async (req, reply) => {
      const { id } = req.params
      const { runId, reason } = req.body

      try {
        await denyAgentServiceApproval(id, reason)
        const run = await waitForRunCompletion(runId)
        return reply.send({
          approvalId: id,
          runId,
          status: run.Status,
          content: run.Response ?? '',
          model: run.ModelBackend,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to deny orchestration'
        req.log.error({ err, approvalId: id, runId }, 'Deny proxy failed')
        return reply.status(502).send({ error: message })
      }
    },
  )
}

async function waitForRunCompletion(runId: string): Promise<Awaited<ReturnType<typeof fetchAgentServiceRun>>> {
  const timeoutMs = 30_000
  const intervalMs = 500
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const run = await fetchAgentServiceRun(runId)
    if (run.Status === 'completed' || run.Status === 'failed') {
      return run
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out waiting for run ${runId} to complete`)
}
