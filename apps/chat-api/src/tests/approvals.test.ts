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
const mockApprovalFindFirst = vi.fn()
const mockApprovalFindMany = vi.fn()
const mockApprovalUpdate = vi.fn()

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
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    actionApproval: {
      findFirst: (...args: unknown[]) => mockApprovalFindFirst(...args),
      findMany: (...args: unknown[]) => mockApprovalFindMany(...args),
      update: (...args: unknown[]) => mockApprovalUpdate(...args),
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

const PENDING_APPROVAL = {
  id: 'approval-1',
  userId: 'alice',
  title: 'Restart nginx on node-1',
  description: 'Agent wants to restart nginx to apply config changes.',
  riskLevel: 'high',
  actionType: 'service_restart',
  targetNode: 'node-1',
  targetService: 'nginx',
  proposedByAgentId: 'agent-ops',
  status: 'pending',
  expiresAt: new Date(Date.now() + 3600_000), // 1 hour from now
  createdAt: new Date('2026-05-13T00:00:00.000Z'),
  decidedAt: null,
  decidedBy: null,
  metadataJson: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApprovalFindFirst.mockResolvedValue(PENDING_APPROVAL)
  mockApprovalFindMany.mockResolvedValue([PENDING_APPROVAL])
  mockApprovalUpdate.mockResolvedValue({ ...PENDING_APPROVAL, status: 'approved', decidedAt: new Date(), decidedBy: 'alice' })
})

describe('GET /api/mobile/actions/pending', () => {
  it('returns pending approvals for the authenticated user', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile/actions/pending',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(Array.isArray(body.approvals)).toBe(true)
    expect(body.approvals[0].id).toBe('approval-1')
    expect(mockApprovalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'alice',
          status: 'pending',
        }),
        orderBy: { createdAt: 'desc' },
      }),
    )
  })
})

describe('GET /api/mobile/actions/:id', () => {
  it('returns the approval when found', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile/actions/approval-1',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.approval.id).toBe('approval-1')
    expect(mockApprovalFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'approval-1', userId: 'alice' } }),
    )
  })

  it('returns 404 when approval does not exist', async () => {
    mockApprovalFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile/actions/missing',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/mobile/actions/:id/approve', () => {
  it('approves a pending action', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/actions/approval-1/approve',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.approval.status).toBe('approved')
    expect(mockApprovalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'approval-1' },
        data: expect.objectContaining({ status: 'approved', decidedBy: 'alice' }),
      }),
    )
  })

  it('returns 404 when approval is not found', async () => {
    mockApprovalFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/actions/missing/approve',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 409 when approval is already decided', async () => {
    mockApprovalFindFirst.mockResolvedValue({ ...PENDING_APPROVAL, status: 'approved' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/actions/approval-1/approve',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(409)
    expect(mockApprovalUpdate).not.toHaveBeenCalled()
  })

  it('returns 410 and marks as expired when the approval has passed its expiresAt', async () => {
    const expired = { ...PENDING_APPROVAL, expiresAt: new Date(Date.now() - 1000) }
    mockApprovalFindFirst.mockResolvedValue(expired)
    mockApprovalUpdate.mockResolvedValue({ ...expired, status: 'expired' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/actions/approval-1/approve',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(410)
    expect(mockApprovalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'approval-1' },
        data: { status: 'expired' },
      }),
    )
  })

  it('approves when expiresAt is null (no expiry)', async () => {
    mockApprovalFindFirst.mockResolvedValue({ ...PENDING_APPROVAL, expiresAt: null })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/actions/approval-1/approve',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockApprovalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'approved' }),
      }),
    )
  })
})

describe('POST /api/mobile/actions/:id/deny', () => {
  it('denies a pending action', async () => {
    mockApprovalUpdate.mockResolvedValue({ ...PENDING_APPROVAL, status: 'denied', decidedAt: new Date(), decidedBy: 'alice' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/actions/approval-1/deny',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.approval.status).toBe('denied')
    expect(mockApprovalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'approval-1' },
        data: expect.objectContaining({ status: 'denied', decidedBy: 'alice' }),
      }),
    )
  })

  it('returns 404 when approval is not found', async () => {
    mockApprovalFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/actions/missing/deny',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 409 when approval is already decided', async () => {
    mockApprovalFindFirst.mockResolvedValue({ ...PENDING_APPROVAL, status: 'denied' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/actions/approval-1/deny',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(409)
    expect(mockApprovalUpdate).not.toHaveBeenCalled()
  })

  it('returns 410 and marks as expired when the approval has passed its expiresAt', async () => {
    const expired = { ...PENDING_APPROVAL, expiresAt: new Date(Date.now() - 1000) }
    mockApprovalFindFirst.mockResolvedValue(expired)
    mockApprovalUpdate.mockResolvedValue({ ...expired, status: 'expired' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/actions/approval-1/deny',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(410)
    expect(mockApprovalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'expired' },
      }),
    )
  })
})
