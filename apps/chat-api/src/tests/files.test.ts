import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import filesRoutes from '../routes/files'

const SAMPLE_FILE = {
  threadId: 'thread-test-1',
  name: 'test.txt',
  mimeType: 'text/plain',
  content: btoa('Hello, world!'),
  size: 13,
}

describe('Files API', () => {
  it('POST /api/files stores file and returns metadata without content', async () => {
    const app = Fastify()
    await app.register(filesRoutes, { prefix: '/api' })
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
    const app = Fastify()
    await app.register(filesRoutes, { prefix: '/api' })

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
    const app = Fastify()
    await app.register(filesRoutes, { prefix: '/api' })
    const res = await app.inject({
      method: 'GET',
      url: '/api/files?threadId=unknown-thread-xyz',
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.files).toHaveLength(0)
  })

  it('POST /api/files returns 400 when required fields missing', async () => {
    const app = Fastify()
    await app.register(filesRoutes, { prefix: '/api' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/files',
      payload: { threadId: 'thread-1', name: 'test.txt' },
    })
    expect(res.statusCode).toBe(400)
  })
})
