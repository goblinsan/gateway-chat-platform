import { describe, it, expect, vi, beforeEach } from 'vitest'

// Default TTS-enabled env
const mockEnv = {
  TTS_ENABLED: true,
  TTS_BASE_URL: 'http://192.168.0.111:5000',
  TTS_DEFAULT_VOICE: 'assistant_v1',
  TTS_GENERATE_PATH: '/tts',
  TTS_STREAM_PATH: '/tts/stream',
  TTS_VOICES_PATH: '/voices',
  TTS_HEALTH_PATH: '/health',
  NODE_ENV: 'test',
}

vi.mock('../config/env', () => ({
  getEnv: () => mockEnv,
  loadEnv: () => mockEnv,
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import Fastify from 'fastify'
import ttsRoutes from '../routes/tts'

beforeEach(() => {
  mockFetch.mockReset()
  mockEnv.TTS_ENABLED = true
})

describe('GET /api/tts/health', () => {
  it('returns upstream health when TTS is enabled', async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 })

    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/tts/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.enabled).toBe(true)
    expect(body.upstreamStatus).toBe(200)
    expect(body.baseUrl).toBe('http://192.168.0.111:5000')
  })

  it('returns disabled status when TTS is off', async () => {
    mockEnv.TTS_ENABLED = false

    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/tts/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.enabled).toBe(false)
    expect(body.upstreamStatus).toBe(0)
  })

  it('handles upstream connection failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/tts/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.enabled).toBe(true)
    expect(body.upstreamStatus).toBe(0)
    expect(body.error).toContain('ECONNREFUSED')
  })
})

describe('GET /api/tts/voices', () => {
  it('returns voices from upstream service', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: 'assistant_v1', name: 'Assistant' }],
    })

    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/tts/voices' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.enabled).toBe(true)
    expect(body.voices).toHaveLength(1)
    expect(body.voices[0].id).toBe('assistant_v1')
  })

  it('returns 409 when TTS is disabled', async () => {
    mockEnv.TTS_ENABLED = false

    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/tts/voices' })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('not enabled')
  })

  it('returns 502 when upstream fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })

    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({ method: 'GET', url: '/api/tts/voices' })
    expect(res.statusCode).toBe(502)
  })
})

describe('POST /api/tts', () => {
  it('returns audio bytes on successful synthesis', async () => {
    const audioData = Buffer.from('RIFF fake wav data')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (k: string) => k === 'content-type' ? 'audio/wav' : null },
      arrayBuffer: async () => audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength),
    })

    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      payload: { text: 'Hello world' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('audio/wav')
  })

  it('returns 409 when TTS is disabled', async () => {
    mockEnv.TTS_ENABLED = false

    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      payload: { text: 'Hello' },
    })

    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('not enabled')
  })

  it('returns 400 when text is missing', async () => {
    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      payload: {},
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 502 when upstream synthesis fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Service unavailable',
    })

    const app = Fastify()
    await app.register(ttsRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      payload: { text: 'Fail test' },
    })

    expect(res.statusCode).toBe(502)
  })
})
