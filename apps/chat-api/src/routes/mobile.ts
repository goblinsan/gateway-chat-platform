import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { getPrismaClient } from '../services/db'
import { sendApnsNotification, isApnsConfigured } from '../services/apns'

const ALERT_PAGE_LIMIT = 50

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
  app.post<{ Body: { title?: string; body?: string; apnsToken?: string } }>(
    '/mobile/push/test',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            apnsToken: { type: 'string', minLength: 1, maxLength: 1024 },
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
      const rawToken = req.body.apnsToken

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
      const title = req.body.title ?? 'Gateway Test'
      const bodyText = req.body.body ?? 'This is a test notification from your Gateway server.'

      let pushResult: Awaited<ReturnType<typeof sendApnsNotification>>
      try {
        pushResult = await sendApnsNotification(normalizedToken, {
          title,
          body: bodyText,
          collapseId: `test-${req.userId}`,
          data: { alertId, route: 'alert' },
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

  /**
   * GET /api/mobile/alerts
   *
   * Lists alerts for the authenticated user. Supports optional `status` filter
   * and cursor-based pagination via `before` (ISO timestamp).
   *
   * Query parameters:
   *   - status: "open" | "acknowledged" | "resolved" (default: "open")
   *   - limit: number 1–50 (default: 20)
   *   - before: ISO timestamp for cursor-based pagination
   */
  app.get<{
    Querystring: { status?: string; limit?: string; before?: string }
  }>(
    '/mobile/alerts',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['open', 'acknowledged', 'resolved'] },
            limit: { type: 'string' },
            before: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const status = req.query.status ?? 'open'
      const rawLimit = parseInt(req.query.limit ?? '20', 10)
      const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, ALERT_PAGE_LIMIT)
      const before = req.query.before ? new Date(req.query.before) : undefined

      const alerts = await prisma.alert.findMany({
        where: {
          userId: req.userId,
          status,
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          severity: true,
          source: true,
          sourceNode: true,
          sourceService: true,
          status: true,
          createdAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
        },
      })

      return reply.send({ alerts })
    },
  )

  /**
   * GET /api/mobile/alerts/:id
   *
   * Returns the full detail for a single alert owned by the authenticated user.
   */
  app.get<{ Params: { id: string } }>(
    '/mobile/alerts/:id',
    async (req, reply) => {
      const alert = await prisma.alert.findFirst({
        where: { id: req.params.id, userId: req.userId },
      })

      if (!alert) {
        return reply.status(404).send({ error: 'Alert not found' })
      }

      return reply.send({ alert })
    },
  )

  /**
   * POST /api/mobile/alerts/:id/ack
   *
   * Marks the alert as acknowledged and records the timestamp.
   * No-ops gracefully if the alert is already acknowledged or resolved.
   */
  app.post<{ Params: { id: string } }>(
    '/mobile/alerts/:id/ack',
    async (req, reply) => {
      const existing = await prisma.alert.findFirst({
        where: { id: req.params.id, userId: req.userId },
      })

      if (!existing) {
        return reply.status(404).send({ error: 'Alert not found' })
      }

      if (existing.status !== 'open') {
        return reply.send({ alert: existing })
      }

      const updated = await prisma.alert.update({
        where: { id: req.params.id },
        data: { status: 'acknowledged', acknowledgedAt: new Date() },
      })

      return reply.send({ alert: updated })
    },
  )

  /**
   * POST /api/mobile/alerts/:id/resolve
   *
   * Marks the alert as resolved and records the timestamp.
   * No-ops gracefully if the alert is already resolved.
   */
  app.post<{ Params: { id: string } }>(
    '/mobile/alerts/:id/resolve',
    async (req, reply) => {
      const existing = await prisma.alert.findFirst({
        where: { id: req.params.id, userId: req.userId },
      })

      if (!existing) {
        return reply.status(404).send({ error: 'Alert not found' })
      }

      if (existing.status === 'resolved') {
        return reply.send({ alert: existing })
      }

      const updated = await prisma.alert.update({
        where: { id: req.params.id },
        data: { status: 'resolved', resolvedAt: new Date() },
      })

      return reply.send({ alert: updated })
    },
  )

  // ---------------------------------------------------------------------------
  // Action Approval endpoints
  // ---------------------------------------------------------------------------

  /**
   * GET /api/mobile/actions/pending
   *
   * Lists pending (non-expired) action approvals for the authenticated user,
   * ordered by creation date descending.
   */
  app.get(
    '/mobile/actions/pending',
    async (req, reply) => {
      const now = new Date()
      const approvals = await prisma.actionApproval.findMany({
        where: {
          userId: req.userId,
          status: 'pending',
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      })
      return reply.send({ approvals })
    },
  )

  /**
   * GET /api/mobile/actions/:id
   *
   * Returns the full detail for a single action approval owned by the
   * authenticated user.
   */
  app.get<{ Params: { id: string } }>(
    '/mobile/actions/:id',
    async (req, reply) => {
      const approval = await prisma.actionApproval.findFirst({
        where: { id: req.params.id, userId: req.userId },
      })

      if (!approval) {
        return reply.status(404).send({ error: 'Approval not found' })
      }

      return reply.send({ approval })
    },
  )

  /**
   * POST /api/mobile/actions/:id/approve
   *
   * Approves a pending action. Returns 409 if already decided.
   * Returns 410 if the approval has expired.
   * Audit-logs the decision before persisting.
   */
  app.post<{ Params: { id: string } }>(
    '/mobile/actions/:id/approve',
    async (req, reply) => {
      const existing = await prisma.actionApproval.findFirst({
        where: { id: req.params.id, userId: req.userId },
      })

      if (!existing) {
        return reply.status(404).send({ error: 'Approval not found' })
      }

      if (existing.status !== 'pending') {
        return reply.status(409).send({ error: 'Approval is no longer pending', status: existing.status })
      }

      const now = new Date()
      if (existing.expiresAt && existing.expiresAt <= now) {
        // Mark as expired before returning
        await prisma.actionApproval.update({
          where: { id: existing.id },
          data: { status: 'expired' },
        })
        return reply.status(410).send({ error: 'Approval has expired' })
      }

      req.log.info(
        {
          approvalId: existing.id,
          userId: req.userId,
          actionType: existing.actionType,
          riskLevel: existing.riskLevel,
          decision: 'approved',
        },
        'Action approval decision: approved',
      )

      const updated = await prisma.actionApproval.update({
        where: { id: existing.id },
        data: { status: 'approved', decidedAt: now, decidedBy: req.userId },
      })

      return reply.send({ approval: updated })
    },
  )

  /**
   * POST /api/mobile/actions/:id/deny
   *
   * Denies a pending action. Returns 409 if already decided.
   * Returns 410 if the approval has expired.
   * Audit-logs the decision before persisting.
   */
  app.post<{ Params: { id: string } }>(
    '/mobile/actions/:id/deny',
    async (req, reply) => {
      const existing = await prisma.actionApproval.findFirst({
        where: { id: req.params.id, userId: req.userId },
      })

      if (!existing) {
        return reply.status(404).send({ error: 'Approval not found' })
      }

      if (existing.status !== 'pending') {
        return reply.status(409).send({ error: 'Approval is no longer pending', status: existing.status })
      }

      const now = new Date()
      if (existing.expiresAt && existing.expiresAt <= now) {
        await prisma.actionApproval.update({
          where: { id: existing.id },
          data: { status: 'expired' },
        })
        return reply.status(410).send({ error: 'Approval has expired' })
      }

      req.log.info(
        {
          approvalId: existing.id,
          userId: req.userId,
          actionType: existing.actionType,
          riskLevel: existing.riskLevel,
          decision: 'denied',
        },
        'Action approval decision: denied',
      )

      const updated = await prisma.actionApproval.update({
        where: { id: existing.id },
        data: { status: 'denied', decidedAt: now, decidedBy: req.userId },
      })

      return reply.send({ approval: updated })
    },
  )
}
