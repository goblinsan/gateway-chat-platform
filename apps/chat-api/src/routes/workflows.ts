import type { FastifyInstance } from 'fastify'
import type { Workflow, WorkflowStep, WorkflowStepResult } from '@gateway/shared'
import { getAgent } from '../agents/registry'
import { getProviderRegistry } from '../config/providerRegistry'
import { resolveProviderChain, estimatePromptTokens } from '../routing'

// In-memory workflow store — resets on server restart (acceptable for this feature)
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
  app.get(
    '/workflows',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      return reply.send({ workflows: Array.from(workflowStore.values()) })
    },
  )

  app.post<{ Body: { name: string; description?: string; steps: WorkflowStep[] } }>(
    '/workflows',
    {
      schema: { body: createBodySchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { name, description = '', steps } = req.body
      const id = crypto.randomUUID()
      const workflow: Workflow = { id, name, description, steps, createdAt: Date.now() }
      workflowStore.set(id, workflow)
      return reply.status(201).send(workflow)
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/workflows/:id',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params
      if (!workflowStore.has(id)) {
        return reply.status(404).send({ error: `Workflow '${id}' not found` })
      }
      workflowStore.delete(id)
      return reply.status(204).send()
    },
  )

  app.post<{ Params: { id: string } }>(
    '/workflows/:id/run',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params
      const workflow = workflowStore.get(id)
      if (!workflow) {
        return reply.status(404).send({ error: `Workflow '${id}' not found` })
      }

      const registry = getProviderRegistry()
      const results: WorkflowStepResult[] = []

      const sortedSteps = [...workflow.steps].sort((a, b) => a.order - b.order)

      for (const step of sortedSteps) {
        const agent = getAgent(step.agentId)
        const start = Date.now()

        if (!agent) {
          results.push({ step, content: `Agent '${step.agentId}' not found`, provider: 'none', latencyMs: 0 })
          continue
        }

        const policy = agent.routingPolicy ?? { preferredProvider: agent.providerName }
        const messages = [{ role: 'user' as const, content: step.prompt }]
        const providerMessages = agent.systemPrompt
          ? [{ role: 'system' as const, content: agent.systemPrompt }, ...messages]
          : messages
        const promptTokenCount = estimatePromptTokens(providerMessages)
        const availableProviders = registry.getAll().map((p) => p.name)
        const decision = resolveProviderChain(policy, promptTokenCount, availableProviders)

        try {
          const result = await registry.sendChatWithChain(decision.orderedChain, {
            model: agent.model,
            messages: providerMessages,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
          })
          results.push({
            step,
            content: result.response.message.content,
            provider: result.usedProvider,
            latencyMs: Date.now() - start,
          })
        } catch (err) {
          results.push({
            step,
            content: err instanceof Error ? err.message : 'Step failed',
            provider: 'none',
            latencyMs: Date.now() - start,
          })
        }
      }

      return reply.send({ results })
    },
  )
}
