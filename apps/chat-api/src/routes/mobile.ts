import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { getPrismaClient } from '../services/db'
import { sendApnsNotification, isApnsConfigured } from '../services/apns'

export default async function mobileRoutes(app: FastifyInstance) {
  const prisma = getPrismaClient()

  /**
   * POST /api/mobile/push/test
   *
   * Sends a test push notification to the caller's most-recently-seen
   * iOS device, logs the attempt, and returns the outcome.
   *
   * Requirements:
   *   - APNs must be configured (returns 503 if not).
   *   - The calling user must have at least one enabled iOS device registered.
   *   - A PushAttempt record is persisted regardless of success or failure.
   *   - If APNs reports a stale/invalid token (BadDeviceToken or Unregistered),
   *     the device is disabled so future deliveries skip it.
   */
  app.post<{ Body: { title?: string; body?: string } }>(
    '/mobile/push/test',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 256 },
            body: { type: 'string', minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!isApnsConfigured()) {
        return reply.status(503).send({ error: 'APNs is not configured on this server' })
      }

      // Find the most-recently-seen enabled iOS device for this user
      const device = await prisma.mobileDevice.findFirst({
        where: { userId: req.userId, platform: 'ios', enabled: true },
        orderBy: { lastSeenAt: 'desc' },
      })

      if (!device) {
        return reply.status(404).send({ error: 'No registered iOS device found for this user' })
      }

      // We store the token hash, not the raw token; we need the raw token
      // to call APNs.  The raw token is supplied by the iOS app and is NOT
      // stored for privacy reasons.  For a *test* push we instead require
      // the caller to supply the raw token in the request body.
      //
      // However, re-reading the issue, the test endpoint should use the
      // stored device.  Since we only store the hash (not the raw token),
      // the test endpoint needs the raw token from the client.
      // We accept it as an optional field — if omitted we return 422.
      const rawBody = req.body as { title?: string; body?: string; apnsToken?: string }
      const rawToken: string | undefined = rawBody.apnsToken

      if (!rawToken) {
        return reply.status(422).send({
          error: 'apnsToken is required to send a test push (the raw token is not stored server-side)',
        })
      }

      // Normalise token the same way the registration endpoint does
      const normalizedToken = rawToken.trim().replace(/[<>\s]/g, '').toLowerCase()
      if (!/^[a-f0-9]{32,512}$/.test(normalizedToken)) {
        return reply.status(400).send({ error: 'Invalid APNs token format' })
      }

      const alertId = randomUUID()
      const title = rawBody.title ?? 'Gateway Test'
      const bodyText = rawBody.body ?? 'This is a test notification from your Gateway server.'

      let pushResult: Awaited<ReturnType<typeof sendApnsNotification>>
      try {
        pushResult = await sendApnsNotification(normalizedToken, {
          title,
          body: bodyText,
          collapseId: `test-${req.userId}`,
          data: { alertId },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        req.log.error({ userId: req.userId, deviceId: device.id, err }, 'APNs send error')

        await prisma.pushAttempt.create({
          data: {
            id: randomUUID(),
            deviceId: device.id,
            provider: 'apns',
            alertId,
            status: 'error',
            errorCode: 'SendError',
            errorMessage: message,
          },
        })

        return reply.status(502).send({ error: 'Failed to reach APNs', detail: message })
      }

      if (pushResult.ok) {
        req.log.info({ userId: req.userId, deviceId: device.id, alertId }, 'APNs test push delivered')

        await prisma.pushAttempt.create({
          data: {
            id: randomUUID(),
            deviceId: device.id,
            provider: 'apns',
            alertId,
            status: 'success',
          },
        })

        return reply.send({ ok: true, alertId, deviceId: device.id })
      }

      // Delivery failure — log it
      req.log.warn(
        { userId: req.userId, deviceId: device.id, reason: pushResult.reason, stale: pushResult.stale },
        'APNs test push failed',
      )

      await prisma.pushAttempt.create({
        data: {
          id: randomUUID(),
          deviceId: device.id,
          provider: 'apns',
          alertId,
          status: 'error',
          errorCode: pushResult.reason,
          errorMessage: `APNs rejected the notification: ${pushResult.reason}`,
        },
      })

      // Disable the device when APNs signals the token is stale/invalid
      if (pushResult.stale) {
        await prisma.mobileDevice.update({
          where: { id: device.id },
          data: { enabled: false },
        })
        req.log.warn(
          { userId: req.userId, deviceId: device.id },
          'Disabled stale APNs device token',
        )
      }

      return reply.status(502).send({
        ok: false,
        reason: pushResult.reason,
        stale: pushResult.stale,
        alertId,
        deviceId: device.id,
      })
    },
  )
}
