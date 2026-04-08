import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/env', () => ({
  getEnv: () => ({
    CF_ACCESS_TEAM_DOMAIN: undefined,
    CF_ACCESS_AUD: undefined,
    CHAT_DEFAULT_USER_ID: 'me',
  }),
}))

const PERSONA_ALICE = {
  id: 'persona-alice-uuid',
  userId: 'alice',
  name: 'Alice Persona',
  description: 'A test persona',
  systemPrompt: 'You are Alice.',
  icon: '👩',
  color: '#8b5cf6',
  providerName: 'auto',
  model: 'auto',
  temperature: 0.7,
  maxTokens: null,
  enableReasoning: false,
  enabled: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const PERSONA_BOB = {
  id: 'persona-bob-uuid',
  userId: 'bob',
  name: 'Bob Persona',
  description: null,
  systemPrompt: null,
  icon: '🧑',
  color: '#8b5cf6',
  providerName: 'auto',
  model: 'auto',
  temperature: null,
  maxTokens: null,
  enableReasoning: false,
  enabled: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const mockFindMany = vi.fn()
const mockFindFirst = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({
    userPersona: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
  }),
}))

import userIdentityPlugin from '../plugins/userIdentity'
import personaRoutes from '../routes/personas'

async function buildApp(userId = 'alice') {
  const app = Fastify({ logger: false })
  // Override userId to the given value via X-User-Id header support in the identity plugin
  await app.register(userIdentityPlugin)
  await app.register(personaRoutes, { prefix: '/api' })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/personas', () => {
  it('returns only the calling user\'s personas', async () => {
    mockFindMany.mockResolvedValue([PERSONA_ALICE])
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/personas',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(Array.isArray(body.personas)).toBe(true)
    expect(body.personas).toHaveLength(1)
    expect(body.personas[0].name).toBe('Alice Persona')
    // systemPrompt must not be exposed in list response
    expect(body.personas[0].systemPrompt).toBeUndefined()
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'alice' },
    }))
  })

  it('returns empty list when user has no personas', async () => {
    mockFindMany.mockResolvedValue([])
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/personas',
      headers: { 'x-user-id': 'newuser' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.personas).toHaveLength(0)
  })
})

describe('GET /api/personas/:id', () => {
  it('returns the full persona including systemPrompt for the owner', async () => {
    mockFindFirst.mockResolvedValue(PERSONA_ALICE)
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/personas/persona-alice-uuid',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.systemPrompt).toBe('You are Alice.')
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'persona-alice-uuid', userId: 'alice' },
    }))
  })

  it('returns 404 when persona belongs to a different user', async () => {
    mockFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/personas/persona-bob-uuid',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/personas', () => {
  it('creates a new persona for the calling user', async () => {
    const created = { ...PERSONA_ALICE, id: 'new-uuid' }
    mockCreate.mockResolvedValue(created)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/personas',
      headers: { 'x-user-id': 'alice' },
      payload: {
        name: 'Alice Persona',
        description: 'A test persona',
        systemPrompt: 'You are Alice.',
        icon: '👩',
        color: '#8b5cf6',
      },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.payload)
    expect(body.name).toBe('Alice Persona')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'alice',
        name: 'Alice Persona',
        systemPrompt: 'You are Alice.',
      }),
    }))
  })

  it('rejects creation without a name', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/personas',
      headers: { 'x-user-id': 'alice' },
      payload: { systemPrompt: 'You are Alice.' },
    })

    expect(res.statusCode).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('enforces systemPrompt length limit', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/personas',
      headers: { 'x-user-id': 'alice' },
      payload: {
        name: 'Test',
        systemPrompt: 'x'.repeat(4097),
      },
    })

    expect(res.statusCode).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('PUT /api/personas/:id', () => {
  it('updates persona for the owner', async () => {
    mockFindFirst.mockResolvedValue(PERSONA_ALICE)
    mockUpdate.mockResolvedValue({ ...PERSONA_ALICE, name: 'Updated Name' })
    const app = await buildApp()

    const res = await app.inject({
      method: 'PUT',
      url: '/api/personas/persona-alice-uuid',
      headers: { 'x-user-id': 'alice' },
      payload: { name: 'Updated Name' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.name).toBe('Updated Name')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'persona-alice-uuid' },
      data: expect.objectContaining({ name: 'Updated Name' }),
    }))
  })

  it('returns 404 when persona does not belong to user', async () => {
    mockFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'PUT',
      url: '/api/personas/persona-bob-uuid',
      headers: { 'x-user-id': 'alice' },
      payload: { name: 'Hijack' },
    })

    expect(res.statusCode).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/personas/:id', () => {
  it('deletes persona for the owner', async () => {
    mockFindFirst.mockResolvedValue(PERSONA_ALICE)
    mockDelete.mockResolvedValue(undefined)
    const app = await buildApp()

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/personas/persona-alice-uuid',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'persona-alice-uuid' } })
  })

  it('returns 404 when persona does not belong to user', async () => {
    mockFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/personas/persona-bob-uuid',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(404)
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe('POST /api/personas/:id/duplicate', () => {
  it('duplicates a persona for the owner', async () => {
    const copy = { ...PERSONA_ALICE, id: 'copy-uuid', name: 'Alice Persona (copy)' }
    mockFindFirst.mockResolvedValue(PERSONA_ALICE)
    mockCreate.mockResolvedValue(copy)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/personas/persona-alice-uuid/duplicate',
      headers: { 'x-user-id': 'alice' },
      payload: {},
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.payload)
    expect(body.name).toBe('Alice Persona (copy)')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'alice',
        name: 'Alice Persona (copy)',
        systemPrompt: 'You are Alice.',
      }),
    }))
  })

  it('allows custom name for duplicate', async () => {
    const copy = { ...PERSONA_ALICE, id: 'copy-uuid', name: 'My Custom Copy' }
    mockFindFirst.mockResolvedValue(PERSONA_ALICE)
    mockCreate.mockResolvedValue(copy)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/personas/persona-alice-uuid/duplicate',
      headers: { 'x-user-id': 'alice' },
      payload: { name: 'My Custom Copy' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.payload)
    expect(body.name).toBe('My Custom Copy')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'My Custom Copy' }),
    }))
  })

  it('returns 404 for duplicate when persona does not belong to user', async () => {
    mockFindFirst.mockResolvedValue(null)
    const app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/personas/persona-bob-uuid/duplicate',
      headers: { 'x-user-id': 'alice' },
      payload: {},
    })

    expect(res.statusCode).toBe(404)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

// Ensure that Bob's personas are not accessible by Alice
describe('Cross-user persona isolation', () => {
  it('alice cannot read bob\'s persona by id', async () => {
    mockFindFirst.mockResolvedValue(null) // DB enforces userId = alice
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: `/api/personas/${PERSONA_BOB.id}`,
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(404)
  })
})
