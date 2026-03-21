import type { FastifyInstance } from 'fastify'
import type { CompareRequest, CompareResponse, CompareResult } from '@gateway/shared'
import { getProviderRegistry } from '../config/providerRegistry'

const bodySchema = {
  type: 'object',
  required: ['messages'],
  properties: {
    messages: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string', minLength: 1, maxLength: 32768 },
        },
      },
    },
    providerIds: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const

export default async function compareRoutes(app: FastifyInstance) {
  app.post<{ Body: CompareRequest }>(
    '/chat/compare',
    {
      schema: { body: bodySchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { messages, providerIds } = req.body
      const registry = getProviderRegistry()
      const allProviders = registry.getAll().map((p) => p.name)
      const targetProviders = providerIds?.length ? providerIds.filter((id) => allProviders.includes(id)) : allProviders

      if (targetProviders.length === 0) {
        return reply.status(400).send({ error: 'No matching providers found' })
      }

      const results = await Promise.all(
        targetProviders.map(async (providerName): Promise<CompareResult> => {
          const start = Date.now()
          try {
            const result = await registry.sendChatWithChain([providerName], {
              model: 'auto',
              messages,
            })
            return {
              provider: providerName,
              model: result.response.model ?? 'unknown',
              content: result.response.message.content,
              latencyMs: Date.now() - start,
            }
          } catch (err) {
            return {
              provider: providerName,
              model: 'unknown',
              content: '',
              latencyMs: Date.now() - start,
              error: err instanceof Error ? err.message : 'Unknown error',
            }
          }
        }),
      )

      const response: CompareResponse = { results }
      return reply.send(response)
    },
  )
}
