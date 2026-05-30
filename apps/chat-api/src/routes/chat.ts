import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { AgentChatRequest, AgentChatResponse, AgentStreamDoneEvent, RoutingExplanation } from '@gateway/shared'
import { sendToAgentService, streamFromAgentService } from '../services/agentServiceClient'

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

function serviceRoutingExplanation(): RoutingExplanation {
  return {
    selectedProvider: 'agent-service',
    reason: 'agent-service is the source of truth for chat routing',
    orderedChain: ['agent-service'],
    policyMatches: [],
  }
}

export default async function chatRoutes(app: FastifyInstance) {
  app.post<{ Body: AgentChatRequest & { threadId?: string } }>(
    '/chat',
    {
      schema: { body: bodySchema },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { agentId, messages, threadId, modelOverride } = req.body
      const effectiveThreadId = threadId?.trim() || randomUUID()
      const startTime = Date.now()

      try {
        const result = await sendToAgentService({
          agentId,
          model: modelOverride ?? '',
          messages,
          userId: req.userId,
          threadId: effectiveThreadId,
        })
        const response: AgentChatResponse = {
          agentId,
          usedProvider: result.usedProvider,
          model: result.model,
          threadId: effectiveThreadId,
          message: result.message,
          latencyMs: Date.now() - startTime,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(typeof result.completionTokensPerSecond === 'number'
            ? { completionTokensPerSecond: result.completionTokensPerSecond }
            : {}),
          routingExplanation: serviceRoutingExplanation(),
        }
        return reply.send(response)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat execution failed'
        req.log.error({ err, agentId }, 'agent-service chat failed')
        return reply.status(502).send({ error: message })
      }
    },
  )

  app.post<{ Body: AgentChatRequest & { threadId?: string } }>(
    '/chat/stream',
    {
      schema: { body: bodySchema },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { agentId, messages, threadId, modelOverride } = req.body
      const effectiveThreadId = threadId?.trim() || randomUUID()
      const startTime = Date.now()

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const writeEvent = (payload: object): boolean => {
        if (reply.raw.destroyed) return false
        return reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
      }

      try {
        let streamedModel = modelOverride ?? ''
        let status: AgentStreamDoneEvent['status']
        let orchestrationState: AgentStreamDoneEvent['orchestrationState']
        const result = await streamFromAgentService({
          agentId,
          model: modelOverride ?? '',
          messages,
          userId: req.userId,
          threadId: effectiveThreadId,
        }, (event) => {
          if (event.type === 'token') {
            writeEvent({ type: 'token', token: event.token })
            return
          }
          if (event.type === 'reasoning') {
            writeEvent({ type: 'reasoning', text: event.text })
            return
          }
          if (event.type === 'status') {
            writeEvent({ type: 'status', message: event.message })
            return
          }
          streamedModel = event.model
          status = event.status
          orchestrationState = event.orchestrationState
        })

        const donePayload: AgentStreamDoneEvent = {
          type: 'done',
          agentId,
          model: result.model || streamedModel,
          usedProvider: result.usedProvider,
          threadId: effectiveThreadId,
          latencyMs: Date.now() - startTime,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(typeof result.completionTokensPerSecond === 'number'
            ? { completionTokensPerSecond: result.completionTokensPerSecond }
            : {}),
          routingExplanation: serviceRoutingExplanation(),
          ...(result.status ?? status ? { status: result.status ?? status } : {}),
          ...(result.orchestrationState ?? orchestrationState
            ? { orchestrationState: result.orchestrationState ?? orchestrationState }
            : {}),
        }
        writeEvent(donePayload)
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Streaming failed'
        req.log.error({ err, agentId }, 'agent-service stream failed')
        writeEvent({ type: 'error', error })
      } finally {
        reply.raw.end()
      }
    },
  )
}
