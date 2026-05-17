import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { getPrismaClient } from '../services/db'

const APNS_TOKEN_PATTERN = /^[A-Fa-f0-9]{32,512}$/
const IOS_PLATFORM = 'ios'
const VALID_SEVERITY_LEVELS = new Set(['all', 'medium', 'high', 'critical', 'off'])
const DEFAULT_NOTIFICATION_SEVERITY = 'high'

function normalizeApnsToken(token: string): string {
  return token.trim().replace(/[<>\s]/g, '').toLowerCase()
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function getDeviceName(headerValue: unknown, bodyValue?: string): string {
  const headerDeviceName = typeof headerValue === 'string' ? headerValue.trim() : ''
  const bodyDeviceName = bodyValue?.trim() ?? ''
  return bodyDeviceName || headerDeviceName
}

function normalizeNotificationSeverity(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_NOTIFICATION_SEVERITY
  const trimmed = raw.trim().toLowerCase()
  return VALID_SEVERITY_LEVELS.has(trimmed) ? trimmed : DEFAULT_NOTIFICATION_SEVERITY
}

export default async function sessionRoutes(app: FastifyInstance) {
  const prisma = getPrismaClient()

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

    const tokenHash = hashToken(normalizedToken)
    const tokenLast4 = normalizedToken.slice(-4)
    const now = new Date()
    const deviceName = getDeviceName(req.headers['x-gateway-device-name'], req.body.deviceName)
    const notificationMinSeverity = normalizeNotificationSeverity(req.body.notificationMinSeverity)
    const appVersion = req.body.appVersion?.trim() || null

    // Log app version for debugging/analytics (do not include raw token).
    if (appVersion) {
      req.log.info({ userId: req.userId, platform: IOS_PLATFORM, appVersion }, 'APNs device registration with app version')
    }

    const device = await prisma.mobileDevice.upsert({
      where: {
        userId_platform_tokenHash: {
          userId: req.userId,
          platform: IOS_PLATFORM,
          tokenHash,
        },
      },
      create: {
        id: randomUUID(),
        userId: req.userId,
        platform: IOS_PLATFORM,
        tokenHash,
        tokenLast4,
        deviceName: deviceName || null,
        notificationMinSeverity,
        appVersion,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      },
      update: {
        tokenLast4,
        deviceName: deviceName || null,
        notificationMinSeverity,
        appVersion,
        updatedAt: now,
        lastSeenAt: now,
      },
    })

    req.log.info({ userId: req.userId, mobileDeviceId: device.id }, 'Registered APNs mobile device')
    return reply.send({
      id: device.id,
      platform: device.platform,
      deviceName: device.deviceName ?? undefined,
      tokenLast4: device.tokenLast4,
      notificationMinSeverity: device.notificationMinSeverity,
      updatedAt: device.updatedAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
    })
  })
}
