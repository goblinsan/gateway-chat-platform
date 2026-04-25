import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { AgentConfig, AgentChatRequest, AgentChatResponse, AgentStreamDoneEvent, RoutingExplanation } from '@gateway/shared'
import type { ProviderMessage } from '@gateway/shared'
import type { PrismaClient } from '@prisma/client'
import { getAgent } from '../agents/registry'
import { getProviderRegistry } from '../config/providerRegistry'
import { getPrismaClient } from '../services/db'
import { upsertConversation, persistMessage, persistUsageLog } from '../services/persistence'
import { estimateCostUsd } from '../services/costEstimator'
import { checkQuota } from '../services/quotaService'
import { resolveProviderChain, estimatePromptTokens } from '../routing'
import { getBuiltInTools, dispatchTool } from '../tools/registry'
import { syncAgentConversationToNotes } from '../services/notesSync'
import { sendToAgentService } from '../services/agentServiceClient'

/**
 * Resolve an agent config for chat.
 * First checks the operator agent registry; if not found, looks up a user persona
 * belonging to the requesting user. This allows persona IDs to be used as agentIds.
 */
async function resolveAgent(agentId: string, userId: string, prisma: PrismaClient): Promise<AgentConfig | undefined> {
  const operatorAgent = getAgent(agentId)
  if (operatorAgent) return operatorAgent

  const persona = await prisma.userPersona.findFirst({
    where: { id: agentId, userId, enabled: true },
  })
  if (!persona) return undefined

  return {
    id: persona.id,
    name: persona.name,
    icon: persona.icon,
    color: persona.color,
    providerName: persona.providerName,
    model: persona.model,
    costClass: 'free',
    systemPrompt: persona.systemPrompt ?? undefined,
    temperature: persona.temperature ?? undefined,
    maxTokens: persona.maxTokens ?? undefined,
    enableReasoning: persona.enableReasoning || undefined,
    enabled: persona.enabled,
    source: 'database',
  }
}

async function isKnownModelOverride(
  registry: ReturnType<typeof getProviderRegistry>,
  modelOverride: string,
): Promise<boolean> {
  const results = await Promise.allSettled(
    registry.getAll().map(async (adapter) => {
      if (typeof adapter.listModels !== 'function') {
        return false
      }
      const models = await adapter.listModels()
      return models.some((model) => model.id === modelOverride || model.name === modelOverride)
    }),
  )

  return results.some((result) => result.status === 'fulfilled' && result.value)
}

const bodySchema = {
  type: 'object',
  required: ['agentId', 'messages'],
  properties: {
    agentId: { type: 'string', minLength: 1, maxLength: 64 },
    threadId: { type: 'string', maxLength: 64 },
    modelOverride: { type: 'string', minLength: 1, maxLength: 256 },
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
      const { agentId, messages, threadId, modelOverride } = req.body

      const prisma = getPrismaClient()
      const agent = await resolveAgent(agentId, req.userId, prisma)
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

      // Use per-message modelOverride if provided, otherwise fall back to agent model (Issue #94).
      // For orchestrated agents, model validation is delegated to the internal
      // agent-service because the gateway's direct provider registry is not the
      // source of truth for orchestrated backend availability.
      if (modelOverride && agent.executionMode !== 'orchestrated' && !(await isKnownModelOverride(registry, modelOverride))) {
        return reply.status(400).send({
          error: `Unknown model override '${modelOverride}'`,
        })
      }
      const resolvedModel = modelOverride ?? agent.model

      // Enforce per-model quota before calling the provider (Issue #98)
      const quotaStatus = await checkQuota(prisma, req.userId, resolvedModel)
      if (quotaStatus?.exceeded) {
        return reply.status(429).send({
          error: 'Quota exceeded',
          message: `Your usage quota for model '${resolvedModel}' has been reached for the current ${quotaStatus.windowHours}-hour window.`,
          quota: {
            model: quotaStatus.model,
            windowHours: quotaStatus.windowHours,
            usedTokens: quotaStatus.usedTokens,
            maxTokens: quotaStatus.maxTokens,
            usedRequests: quotaStatus.usedRequests,
            maxRequests: quotaStatus.maxRequests,
            usedCostUsd: quotaStatus.usedCostUsd,
            maxCostUsd: quotaStatus.maxCostUsd,
          },
        })
      }

      const startTime = Date.now()

      // Route based on the agent's execution mode (Issue #106, #107, #108).
      // Agents with executionMode='orchestrated' are forwarded to the internal
      // agent-service. All others use the direct provider-registry path.
      let usedProvider: string
      let responseMessage: { role: 'assistant'; content: string }
      let responseModel: string | undefined
      let responseUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

      try {
        if (agent.executionMode === 'orchestrated') {
          const agentServiceResult = await sendToAgentService({
            agentId,
            model: resolvedModel,
            messages: providerMessages,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            modelParams: agent.endpointConfig?.modelParams,
          })
          usedProvider = agentServiceResult.usedProvider
          responseMessage = agentServiceResult.message
          responseModel = agentServiceResult.model
          responseUsage = agentServiceResult.usage
        } else {
          const result = await registry.sendChatWithChain(decision.orderedChain, {
            model: resolvedModel,
            messages: providerMessages,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            modelParams: agent.endpointConfig?.modelParams,
          })
          usedProvider = result.usedProvider
          responseMessage = { role: 'assistant', content: result.response.message.content }
          responseModel = result.response.model
          responseUsage = result.response.usage
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat execution failed'
        req.log.error({ err, agentId }, 'Chat execution failed')
        return reply.status(502).send({ error: message })
      }

      const latencyMs = Date.now() - startTime

      const response: AgentChatResponse = {
        agentId,
        usedProvider,
        model: responseModel,
        message: responseMessage,
        latencyMs,
        ...(responseUsage ? { usage: responseUsage } : {}),
        routingExplanation,
      }

      // Persist usage data asynchronously
      if (threadId) {
        const effectiveModel = responseModel ?? resolvedModel
        const estimatedCostUsd = responseUsage
          ? estimateCostUsd(
              effectiveModel,
              responseUsage.promptTokens,
              responseUsage.completionTokens,
            )
          : 0
        void (async () => {
          try {
            const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
            await upsertConversation(prisma, {
              id: threadId,
              userId: req.userId,
              agentId,
              title: messages[0]?.content.slice(0, 60) ?? 'Conversation',
              ...(modelOverride ? { defaultModel: modelOverride } : {}),
            })
            if (latestUserMessage) {
              await persistMessage(prisma, {
                id: randomUUID(),
                conversationId: threadId,
                role: 'user',
                content: latestUserMessage.content,
              })
            }
            await persistMessage(prisma, {
              id: randomUUID(),
              conversationId: threadId,
              role: 'assistant',
              content: responseMessage.content,
              model: effectiveModel,
              provider: usedProvider,
            })
            await persistUsageLog(prisma, {
              userId: req.userId,
              conversationId: threadId,
              agentId,
              provider: usedProvider,
              model: effectiveModel,
              promptTokens: responseUsage?.promptTokens ?? 0,
              completionTokens: responseUsage?.completionTokens ?? 0,
              totalTokens: responseUsage?.totalTokens ?? 0,
              estimatedCostUsd,
              latencyMs,
            })
            if (latestUserMessage) {
              await syncAgentConversationToNotes(agent, {
                threadId,
                source: 'chat',
                userMessage: latestUserMessage.content,
                assistantMessage: responseMessage.content,
              })
            }
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
      const { agentId, messages, threadId, modelOverride } = req.body

      const prisma = getPrismaClient()
      const agent = await resolveAgent(agentId, req.userId, prisma)
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

      // Use per-message modelOverride if provided, otherwise fall back to agent model (Issue #94).
      // For orchestrated agents, model validation is delegated to the internal
      // agent-service because the gateway's direct provider registry is not the
      // source of truth for orchestrated backend availability.
      if (modelOverride && agent.executionMode !== 'orchestrated' && !(await isKnownModelOverride(registry, modelOverride))) {
        void reply.status(400).send({
          error: `Unknown model override '${modelOverride}'`,
        })
        return
      }
      const resolvedModel = modelOverride ?? agent.model

      // Enforce per-model quota before opening the stream (Issue #98)
      const quotaStatus = await checkQuota(prisma, req.userId, resolvedModel)
      if (quotaStatus?.exceeded) {
        void reply.status(429).send({
          error: 'Quota exceeded',
          message: `Your usage quota for model '${resolvedModel}' has been reached for the current ${quotaStatus.windowHours}-hour window.`,
          quota: {
            model: quotaStatus.model,
            windowHours: quotaStatus.windowHours,
            usedTokens: quotaStatus.usedTokens,
            maxTokens: quotaStatus.maxTokens,
            usedRequests: quotaStatus.usedRequests,
            maxRequests: quotaStatus.maxRequests,
            usedCostUsd: quotaStatus.usedCostUsd,
            maxCostUsd: quotaStatus.maxCostUsd,
          },
        })
        return
      }

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const startTime = Date.now()
      let usageData: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
      let accumulatedContent = ''
      let streamedModel: string | undefined

      const writeEvent = (payload: object): boolean => {
        if (reply.raw.destroyed) return false
        return reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
      }

      try {
        // Route based on execution mode (Issue #106, #107, #108).
        // For orchestrated agents, call agent-service and translate the response into SSE events.
        // For direct_provider agents, use the existing streaming provider path.
        let usedProvider: string

        if (agent.executionMode === 'orchestrated') {
          const agentServiceResult = await sendToAgentService({
            agentId,
            model: resolvedModel,
            messages: providerMessages,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            modelParams: agent.endpointConfig?.modelParams,
          })
          usedProvider = agentServiceResult.usedProvider
          streamedModel = agentServiceResult.model
          if (agentServiceResult.usage) {
            usageData = agentServiceResult.usage
          }
          // NOTE: The internal agent-service does not yet support token-level streaming.
          // The full response is translated into a single token SSE event so that the
          // UI SSE contract is honoured without exposing orchestrator internals.
          accumulatedContent = agentServiceResult.message.content
          writeEvent({ type: 'token', token: accumulatedContent })
        } else {
          usedProvider = await registry.streamChatWithChain(
            decision.orderedChain,
            {
              model: resolvedModel,
              messages: providerMessages,
              temperature: agent.temperature,
              maxTokens: agent.maxTokens,
              modelParams: agent.endpointConfig?.modelParams,
            },
            (event) => {
              if (event.type === 'token' && event.token !== undefined) {
                accumulatedContent += event.token
                writeEvent({ type: 'token', token: event.token })
              } else if (event.type === 'done' && event.usage) {
                usageData = event.usage
              } else if (event.type === 'error') {
                writeEvent({ type: 'error', error: event.error ?? 'Unknown error' })
              }
            },
          )
        }

        const latencyMs = Date.now() - startTime
        const effectiveModel = streamedModel ?? resolvedModel
        const donePayload: AgentStreamDoneEvent = {
          type: 'done',
          agentId,
          model: effectiveModel,
          usedProvider,
          latencyMs,
          ...(usageData ? { usage: usageData } : {}),
          routingExplanation,
        }
        writeEvent(donePayload)

        // Persist conversation data asynchronously (Issues #111, #112).
        // The gateway remains the owner of thread/message persistence, usage logs,
        // and notes sync regardless of whether execution was delegated to agent-service.
        if (threadId) {
          const estimatedCostUsd = usageData
            ? estimateCostUsd(effectiveModel, usageData.promptTokens, usageData.completionTokens)
            : 0
          void (async () => {
            try {
              const latestUserMessage = [...messages].reverse().find((m) => m.role === 'user')
              await upsertConversation(prisma, {
                id: threadId,
                userId: req.userId,
                agentId,
                title: messages[0]?.content.slice(0, 60) ?? 'Conversation',
                ...(modelOverride ? { defaultModel: modelOverride } : {}),
              })
              // Persist the user turn only when present; the assistant turn is always
              // persisted because the model has already been invoked and usage logged.
              // Notes sync also requires a user message for meaningful output.
              if (latestUserMessage) {
                await persistMessage(prisma, {
                  id: randomUUID(),
                  conversationId: threadId,
                  role: 'user',
                  content: latestUserMessage.content,
                })
              }
              await persistMessage(prisma, {
                id: randomUUID(),
                conversationId: threadId,
                role: 'assistant',
                content: accumulatedContent,
                model: effectiveModel,
                provider: usedProvider,
              })
              await persistUsageLog(prisma, {
                userId: req.userId,
                conversationId: threadId,
                agentId,
                provider: usedProvider,
                model: effectiveModel,
                promptTokens: usageData?.promptTokens ?? 0,
                completionTokens: usageData?.completionTokens ?? 0,
                totalTokens: usageData?.totalTokens ?? 0,
                estimatedCostUsd,
                latencyMs,
              })
              if (latestUserMessage) {
                await syncAgentConversationToNotes(agent, {
                  threadId,
                  source: 'chat',
                  userMessage: latestUserMessage.content,
                  assistantMessage: accumulatedContent,
                })
              }
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
