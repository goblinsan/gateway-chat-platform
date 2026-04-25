import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { AgentConfig } from '@gateway/shared'
import type { PrismaClient } from '@prisma/client'
import { getAgent } from '../agents/registry'
import { getPrismaClient } from '../services/db'
import { upsertConversation, persistMessage } from '../services/persistence'
import { syncAgentConversationToNotes } from '../services/notesSync'
import {
  approveAgentServiceApproval,
  denyAgentServiceApproval,
  fetchAgentServiceRun,
} from '../services/agentServiceClient'

const approveBodySchema = {
  type: 'object',
  required: ['runId'],
  properties: {
    runId: { type: 'string', minLength: 1, maxLength: 128 },
    threadId: { type: 'string', maxLength: 128 },
    agentId: { type: 'string', maxLength: 128 },
    userMessage: { type: 'string', maxLength: 32768 },
    assistantMessageId: { type: 'string', maxLength: 128 },
    threadTitle: { type: 'string', maxLength: 256 },
    defaultModel: { type: 'string', maxLength: 256 },
  },
} as const

const denyBodySchema = {
  type: 'object',
  required: ['runId'],
  properties: {
    runId: { type: 'string', minLength: 1, maxLength: 128 },
    reason: { type: 'string', maxLength: 512 },
    threadId: { type: 'string', maxLength: 128 },
    agentId: { type: 'string', maxLength: 128 },
    userMessage: { type: 'string', maxLength: 32768 },
    assistantMessageId: { type: 'string', maxLength: 128 },
    threadTitle: { type: 'string', maxLength: 256 },
    defaultModel: { type: 'string', maxLength: 256 },
  },
} as const

export default async function orchestrationRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string }
    Body: {
      runId: string
      threadId?: string
      agentId?: string
      userMessage?: string
      assistantMessageId?: string
      threadTitle?: string
      defaultModel?: string
    }
  }>(
    '/orchestrations/approvals/:id/approve',
    { schema: { body: approveBodySchema } },
    async (req, reply) => {
      const { id } = req.params
      const { runId } = req.body

      try {
        await approveAgentServiceApproval(id)
        const run = await waitForRunCompletion(runId)
        await persistResolvedRun({
          userId: req.userId,
          run,
          threadId: req.body.threadId,
          agentId: req.body.agentId,
          userMessage: req.body.userMessage,
          assistantMessageId: req.body.assistantMessageId,
          threadTitle: req.body.threadTitle,
          defaultModel: req.body.defaultModel,
        })
        return reply.send({
          approvalId: id,
          runId,
          status: run.Status,
          content: run.Response ?? '',
          model: run.ModelBackend,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to approve orchestration'
        req.log.error({ err, approvalId: id, runId }, 'Approval proxy failed')
        return reply.status(502).send({ error: message })
      }
    },
  )

  app.post<{
    Params: { id: string }
    Body: {
      runId: string
      reason?: string
      threadId?: string
      agentId?: string
      userMessage?: string
      assistantMessageId?: string
      threadTitle?: string
      defaultModel?: string
    }
  }>(
    '/orchestrations/approvals/:id/deny',
    { schema: { body: denyBodySchema } },
    async (req, reply) => {
      const { id } = req.params
      const { runId, reason } = req.body

      try {
        await denyAgentServiceApproval(id, reason)
        const run = await waitForRunCompletion(runId)
        return reply.send({
          approvalId: id,
          runId,
          status: run.Status,
          content: run.Response ?? '',
          model: run.ModelBackend,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to deny orchestration'
        req.log.error({ err, approvalId: id, runId }, 'Deny proxy failed')
        return reply.status(502).send({ error: message })
      }
    },
  )
}

async function waitForRunCompletion(runId: string): Promise<Awaited<ReturnType<typeof fetchAgentServiceRun>>> {
  const timeoutMs = 30_000
  const intervalMs = 500
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const run = await fetchAgentServiceRun(runId)
    if (run.Status === 'completed' || run.Status === 'failed') {
      return run
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out waiting for run ${runId} to complete`)
}

async function persistResolvedRun(input: {
  userId: string
  run: Awaited<ReturnType<typeof fetchAgentServiceRun>>
  threadId?: string
  agentId?: string
  userMessage?: string
  assistantMessageId?: string
  threadTitle?: string
  defaultModel?: string
}): Promise<void> {
  if (input.run.Status !== 'completed' || !input.run.Response || !input.threadId || !input.agentId) {
    return
  }

  const prisma = getPrismaClient()
  await upsertConversation(prisma, {
    id: input.threadId,
    userId: input.userId,
    agentId: input.agentId,
    title: input.threadTitle?.trim() || input.userMessage?.slice(0, 60) || 'Conversation',
    ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
  })

  await persistMessage(prisma, {
    id: input.assistantMessageId?.trim() || randomUUID(),
    conversationId: input.threadId,
    role: 'assistant',
    content: input.run.Response,
    ...(input.run.ModelBackend ? { model: input.run.ModelBackend } : {}),
    provider: 'agent-service',
  })

  const agent = await resolveAgentForPersistence(input.agentId, input.userId, prisma)
  if (agent && input.userMessage?.trim()) {
    await syncAgentConversationToNotes(agent, {
      threadId: input.threadId,
      source: 'chat',
      userMessage: input.userMessage,
      assistantMessage: input.run.Response,
    })
  }
}

async function resolveAgentForPersistence(
  agentId: string,
  userId: string,
  prisma: PrismaClient,
): Promise<AgentConfig | null> {
  const operatorAgent = getAgent(agentId)
  if (operatorAgent) {
    return operatorAgent
  }

  const persona = await prisma.userPersona.findFirst({
    where: { id: agentId, userId, enabled: true },
  })
  if (!persona) {
    return null
  }

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
