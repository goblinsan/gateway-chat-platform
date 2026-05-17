import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const mockEnv = {
  CF_ACCESS_TEAM_DOMAIN: undefined as string | undefined,
  CF_ACCESS_AUD: undefined as string | undefined,
  CHAT_DEFAULT_USER_ID: 'me',
  MOBILE_SHARED_TOKEN: undefined as string | undefined,
  MOBILE_SHARED_USER_ID: undefined as string | undefined,
}

vi.mock('../config/env', () => ({
  getEnv: () => mockEnv,
}))

import userIdentityPlugin from '../plugins/userIdentity'
import sessionRoutes from '../routes/session'

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(userIdentityPlugin)
  await app.register(sessionRoutes, { prefix: '/api' })
  return app
}

describe('user identity plugin', () => {
  beforeEach(() => {
    mockEnv.CF_ACCESS_TEAM_DOMAIN = undefined
    mockEnv.CF_ACCESS_AUD = undefined
    mockEnv.CHAT_DEFAULT_USER_ID = 'me'
    mockEnv.MOBILE_SHARED_TOKEN = undefined
    mockEnv.MOBILE_SHARED_USER_ID = undefined
  })

  it('falls back to the default user in local mode', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/session/me' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ id: 'me', userId: 'me' })
  })

  it('uses X-User-Id in local mode', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/session/me',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ id: 'alice', userId: 'alice' })
  })

  it('requires the Cloudflare identity header when CF mode is configured', async () => {
    mockEnv.CF_ACCESS_TEAM_DOMAIN = 'team.example.com'
    mockEnv.CF_ACCESS_AUD = 'audience'

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/session/me' })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).error).toContain('Missing Cloudflare Access')
  })

  it('accepts the configured mobile bearer token when CF mode is enabled', async () => {
    mockEnv.CF_ACCESS_TEAM_DOMAIN = 'team.example.com'
    mockEnv.CF_ACCESS_AUD = 'audience'
    mockEnv.MOBILE_SHARED_TOKEN = 'mobile-secret'
    mockEnv.MOBILE_SHARED_USER_ID = 'mobile-user'

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/session/me',
      headers: { authorization: 'Bearer mobile-secret' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ id: 'mobile-user', userId: 'mobile-user' })
  })

  it('uses the JWT subject in Cloudflare mode', async () => {
    mockEnv.CF_ACCESS_TEAM_DOMAIN = 'team.example.com'
    mockEnv.CF_ACCESS_AUD = 'audience'

    const app = await buildApp()
    const payload = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const claims = Buffer.from(JSON.stringify({ sub: 'cf-user-123' })).toString('base64url')
    const token = `${payload}.${claims}.signature`

    const res = await app.inject({
      method: 'GET',
      url: '/api/session/me',
      headers: { 'cf-access-jwt-assertion': token, 'x-user-id': 'spoofed-user' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ id: 'cf-user-123', userId: 'cf-user-123' })
  })
})
