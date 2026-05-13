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
