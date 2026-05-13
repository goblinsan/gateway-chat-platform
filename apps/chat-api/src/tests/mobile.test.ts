import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

// --- env mock ---
const mockEnv = {
  CF_ACCESS_TEAM_DOMAIN: undefined as string | undefined,
  CF_ACCESS_AUD: undefined as string | undefined,
  CHAT_DEFAULT_USER_ID: 'me',
  APNS_TEAM_ID: 'TEAMID1234',
  APNS_KEY_ID: 'KEYID12345',
  APNS_BUNDLE_ID: 'com.example.app',
  APNS_PRIVATE_KEY_BASE64: undefined as string | undefined,
  APNS_PRIVATE_KEY_PATH: undefined as string | undefined,
  APNS_SANDBOX: false,
}

vi.mock('../config/env', () => ({
  getEnv: () => mockEnv,
}))

// --- APNs service mock ---
const mockSendApns = vi.fn()
const mockIsApnsConfigured = vi.fn(() => true)

vi.mock('../services/apns', () => ({
  sendApnsNotification: (...args: unknown[]) => mockSendApns(...args),
  isApnsConfigured: () => mockIsApnsConfigured(),
}))

// --- DB mock ---
const mockFindFirst = vi.fn()
const mockCreateAttempt = vi.fn()
const mockUpdateDevice = vi.fn()

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({
    mobileDevice: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdateDevice(...args),
    },
    pushAttempt: {
      create: (...args: unknown[]) => mockCreateAttempt(...args),
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

const VALID_TOKEN = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'

const DEVICE_ROW = {
  id: 'device-1',
  userId: 'alice',
  platform: 'ios',
  tokenHash: 'hash',
  tokenLast4: '6789',
  deviceName: 'Alice iPhone',
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSeenAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsApnsConfigured.mockReturnValue(true)
  mockFindFirst.mockResolvedValue(DEVICE_ROW)
  mockCreateAttempt.mockResolvedValue({})
  mockUpdateDevice.mockResolvedValue({})
})

describe('POST /api/mobile/push/test', () => {
  it('returns 503 when APNs is not configured', async () => {
    mockIsApnsConfigured.mockReturnValue(false)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: VALID_TOKEN },
    })

    expect(res.statusCode).toBe(503)
    expect(mockSendApns).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no registered iOS device', async () => {
    mockFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: VALID_TOKEN },
    })

    expect(res.statusCode).toBe(404)
    expect(mockSendApns).not.toHaveBeenCalled()
  })

  it('returns 422 when apnsToken is missing from request body', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: {},
    })

    expect(res.statusCode).toBe(422)
    expect(mockSendApns).not.toHaveBeenCalled()
  })

  it('returns 400 when apnsToken is malformed', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: 'not-hex-!!' },
    })

    expect(res.statusCode).toBe(400)
    expect(mockSendApns).not.toHaveBeenCalled()
  })

  it('returns 200 and logs a success attempt on successful APNs delivery', async () => {
    mockSendApns.mockResolvedValue({ ok: true })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: VALID_TOKEN, title: 'Hello', body: 'World' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(true)
    expect(body.deviceId).toBe('device-1')
    expect(typeof body.alertId).toBe('string')

    // APNs was called with the normalised token
    expect(mockSendApns).toHaveBeenCalledWith(
      VALID_TOKEN,
      expect.objectContaining({ title: 'Hello', body: 'World' }),
    )

    // A success attempt was persisted
    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deviceId: 'device-1',
          status: 'success',
          provider: 'apns',
        }),
      }),
    )
    // Device was NOT disabled
    expect(mockUpdateDevice).not.toHaveBeenCalled()
  })

  it('logs error attempt and returns 502 on APNs rejection', async () => {
    mockSendApns.mockResolvedValue({ ok: false, reason: 'DeviceTokenNotForTopic', stale: false })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: VALID_TOKEN },
    })

    expect(res.statusCode).toBe(502)
    const body = JSON.parse(res.payload)
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('DeviceTokenNotForTopic')

    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'error',
          errorCode: 'DeviceTokenNotForTopic',
        }),
      }),
    )
    // Not a stale token, so device stays enabled
    expect(mockUpdateDevice).not.toHaveBeenCalled()
  })

  it('disables device on stale-token APNs error (Unregistered)', async () => {
    mockSendApns.mockResolvedValue({ ok: false, reason: 'Unregistered', stale: true })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: VALID_TOKEN },
    })

    expect(res.statusCode).toBe(502)
    const body = JSON.parse(res.payload)
    expect(body.stale).toBe(true)

    // Attempt is logged as error
    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'error', errorCode: 'Unregistered' }),
      }),
    )

    // Device should be disabled
    expect(mockUpdateDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'device-1' },
        data: { enabled: false },
      }),
    )
  })

  it('disables device on stale-token APNs error (BadDeviceToken)', async () => {
    mockSendApns.mockResolvedValue({ ok: false, reason: 'BadDeviceToken', stale: true })
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: VALID_TOKEN },
    })

    expect(res.statusCode).toBe(502)

    expect(mockUpdateDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'device-1' },
        data: { enabled: false },
      }),
    )
  })

  it('returns 502 and logs error attempt when APNs throws a network error', async () => {
    mockSendApns.mockRejectedValue(new Error('ECONNREFUSED'))
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: VALID_TOKEN },
    })

    expect(res.statusCode).toBe(502)
    const body = JSON.parse(res.payload)
    expect(body.error).toMatch(/APNs/)

    expect(mockCreateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'error',
          errorCode: 'SendError',
        }),
      }),
    )
    expect(mockUpdateDevice).not.toHaveBeenCalled()
  })

  it('normalises the APNs token (strips angle brackets and spaces)', async () => {
    mockSendApns.mockResolvedValue({ ok: true })
    const app = await buildApp()

    const rawToken = '< ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789 >'
    const expected = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile/push/test',
      headers: { 'x-user-id': 'alice' },
      payload: { apnsToken: rawToken },
    })

    expect(res.statusCode).toBe(200)
    expect(mockSendApns).toHaveBeenCalledWith(expected, expect.anything())
  })
})
