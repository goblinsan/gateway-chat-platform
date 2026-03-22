import type { FastifyInstance } from 'fastify'
import { getEnv } from '../config/env'
import { getHealth, listVoices, synthesize } from '../services/ttsClient'

const synthesizeBodySchema = {
  type: 'object',
  required: ['text'],
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 5000 },
    voice: { type: 'string', maxLength: 128 },
    format: { type: 'string', maxLength: 16 },
  },
} as const

export default async function ttsRoutes(app: FastifyInstance) {
  app.get('/tts/health', async (_req, reply) => {
    const result = await getHealth()
    return reply.send(result)
  })

  app.get('/tts/voices', async (_req, reply) => {
    const env = getEnv()
    if (!env.TTS_ENABLED) {
      return reply.status(409).send({ error: 'TTS is not enabled' })
    }

    try {
      const result = await listVoices()
      return reply.send(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list voices'
      _req.log.error({ err }, 'TTS voices request failed')
      return reply.status(502).send({ error: message })
    }
  })

  app.post<{ Body: { text: string; voice?: string; format?: string } }>(
    '/tts',
    { schema: { body: synthesizeBodySchema } },
    async (req, reply) => {
      const env = getEnv()
      if (!env.TTS_ENABLED) {
        return reply.status(409).send({ error: 'TTS is not enabled' })
      }

      const { text, voice, format } = req.body

      try {
        const result = await synthesize({ text, voice, format })
        return reply
          .header('Content-Type', result.contentType)
          .header('Content-Length', result.audioBuffer.length)
          .send(result.audioBuffer)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'TTS synthesis failed'
        req.log.error({ err }, 'TTS synthesis failed')
        return reply.status(502).send({ error: message })
      }
    },
  )
}
