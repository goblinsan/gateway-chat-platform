import type { FastifyInstance } from 'fastify'
import type { AgentChatRequest, AgentChatResponse, AgentStreamDoneEvent, RoutingExplanation } from '@gateway/shared'
import type { ProviderMessage } from '@gateway/shared'
import { getAgent } from '../agents/registry'
import { getProviderRegistry } from '../config/providerRegistry'
import { getPrismaClient } from '../services/db'
import { upsertConversation, persistUsageLog } from '../services/persistence'
import { estimateCostUsd } from '../services/costEstimator'
import { resolveProviderChain, estimatePromptTokens } from '../routing'
import { getBuiltInTools, dispatchTool } from '../tools/registry'

const bodySchema = {
  type: 'object',
  required: ['agentId', 'messages'],
  properties: {
    agentId: { type: 'string', minLength: 1, maxLength: 64 },
    threadId: { type: 'string', maxLength: 64 },
    messages: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string', minLength: 1, maxLength: 32768 },
        },
      },
    },
  },
} as const

/**
 * POST /api/chat — agent-aware chat endpoint.
 */
export default async function chatRoutes(app: FastifyInstance) {
  app.post<{ Body: AgentChatRequest & { threadId?: string } }>(
    '/chat',
    {
      schema: { body: bodySchema },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { agentId, messages, threadId } = req.body

      const agent = getAgent(agentId)
      if (!agent) {
        return reply.status(404).send({ error: `Agent '${agentId}' not found` })
      }

      const registry = getProviderRegistry()

      // Build provider messages: inject system prompt first, then conversation
      let systemPrompt = agent.systemPrompt ?? ''
      if (agent.featureFlags?.tools === true) {
        const tools = getBuiltInTools()
        const currentTime = dispatchTool('get_current_time', {})
        const toolBlock = tools.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
        systemPrompt += `\n\n## Available Tools\n${toolBlock}\n\nCurrent time: ${currentTime}`
      }
      const providerMessages: ProviderMessage[] = []
      if (systemPrompt) {
        providerMessages.push({ role: 'system', content: systemPrompt })
      }
      providerMessages.push(...messages)

      // Resolve provider chain via routing engine (Issue #47, #48, #49, #50)
      const policy = agent.routingPolicy ?? { preferredProvider: agent.providerName }
      const promptTokenCount = estimatePromptTokens(providerMessages)
      const availableProviders = registry.getAll().map(a => a.name)
      const decision = resolveProviderChain(policy, promptTokenCount, availableProviders)

      const routingExplanation: RoutingExplanation = {
        selectedProvider: decision.selectedProvider,
        reason: decision.reason,
        orderedChain: decision.orderedChain,
        policyMatches: decision.policyMatches,
      }

      // Log the routing decision for diagnostics and tuning (Issue #51)
      req.log.info(
        {
          agentId,
          selectedProvider: decision.selectedProvider,
          orderedChain: decision.orderedChain,
          reason: decision.reason,
          policyMatches: decision.policyMatches,
          rejectedCandidates: decision.rejectedCandidates,
          usedFallback: decision.usedFallback,
          fallbackReason: decision.fallbackReason,
        },
        'Routing decision',
      )

      const startTime = Date.now()
      const result = await registry.sendChatWithChain(decision.orderedChain, {
        model: agent.model,
        messages: providerMessages,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        modelParams: agent.endpointConfig?.modelParams,
      })
      const latencyMs = Date.now() - startTime

      const response: AgentChatResponse = {
        agentId,
        usedProvider: result.usedProvider,
        model: result.response.model,
        message: {
          role: 'assistant',
          content: result.response.message.content,
        },
        latencyMs,
        ...(result.response.usage ? { usage: result.response.usage } : {}),
        routingExplanation,
      }

      // Persist usage data asynchronously
      if (threadId) {
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
            await upsertConversation(prisma, {
              id: threadId,
              agentId,
              title: messages[0]?.content.slice(0, 60) ?? 'Conversation',
            })
            await persistUsageLog(prisma, {
              conversationId: threadId,
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
            req.log.warn({ err }, 'Failed to persist conversation data')
          }
        })()
      }

      return reply.send(response)
    },
  )

  /**
   * POST /api/chat/stream — SSE streaming endpoint.
   */
  app.post<{ Body: AgentChatRequest & { threadId?: string } }>(
    '/chat/stream',
    {
      schema: { body: bodySchema },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { agentId, messages, threadId } = req.body

      const agent = getAgent(agentId)
      if (!agent) {
        void reply.status(404).send({ error: `Agent '${agentId}' not found` })
        return
      }

      const registry = getProviderRegistry()

      let systemPrompt = agent.systemPrompt ?? ''
      if (agent.featureFlags?.tools === true) {
        const tools = getBuiltInTools()
        const currentTime = dispatchTool('get_current_time', {})
        const toolBlock = tools.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
        systemPrompt += `\n\n## Available Tools\n${toolBlock}\n\nCurrent time: ${currentTime}`
      }
      const providerMessages: ProviderMessage[] = []
      if (systemPrompt) {
        providerMessages.push({ role: 'system', content: systemPrompt })
      }
      providerMessages.push(...messages)

      // Resolve provider chain via routing engine (Issue #47, #48, #49, #50)
      const policy = agent.routingPolicy ?? { preferredProvider: agent.providerName }
      const promptTokenCount = estimatePromptTokens(providerMessages)
      const availableProviders = registry.getAll().map(a => a.name)
      const decision = resolveProviderChain(policy, promptTokenCount, availableProviders)

      const routingExplanation: RoutingExplanation = {
        selectedProvider: decision.selectedProvider,
        reason: decision.reason,
        orderedChain: decision.orderedChain,
        policyMatches: decision.policyMatches,
      }

      // Log the routing decision for diagnostics and tuning (Issue #51)
      req.log.info(
        {
          agentId,
          selectedProvider: decision.selectedProvider,
          orderedChain: decision.orderedChain,
          reason: decision.reason,
          policyMatches: decision.policyMatches,
          rejectedCandidates: decision.rejectedCandidates,
          usedFallback: decision.usedFallback,
          fallbackReason: decision.fallbackReason,
        },
        'Routing decision',
      )

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const startTime = Date.now()
      let usageData: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

      const writeEvent = (payload: object): boolean => {
        if (reply.raw.destroyed) return false
        return reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
      }

      try {
        const usedProvider = await registry.streamChatWithChain(
          decision.orderedChain,
          {
            model: agent.model,
            messages: providerMessages,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            modelParams: agent.endpointConfig?.modelParams,
          },
          (event) => {
            if (event.type === 'token' && event.token !== undefined) {
              writeEvent({ type: 'token', token: event.token })
            } else if (event.type === 'done' && event.usage) {
              usageData = event.usage
            } else if (event.type === 'error') {
              writeEvent({ type: 'error', error: event.error ?? 'Unknown error' })
            }
          },
        )

        const latencyMs = Date.now() - startTime
        const donePayload: AgentStreamDoneEvent = {
          type: 'done',
          agentId,
          model: agent.model,
          usedProvider,
          latencyMs,
          ...(usageData ? { usage: usageData } : {}),
          routingExplanation,
        }
        writeEvent(donePayload)

        // Persist usage data asynchronously
        if (threadId) {
          const prisma = getPrismaClient()
          const estimatedCostUsd = usageData
            ? estimateCostUsd(agent.model, usageData.promptTokens, usageData.completionTokens)
            : 0
          void (async () => {
            try {
              await upsertConversation(prisma, {
                id: threadId,
                agentId,
                title: messages[0]?.content.slice(0, 60) ?? 'Conversation',
              })
              await persistUsageLog(prisma, {
                conversationId: threadId,
                agentId,
                provider: usedProvider,
                model: agent.model,
                promptTokens: usageData?.promptTokens ?? 0,
                completionTokens: usageData?.completionTokens ?? 0,
                totalTokens: usageData?.totalTokens ?? 0,
                estimatedCostUsd,
                latencyMs,
              })
            } catch (err) {
              req.log.warn({ err }, 'Failed to persist stream conversation data')
            }
          })()
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Streaming failed'
        writeEvent({ type: 'error', error })
      } finally {
        reply.raw.end()
      }
    },
  )
}
