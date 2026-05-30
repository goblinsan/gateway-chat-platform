import type { FastifyInstance } from 'fastify'
import type { HandoffRequest, HandoffResponse } from '@gateway/shared'

const MAX_HANDOFF_CONTEXT_LENGTH = 200

const bodySchema = {
  type: 'object',
  required: ['fromAgentId', 'toAgentId', 'messages'],
  properties: {
    fromAgentId: { type: 'string', minLength: 1, maxLength: 64 },
    toAgentId: { type: 'string', minLength: 1, maxLength: 64 },
    context: { type: 'string', maxLength: 4096 },
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

export default async function handoffRoutes(app: FastifyInstance) {
  app.post<{ Body: HandoffRequest }>(
    '/chat/handoff',
    {
      schema: { body: bodySchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { fromAgentId, toAgentId, messages, context } = req.body
      const contextSummary = context ?? messages.find((message) => message.role === 'user')?.content ?? 'No context available'
      const handoffNote = `Context from ${fromAgentId}: ${contextSummary.slice(0, MAX_HANDOFF_CONTEXT_LENGTH)}`
      const response: HandoffResponse = {
        toAgentId,
        threadContext: [{ role: 'system', content: handoffNote }, ...messages],
        handoffNote,
      }
      return reply.send(response)
    },
  )
}
