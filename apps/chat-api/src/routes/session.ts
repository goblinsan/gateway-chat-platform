import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { getPrismaClient } from '../services/db'

const APNS_TOKEN_PATTERN = /^[A-Fa-f0-9]{32,512}$/
const IOS_PLATFORM = 'ios'

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

export default async function sessionRoutes(app: FastifyInstance) {
  const prisma = getPrismaClient()

  app.get('/session/me', async (req, reply) => {
    return reply.send({ userId: req.userId })
  })

  app.post<{ Body: { apnsToken: string; deviceName?: string } }>('/session/mobile-devices/apns', {
    schema: {
      body: {
        type: 'object',
        required: ['apnsToken'],
        properties: {
          apnsToken: { type: 'string', minLength: 1, maxLength: 1024 },
          deviceName: { type: 'string', minLength: 1, maxLength: 128 },
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
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      },
      update: {
        tokenLast4,
        deviceName: deviceName || null,
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
      updatedAt: device.updatedAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
    })
  })
}
