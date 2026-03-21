import type { FastifyInstance } from 'fastify'
import type { AgentListItem } from '@gateway/shared'
import { listAgents } from '../agents/registry'

/**
 * Returns the list of available agents with their public metadata.
 * systemPrompt is deliberately excluded to keep persona prompts server-side.
 */
export default async function agentRoutes(app: FastifyInstance) {
  app.get('/agents', async (_req, reply) => {
    const agents = listAgents()
    const items: AgentListItem[] = agents.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ systemPrompt: _systemPrompt, ...rest }) => rest,
    )
    return reply.send({ agents: items })
  })
}
