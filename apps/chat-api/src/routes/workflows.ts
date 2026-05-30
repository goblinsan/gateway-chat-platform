import type { FastifyInstance } from 'fastify'
import type { ProviderMessage, Workflow, WorkflowStep, WorkflowStepResult } from '@gateway/shared'
import { sendToAgentService } from '../services/agentServiceClient'

const workflowStore = new Map<string, Workflow>()

const createBodySchema = {
  type: 'object',
  required: ['name', 'steps'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
    description: { type: 'string', maxLength: 512 },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        required: ['order', 'agentId', 'prompt'],
        properties: {
          order: { type: 'number' },
          agentId: { type: 'string', minLength: 1, maxLength: 64 },
          prompt: { type: 'string', minLength: 1, maxLength: 32768 },
          label: { type: 'string', maxLength: 128 },
        },
      },
    },
  },
} as const

export default async function workflowsRoutes(app: FastifyInstance) {
  app.get('/workflows', async (_req, reply) => {
    return reply.send({ workflows: Array.from(workflowStore.values()) })
  })

  app.post<{ Body: { name: string; description?: string; steps: WorkflowStep[] } }>('/workflows', {
    schema: { body: createBodySchema },
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { name, description = '', steps } = req.body
    const workflow: Workflow = { id: crypto.randomUUID(), name, description, steps, createdAt: Date.now() }
    workflowStore.set(workflow.id, workflow)
    return reply.status(201).send(workflow)
  })

  app.delete<{ Params: { id: string } }>('/workflows/:id', async (req, reply) => {
    if (!workflowStore.has(req.params.id)) {
      return reply.status(404).send({ error: `Workflow '${req.params.id}' not found` })
    }
    workflowStore.delete(req.params.id)
    return reply.status(204).send()
  })

  app.post<{ Params: { id: string } }>('/workflows/:id/run', async (req, reply) => {
    const workflow = workflowStore.get(req.params.id)
    if (!workflow) {
      return reply.status(404).send({ error: `Workflow '${req.params.id}' not found` })
    }

    const results: WorkflowStepResult[] = []
    for (const step of [...workflow.steps].sort((a, b) => a.order - b.order)) {
      const start = Date.now()
      const messages: ProviderMessage[] = [{ role: 'user', content: step.prompt }]
      try {
        const result = await sendToAgentService({
          agentId: step.agentId,
          model: '',
          messages,
          userId: req.userId,
        })
        results.push({
          step,
          content: result.message.content,
          provider: result.usedProvider,
          latencyMs: Date.now() - start,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Workflow step failed'
        results.push({ step, content: message, provider: 'agent-service', latencyMs: Date.now() - start })
      }
    }

    return reply.send({ workflowId: workflow.id, results })
  })
}
