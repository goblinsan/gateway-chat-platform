import type { FastifyInstance } from 'fastify'
import type { AgentChatRequest, AgentChatResponse } from '@gateway/shared'
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

      const result = await registry.sendChatWithFallback(agent.providerName, {
        model: agent.model,
        messages: providerMessages,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      })

      const response: AgentChatResponse = {
        agentId,
        usedProvider: result.usedProvider,
        message: {
          role: 'assistant',
          content: result.response.message.content,
        },
      }

      return reply.send(response)
    },
  )
}
