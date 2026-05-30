import type { FastifyInstance } from 'fastify'
import type { AgentRunRequest, AgentRunResponse, ProviderMessage } from '@gateway/shared'
import { getEnv } from '../config/env'
import { synthesize } from '../services/ttsClient'
import { publishInboxMessage } from '../services/inbox'
import { sendToAgentService } from '../services/agentServiceClient'

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
      const metadata = context?.metadata && typeof context.metadata === 'object'
        ? context.metadata as Record<string, unknown>
        : undefined
      const resolvedThreadId =
        typeof delivery?.threadId === 'string'
          ? delivery.threadId
          : typeof metadata?.threadId === 'string'
            ? metadata.threadId
            : undefined
      const messages: ProviderMessage[] = [{ role: 'user', content: prompt }]
      const startTime = Date.now()

      let response: AgentRunResponse
      try {
        const result = await sendToAgentService({
          agentId,
          model: '',
          messages,
          workflowId: context?.workflowId,
          workflowSource: context?.source,
          deliveryMode: delivery?.mode,
          userId: typeof delivery?.userId === 'string' ? delivery.userId : req.userId,
          channelId: typeof delivery?.channelId === 'string' ? delivery.channelId : undefined,
          threadId: resolvedThreadId,
        })

        if (result.status === 'approval_required' || result.status === 'paused') {
          return reply.status(202).send({
            agentId,
            usedProvider: result.usedProvider,
            model: result.model,
            content: '',
            latencyMs: Date.now() - startTime,
            status: result.status,
            ...(result.orchestrationState ? { orchestrationState: result.orchestrationState } : {}),
          } satisfies AgentRunResponse)
        }

        response = {
          agentId,
          usedProvider: result.usedProvider,
          model: result.model,
          content: result.message.content,
          latencyMs: Date.now() - startTime,
          ...(result.usage ? { usage: result.usage } : {}),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Agent execution failed'
        req.log.error({ err, agentId }, 'agent-service automation run failed')
        return reply.status(502).send({ error: message })
      }

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
          response.tts = {
            enabled: true,
            voice: delivery.voice ?? env.TTS_DEFAULT_VOICE,
            format: delivery.format ?? 'wav',
            contentType: '',
          }
        }
      }

      if (delivery?.mode === 'inbox') {
        const inboxItem = await publishInboxMessage({
          userId: typeof delivery.userId === 'string' ? delivery.userId : req.userId,
          channelId: typeof delivery.channelId === 'string' ? delivery.channelId : undefined,
          agentId,
          content: response.content,
          kind: typeof delivery.kind === 'string' ? delivery.kind : 'coach_prompt',
          threadId: resolvedThreadId,
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

      return reply.send(response)
    },
  )
}
