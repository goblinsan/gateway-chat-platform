import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { registerDeviceTokenInAgentService } from '../services/agentServiceClient'

const APNS_TOKEN_PATTERN = /^[A-Fa-f0-9]{32,512}$/
const IOS_PLATFORM = 'ios'

function normalizeApnsToken(token: string): string {
  return token.trim().replace(/[<>\s]/g, '').toLowerCase()
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export default async function sessionRoutes(app: FastifyInstance) {
  app.get('/session/me', async (req, reply) => {
    return reply.send({ id: req.userId, userId: req.userId })
  })

  app.post<{
    Body: {
      apnsToken: string
      deviceName?: string
      notificationMinSeverity?: string
      appVersion?: string
    }
  }>('/session/mobile-devices/apns', {
    schema: {
      body: {
        type: 'object',
        required: ['apnsToken'],
        properties: {
          apnsToken: { type: 'string', minLength: 1, maxLength: 1024 },
          deviceName: { type: 'string', minLength: 1, maxLength: 128 },
          notificationMinSeverity: { type: 'string', minLength: 1, maxLength: 32 },
          appVersion: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
    },
  }, async (req, reply) => {
    const normalizedToken = normalizeApnsToken(req.body.apnsToken)
    if (!APNS_TOKEN_PATTERN.test(normalizedToken)) {
      return reply.status(400).send({ error: 'Invalid APNs token format' })
    }

    try {
      await registerDeviceTokenInAgentService(req.userId, {
        platform: IOS_PLATFORM,
        token: normalizedToken,
        app_version: req.body.appVersion?.trim() || undefined,
      })
    } catch (err) {
      req.log.error({ err, userId: req.userId }, 'Failed to register APNs device token with agent-service')
      return reply.status(502).send({ error: 'Failed to register push token with agent-service' })
    }

    const tokenHash = hashToken(normalizedToken)
    return reply.send({
      id: tokenHash,
      platform: IOS_PLATFORM,
      deviceName: req.body.deviceName?.trim() || undefined,
      tokenLast4: normalizedToken.slice(-4),
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    })
  })
}
