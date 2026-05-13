import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

// --- env mock ---
vi.mock('../config/env', () => ({
  getEnv: () => ({
    CF_ACCESS_TEAM_DOMAIN: undefined,
    CF_ACCESS_AUD: undefined,
    CHAT_DEFAULT_USER_ID: 'me',
  }),
}))

// --- APNs service mock (required by mobile routes) ---
vi.mock('../services/apns', () => ({
  sendApnsNotification: vi.fn(),
  isApnsConfigured: () => false,
}))

// --- DB mock ---
const mockAlertFindFirst = vi.fn()
const mockAlertFindMany = vi.fn()
const mockAlertUpdate = vi.fn()
const mockAlertCreate = vi.fn()
const mockPublishInboxMessage = vi.fn()

vi.mock('../services/inbox', () => ({
  publishInboxMessage: (...args: unknown[]) => mockPublishInboxMessage(...args),
}))

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({
    mobileDevice: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    pushAttempt: {
      create: vi.fn(),
    },
    alert: {
      findFirst: (...args: unknown[]) => mockAlertFindFirst(...args),
      findMany: (...args: unknown[]) => mockAlertFindMany(...args),
      update: (...args: unknown[]) => mockAlertUpdate(...args),
      create: (...args: unknown[]) => mockAlertCreate(...args),
    },
  }),
}))

import userIdentityPlugin from '../plugins/userIdentity'
import mobileRoutes from '../routes/mobile'

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(userIdentityPlugin)
  await app.register(mobileRoutes, { prefix: '/api' })
  return app
}

const ALERT_ROW = {
  id: 'alert-1',
  userId: 'alice',
  title: 'CPU spike on node-1',
  body: 'CPU usage exceeded 90% for 5 minutes.',
  severity: 'high',
  source: 'homelab',
  sourceNode: 'node-1',
  sourceService: 'prometheus',
  status: 'open',
  relatedThreadId: null,
  relatedActionId: null,
  metadataJson: null,
  createdAt: new Date('2026-05-13T00:00:00.000Z'),
  acknowledgedAt: null,
  resolvedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAlertFindFirst.mockResolvedValue(ALERT_ROW)
  mockAlertFindMany.mockResolvedValue([ALERT_ROW])
  mockAlertUpdate.mockResolvedValue({ ...ALERT_ROW, status: 'acknowledged', acknowledgedAt: new Date() })
  mockAlertCreate.mockImplementation(async ({ data }: { data: typeof ALERT_ROW }) => ({
    ...data,
    relatedThreadId: null,
    relatedActionId: null,
    acknowledgedAt: null,
    resolvedAt: null,
  }))
  mockPublishInboxMessage.mockResolvedValue({
    id: 'inbox-1',
    userId: 'alice',
    channelId: 'alerts',
    agentId: 'system-alerts',
    content: ALERT_ROW.body,
    createdAt: new Date().toISOString(),
    kind: 'alert',
    read: false,
  })
})

describe('GET /api/mobile/alerts', () => {
  it('returns a list of open alerts for the authenticated user', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile/alerts',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(Array.isArray(body.alerts)).toBe(true)
    expect(body.alerts[0].id).toBe('alert-1')
    expect(mockAlertFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'alice', status: 'open' }),
        orderBy: { createdAt: 'desc' },
      }),
    )
  })

  it('applies status filter when provided', async () => {
    const app = await buildApp()

    await app.inject({
      method: 'GET',
      url: '/api/mobile/alerts?status=acknowledged',
      headers: { 'x-user-id': 'alice' },
    })

    expect(mockAlertFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'acknowledged' }),
      }),
    )
  })

  it('clamps limit to 50', async () => {
    const app = await buildApp()

    await app.inject({
      method: 'GET',
      url: '/api/mobile/alerts?limit=200',
      headers: { 'x-user-id': 'alice' },
    })

    expect(mockAlertFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    )
  })

  it('applies before cursor when provided', async () => {
    const app = await buildApp()

    await app.inject({
      method: 'GET',
      url: '/api/mobile/alerts?before=2026-05-13T00:00:00.000Z',
      headers: { 'x-user-id': 'alice' },
    })

    expect(mockAlertFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { lt: new Date('2026-05-13T00:00:00.000Z') },
        }),
      }),
    )
  })
})

describe('GET /api/mobile/alerts/:id', () => {
  it('returns the alert when found', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile/alerts/alert-1',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.alert.id).toBe('alert-1')
    expect(mockAlertFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'alert-1', userId: 'alice' } }),
    )
  })

  it('returns 404 when alert does not exist', async () => {
    mockAlertFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile/alerts/missing',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/mobile/alerts/:id/ack', () => {
  it('acknowledges an open alert', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/alert-1/ack',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alert-1' },
        data: expect.objectContaining({ status: 'acknowledged' }),
      }),
    )
  })

  it('returns 404 when alert is not found', async () => {
    mockAlertFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/missing/ack',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('does not update when alert is already acknowledged', async () => {
    mockAlertFindFirst.mockResolvedValue({ ...ALERT_ROW, status: 'acknowledged' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/alert-1/ack',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockAlertUpdate).not.toHaveBeenCalled()
  })

  it('does not update when alert is already resolved', async () => {
    mockAlertFindFirst.mockResolvedValue({ ...ALERT_ROW, status: 'resolved' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/alert-1/ack',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockAlertUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/mobile/alerts/:id/resolve', () => {
  it('resolves an open alert', async () => {
    mockAlertUpdate.mockResolvedValue({ ...ALERT_ROW, status: 'resolved', resolvedAt: new Date() })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/alert-1/resolve',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alert-1' },
        data: expect.objectContaining({ status: 'resolved' }),
      }),
    )
  })

  it('returns 404 when alert is not found', async () => {
    mockAlertFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/missing/resolve',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('does not update when alert is already resolved', async () => {
    mockAlertFindFirst.mockResolvedValue({ ...ALERT_ROW, status: 'resolved' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/alert-1/resolve',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockAlertUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/mobile/alerts/events', () => {
  it('creates a new alert and publishes a notification with mapped severity', async () => {
    mockAlertFindMany.mockResolvedValue([])
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/events',
      headers: { 'x-user-id': 'alice' },
      payload: {
        source: 'home-lab',
        sourceNode: 'node-2',
        sourceService: 'prometheus',
        eventType: 'cpu_spike',
        level: 'warning',
        title: 'CPU spike on node-2',
        message: 'CPU exceeded 90%',
      },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.payload)
    expect(body.created).toBe(true)
    expect(body.deduplicated).toBe(false)
    expect(mockAlertCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'alice',
          source: 'homelab',
          severity: 'medium',
          title: 'CPU spike on node-2',
        }),
      }),
    )
    expect(mockPublishInboxMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'alice',
        channelId: 'alerts',
        kind: 'alert',
      }),
    )
  })

  it('deduplicates repeated events and updates duplicate metadata', async () => {
    const existing = {
      ...ALERT_ROW,
      title: 'Nginx down',
      source: 'gateway',
      sourceService: 'nginx',
      metadataJson: JSON.stringify({
        dedupKey: 'gateway|node-1|nginx|service_down|nginx down|',
        duplicateCount: 1,
      }),
    }
    mockAlertFindMany.mockResolvedValue([existing])
    mockAlertUpdate.mockResolvedValue({
      ...existing,
      metadataJson: JSON.stringify({
        dedupKey: 'gateway|node-1|nginx|service_down|nginx down|',
        duplicateCount: 2,
      }),
    })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/events',
      headers: { 'x-user-id': 'alice' },
      payload: {
        source: 'gateway',
        sourceNode: 'node-1',
        sourceService: 'nginx',
        eventType: 'service_down',
        severity: 'error',
        title: 'Nginx down',
        dedupKey: 'gateway|node-1|nginx|service_down|nginx down|',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.created).toBe(false)
    expect(body.deduplicated).toBe(true)
    expect(mockAlertCreate).not.toHaveBeenCalled()
    expect(mockAlertUpdate).toHaveBeenCalled()
    expect(mockPublishInboxMessage).not.toHaveBeenCalled()
  })

  it('re-opens and notifies when deduplicated event escalates severity', async () => {
    const existing = {
      ...ALERT_ROW,
      title: 'Disk full',
      severity: 'low',
      status: 'acknowledged',
      acknowledgedAt: new Date('2026-05-13T00:05:00.000Z'),
      metadataJson: JSON.stringify({
        dedupKey: 'homelab|node-1|prometheus|disk_full|disk full|',
        duplicateCount: 3,
      }),
    }
    mockAlertFindMany.mockResolvedValue([existing])
    mockAlertUpdate.mockResolvedValue({
      ...existing,
      status: 'open',
      severity: 'critical',
      acknowledgedAt: null,
    })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/alerts/events',
      headers: { 'x-user-id': 'alice' },
      payload: {
        source: 'homelab',
        sourceNode: 'node-1',
        sourceService: 'prometheus',
        eventType: 'disk_full',
        severity: 'critical',
        title: 'Disk full',
        dedupKey: 'homelab|node-1|prometheus|disk_full|disk full|',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.escalated).toBe(true)
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          severity: 'critical',
          status: 'open',
          acknowledgedAt: null,
        }),
      }),
    )
    expect(mockPublishInboxMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'alice',
        channelId: 'alerts',
        kind: 'alert',
      }),
    )
  })
})
