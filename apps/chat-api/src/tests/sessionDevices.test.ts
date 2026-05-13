import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const mockEnv = {
  CF_ACCESS_TEAM_DOMAIN: undefined as string | undefined,
  CF_ACCESS_AUD: undefined as string | undefined,
  CHAT_DEFAULT_USER_ID: 'me',
}

vi.mock('../config/env', () => ({
  getEnv: () => mockEnv,
}))

const mockUpsert = vi.fn()

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({
    mobileDevice: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  }),
}))

import userIdentityPlugin from '../plugins/userIdentity'
import sessionRoutes from '../routes/session'

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(userIdentityPlugin)
  await app.register(sessionRoutes, { prefix: '/api' })
  return app
}

describe('POST /api/session/mobile-devices/apns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.CF_ACCESS_TEAM_DOMAIN = undefined
    mockEnv.CF_ACCESS_AUD = undefined
    mockEnv.CHAT_DEFAULT_USER_ID = 'me'
  })

  it('hashes and stores APNs token for the authenticated user', async () => {
    const normalizedToken = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    const expectedHash = createHash('sha256').update(normalizedToken).digest('hex')
    mockUpsert.mockResolvedValue({
      id: 'device-1',
      platform: 'ios',
      deviceName: 'Alice iPhone',
      tokenLast4: '6789',
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      lastSeenAt: new Date('2026-05-13T00:00:00.000Z'),
    })

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/session/mobile-devices/apns',
      headers: { 'x-user-id': 'alice' },
      payload: {
        apnsToken: "< ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789 >",
        deviceName: 'Alice iPhone',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_platform_tokenHash: {
          userId: 'alice',
          platform: 'ios',
          tokenHash: expectedHash,
        },
      },
      create: expect.objectContaining({
        userId: 'alice',
        platform: 'ios',
        tokenHash: expectedHash,
        tokenLast4: '6789',
        deviceName: 'Alice iPhone',
      }),
    }))
    expect(res.body).not.toContain(normalizedToken)
    expect(res.body).not.toContain(expectedHash)
  })

  it('rejects malformed APNs token values', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/session/mobile-devices/apns',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: 'not-a-token' },
    })

    expect(res.statusCode).toBe(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
