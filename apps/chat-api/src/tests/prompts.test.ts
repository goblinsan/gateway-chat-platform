import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import promptsRoutes from '../routes/prompts'

describe('GET /api/prompts', () => {
  it('returns all prompts', async () => {
    const app = Fastify()
    await app.register(promptsRoutes, { prefix: '/api' })
    const res = await app.inject({ method: 'GET', url: '/api/prompts' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.prompts).toBeDefined()
    expect(Array.isArray(body.prompts)).toBe(true)
    expect(body.prompts.length).toBeGreaterThanOrEqual(10)
  })

  it('response has correct structure', async () => {
    const app = Fastify()
    await app.register(promptsRoutes, { prefix: '/api' })
    const res = await app.inject({ method: 'GET', url: '/api/prompts' })
    const body = JSON.parse(res.payload)
    for (const p of body.prompts) {
      expect(typeof p.id).toBe('string')
      expect(typeof p.title).toBe('string')
      expect(typeof p.category).toBe('string')
      expect(typeof p.prompt).toBe('string')
      expect(Array.isArray(p.tags)).toBe(true)
    }
  })

  it('prompts are organized in multiple categories', async () => {
    const app = Fastify()
    await app.register(promptsRoutes, { prefix: '/api' })
    const res = await app.inject({ method: 'GET', url: '/api/prompts' })
    const body = JSON.parse(res.payload)
    const categories = new Set(body.prompts.map((p: { category: string }) => p.category))
    expect(categories.size).toBeGreaterThanOrEqual(3)
  })
})
