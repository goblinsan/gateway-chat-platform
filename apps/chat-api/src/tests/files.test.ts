import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import filesRoutes from '../routes/files'

vi.mock('../config/env', () => ({
  getEnv: () => ({
    CF_ACCESS_TEAM_DOMAIN: undefined,
    CF_ACCESS_AUD: undefined,
    CHAT_DEFAULT_USER_ID: 'me',
  }),
}))

import userIdentityPlugin from '../plugins/userIdentity'

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(userIdentityPlugin)
  await app.register(filesRoutes, { prefix: '/api' })
  return app
}

const SAMPLE_FILE = {
  threadId: 'thread-test-1',
  name: 'test.txt',
  mimeType: 'text/plain',
  content: btoa('Hello, world!'),
  size: 13,
}

describe('Files API', () => {
  it('POST /api/files stores file and returns metadata without content', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/files',
      payload: SAMPLE_FILE,
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.payload)
    expect(body.id).toBeDefined()
    expect(body.name).toBe('test.txt')
    expect(body.mimeType).toBe('text/plain')
    expect(body.content).toBeUndefined()
  })

  it('GET /api/files returns files for threadId', async () => {
    const app = await buildApp()

    await app.inject({ method: 'POST', url: '/api/files', payload: SAMPLE_FILE })

    const res = await app.inject({
      method: 'GET',
      url: `/api/files?threadId=${SAMPLE_FILE.threadId}`,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(Array.isArray(body.files)).toBe(true)
    expect(body.files.length).toBeGreaterThanOrEqual(1)
    expect(body.files[0].content).toBeUndefined()
  })

  it('GET /api/files returns empty array for unknown threadId', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/files?threadId=unknown-thread-xyz',
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.files).toHaveLength(0)
  })

  it('POST /api/files returns 400 when required fields missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/files',
      payload: { threadId: 'thread-1', name: 'test.txt' },
    })
    expect(res.statusCode).toBe(400)
  })
})
