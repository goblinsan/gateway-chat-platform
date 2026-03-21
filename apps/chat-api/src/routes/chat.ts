import type { FastifyInstance } from 'fastify'
import type { AgentChatRequest, AgentChatResponse, AgentStreamDoneEvent } from '@gateway/shared'
import type { ProviderMessage } from '@gateway/shared'
import { getAgent } from '../agents/registry'
import { getProviderRegistry } from '../config/providerRegistry'

const bodySchema = {
  type: 'object',
  required: ['agentId', 'messages'],
  properties: {
    agentId: { type: 'string' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string' },
        },
      },
    },
  },
} as const

/**
 * POST /api/chat — agent-aware chat endpoint.
 *
 * Looks up the requested agent, injects its system prompt server-side, and
 * forwards the request to the appropriate provider via the ProviderRegistry.
 * The system prompt is never returned to the client (Issue #24).
 */
export default async function chatRoutes(app: FastifyInstance) {
  app.post<{ Body: AgentChatRequest }>(
    '/chat',
    { schema: { body: bodySchema } },
    async (req, reply) => {
      const { agentId, messages } = req.body

      const agent = getAgent(agentId)
      if (!agent) {
        return reply.status(404).send({ error: `Agent '${agentId}' not found` })
      }

      const registry = getProviderRegistry()

      // Build provider messages: inject system prompt first, then conversation
      const providerMessages: ProviderMessage[] = []
      if (agent.systemPrompt) {
        providerMessages.push({ role: 'system', content: agent.systemPrompt })
      }
      providerMessages.push(...messages)

      const startTime = Date.now()
      const result = await registry.sendChatWithFallback(agent.providerName, {
        model: agent.model,
        messages: providerMessages,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
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
      }

      return reply.send(response)
    },
  )

  /**
   * POST /api/chat/stream — SSE streaming endpoint.
   *
   * Emits token events as `data: {"type":"token","token":"..."}` and a final
   * done event with metadata. Uses reply.hijack() to take full control of the
   * raw HTTP response.
   */
  app.post<{ Body: AgentChatRequest }>(
    '/chat/stream',
    { schema: { body: bodySchema } },
    async (req, reply) => {
      const { agentId, messages } = req.body

      const agent = getAgent(agentId)
      if (!agent) {
        void reply.status(404).send({ error: `Agent '${agentId}' not found` })
        return
      }

      const registry = getProviderRegistry()

      const providerMessages: ProviderMessage[] = []
      if (agent.systemPrompt) {
        providerMessages.push({ role: 'system', content: agent.systemPrompt })
      }
      providerMessages.push(...messages)

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      const startTime = Date.now()
      let usageData: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
      let streamClosed = false
      req.raw.once('close', () => { streamClosed = true })

      const writeEvent = (payload: object): void => {
        if (!streamClosed) {
          reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
        }
      }

      try {
        const usedProvider = await registry.streamChatWithFallback(
          agent.providerName,
          {
            model: agent.model,
            messages: providerMessages,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
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

        const donePayload: AgentStreamDoneEvent = {
          type: 'done',
          agentId,
          model: agent.model,
          usedProvider,
          latencyMs: Date.now() - startTime,
          ...(usageData ? { usage: usageData } : {}),
        }
        writeEvent(donePayload)
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Streaming failed'
        writeEvent({ type: 'error', error })
      } finally {
        reply.raw.end()
      }
    },
  )
}
