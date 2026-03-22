import type { FastifyInstance } from 'fastify'
import type { AgentRunRequest, AgentRunResponse } from '@gateway/shared'
import type { ProviderMessage } from '@gateway/shared'
import { getAgent } from '../agents/registry'
import { getProviderRegistry } from '../config/providerRegistry'
import { getPrismaClient } from '../services/db'
import { persistUsageLog } from '../services/persistence'
import { estimateCostUsd } from '../services/costEstimator'
import { resolveProviderChain, estimatePromptTokens } from '../routing'
import { buildAutomationMessages } from '../services/automationContext'

const runBodySchema = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 32768 },
    context: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', maxLength: 128 },
        source: { type: 'string', maxLength: 128 },
        metadata: { type: 'object' },
      },
    },
    delivery: {
      type: 'object',
      properties: {
        mode: { type: 'string', maxLength: 64 },
        channel: { type: 'string', maxLength: 128 },
        to: { type: 'string', maxLength: 256 },
      },
    },
  },
} as const

/**
 * POST /api/agents/:id/run — non-interactive automation endpoint.
 *
 * Designed for scheduler / control-plane invocation. Runs a single-turn
 * prompt against the specified agent using the same routing and provider
 * pipeline as /api/chat, but without thread persistence requirements.
 */
export default async function agentRunRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: AgentRunRequest }>(
    '/agents/:id/run',
    {
      schema: { body: runBodySchema },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { id: agentId } = req.params
      const { prompt, context, delivery } = req.body

      const agent = getAgent(agentId)
      if (!agent) {
        return reply.status(404).send({ error: `Agent '${agentId}' not found` })
      }

      const registry = getProviderRegistry()

      // Build provider messages via the automation context helper
      const providerMessages: ProviderMessage[] = buildAutomationMessages(agent, prompt, context)

      // Resolve provider chain via routing engine
      const policy = agent.routingPolicy ?? { preferredProvider: agent.providerName }
      const promptTokenCount = estimatePromptTokens(providerMessages)
      const availableProviders = registry.getAll().map((a) => a.name)
      const decision = resolveProviderChain(policy, promptTokenCount, availableProviders)

      // Log routing decision and delivery metadata
      req.log.info(
        {
          agentId,
          selectedProvider: decision.selectedProvider,
          orderedChain: decision.orderedChain,
          reason: decision.reason,
          ...(context?.workflowId ? { workflowId: context.workflowId } : {}),
          ...(context?.source ? { source: context.source } : {}),
          ...(delivery ? { delivery } : {}),
        },
        'Automation run: routing decision',
      )

      const startTime = Date.now()

      let result
      try {
        result = await registry.sendChatWithChain(decision.orderedChain, {
          model: agent.model,
          messages: providerMessages,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Agent execution failed'
        req.log.error({ err, agentId }, 'Automation run failed')
        return reply.status(502).send({ error: message })
      }

      const latencyMs = Date.now() - startTime

      const response: AgentRunResponse = {
        agentId,
        usedProvider: result.usedProvider,
        model: result.response.model ?? agent.model,
        content: result.response.message.content,
        latencyMs,
        ...(result.response.usage ? { usage: result.response.usage } : {}),
      }

      // Persist usage log asynchronously
      const prisma = getPrismaClient()
      const estimatedCostUsd = result.response.usage
        ? estimateCostUsd(
            result.response.model ?? agent.model,
            result.response.usage.promptTokens,
            result.response.usage.completionTokens,
          )
        : 0
      void (async () => {
        try {
          await persistUsageLog(prisma, {
            agentId,
            provider: result.usedProvider,
            model: result.response.model ?? agent.model,
            promptTokens: result.response.usage?.promptTokens ?? 0,
            completionTokens: result.response.usage?.completionTokens ?? 0,
            totalTokens: result.response.usage?.totalTokens ?? 0,
            estimatedCostUsd,
            latencyMs,
          })
        } catch (err) {
          req.log.warn({ err }, 'Failed to persist automation usage log')
        }
      })()

      return reply.send(response)
    },
  )
}
