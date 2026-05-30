import type { FastifyInstance } from 'fastify'
import type { AgentConfig, AgentListItem } from '@gateway/shared'
import { AgentServiceError, fetchAgentsFromAgentService } from '../services/agentServiceClient'

function toPublicItem(agent: AgentConfig): AgentListItem {
  const ttsVoiceId = typeof agent.endpointConfig?.modelParams?.ttsVoiceId === 'string'
    ? agent.endpointConfig.modelParams.ttsVoiceId
    : agent.ttsVoiceId
  const {
    systemPrompt: _systemPrompt,
    routingPolicy: _routingPolicy,
    endpointConfig: _endpointConfig,
    contextSources: _contextSources,
    ...rest
  } = agent
  return ttsVoiceId ? { ...rest, ttsVoiceId } : rest
}

export default async function agentRoutes(app: FastifyInstance) {
  app.get('/agents', async (req, reply) => {
    try {
      const agents = await fetchAgentsFromAgentService()
      return reply.send({ agents: agents.filter((agent) => agent.enabled !== false).map(toPublicItem) })
    } catch (err) {
      req.log.error({ err }, 'failed to list agents from agent-service')
      const message = err instanceof AgentServiceError || err instanceof Error ? err.message : String(err)
      return reply.status(502).send({ error: message })
    }
  })

  app.all('/agents/manage', async (_req, reply) => {
    return reply.status(410).send({ error: 'Agent management moved to agent-service' })
  })

  app.all('/agents/manage/*', async (_req, reply) => {
    return reply.status(410).send({ error: 'Agent management moved to agent-service' })
  })
}
