import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { AgentRunRequest, AgentRunResponse } from '@gateway/shared'
import type { ProviderMessage } from '@gateway/shared'
import { getAgent } from '../agents/registry'
import { getProviderRegistry } from '../config/providerRegistry'
import { getEnv } from '../config/env'
import { getPrismaClient } from '../services/db'
import { upsertConversation, persistMessage, persistUsageLog } from '../services/persistence'
import { estimateCostUsd } from '../services/costEstimator'
import { resolveProviderChain, estimatePromptTokens } from '../routing'
import { buildAutomationMessages } from '../services/automationContext'
import { synthesize } from '../services/ttsClient'
import { syncAgentConversationToNotes } from '../services/notesSync'
import { publishInboxMessage } from '../services/inbox'

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
        voice: { type: 'string', maxLength: 128 },
        format: { type: 'string', maxLength: 16 },
        userId: { type: 'string', maxLength: 128 },
        channelId: { type: 'string', maxLength: 128 },
        threadId: { type: 'string', maxLength: 128 },
        threadTitle: { type: 'string', maxLength: 256 },
        title: { type: 'string', maxLength: 256 },
        kind: { type: 'string', maxLength: 64 },
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
          modelParams: agent.endpointConfig?.modelParams,
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
      const metadata = context?.metadata && typeof context.metadata === 'object'
        ? context.metadata as Record<string, unknown>
        : undefined

      // If TTS delivery requested, synthesize audio and attach metadata
      if (delivery?.mode === 'tts') {
        const env = getEnv()
        if (!env.TTS_ENABLED) {
          return reply.status(409).send({ error: 'TTS is not enabled' })
        }

        try {
          const voice = delivery.voice ?? env.TTS_DEFAULT_VOICE
          const format = delivery.format ?? 'wav'
          const ttsResult = await synthesize({ text: response.content, voice, format })
          response.tts = {
            enabled: true,
            voice,
            format,
            contentType: ttsResult.contentType,
          }
        } catch (err) {
          req.log.error({ err, agentId }, 'TTS synthesis failed during automation run')
          response.tts = { enabled: true, voice: delivery.voice ?? env.TTS_DEFAULT_VOICE, format: delivery.format ?? 'wav', contentType: '' }
        }
      }

      if (delivery?.mode === 'inbox') {
        const inboxItem = await publishInboxMessage({
          userId: typeof delivery.userId === 'string' ? delivery.userId : undefined,
          channelId: typeof delivery.channelId === 'string' ? delivery.channelId : undefined,
          agentId,
          content: response.content,
          kind: typeof delivery.kind === 'string' ? delivery.kind : 'coach_prompt',
          threadId:
            typeof delivery.threadId === 'string'
              ? delivery.threadId
              : typeof metadata?.threadId === 'string'
                ? metadata.threadId
                : undefined,
          threadTitle:
            typeof delivery.threadTitle === 'string'
              ? delivery.threadTitle
              : typeof metadata?.threadTitle === 'string'
                ? metadata.threadTitle
                : undefined,
          title: typeof delivery.title === 'string' ? delivery.title : undefined,
          metadata: {
            ...(context?.workflowId ? { workflowId: context.workflowId } : {}),
            ...(context?.source ? { source: context.source } : {}),
          },
        })
        response.inbox = {
          messageId: inboxItem.id,
          userId: inboxItem.userId,
          channelId: inboxItem.channelId,
        }
      }

      // Persist usage log asynchronously
      const prisma = getPrismaClient()
      const threadId = typeof metadata?.threadId === 'string' && metadata.threadId.trim()
        ? metadata.threadId.trim()
        : undefined
      const threadTitle = typeof metadata?.threadTitle === 'string' && metadata.threadTitle.trim()
        ? metadata.threadTitle.trim()
        : prompt.slice(0, 60) || 'Automation Conversation'
      const estimatedCostUsd = result.response.usage
        ? estimateCostUsd(
            result.response.model ?? agent.model,
            result.response.usage.promptTokens,
            result.response.usage.completionTokens,
          )
        : 0
      void (async () => {
        try {
          if (threadId) {
            await upsertConversation(prisma, {
              id: threadId,
              userId: req.userId,
              agentId,
              title: threadTitle,
            })
            await persistMessage(prisma, {
              id: randomUUID(),
              conversationId: threadId,
              role: 'user',
              content: prompt,
            })
            await persistMessage(prisma, {
              id: randomUUID(),
              conversationId: threadId,
              role: 'assistant',
              content: response.content,
            })
          }
          await persistUsageLog(prisma, {
            userId: req.userId,
            ...(threadId ? { conversationId: threadId } : {}),
            agentId,
            provider: result.usedProvider,
            model: result.response.model ?? agent.model,
            promptTokens: result.response.usage?.promptTokens ?? 0,
            completionTokens: result.response.usage?.completionTokens ?? 0,
            totalTokens: result.response.usage?.totalTokens ?? 0,
            estimatedCostUsd,
            latencyMs,
          })
          if (threadId) {
            await syncAgentConversationToNotes(agent, {
              threadId,
              source: 'automation',
              userMessage: prompt,
              assistantMessage: response.content,
            })
          }
        } catch (err) {
          req.log.warn({ err }, 'Failed to persist automation usage log')
        }
      })()

      return reply.send(response)
    },
  )
}
