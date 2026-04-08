/**
 * Per-user workspace isolation tests (#85, #86, #87).
 *
 * These tests verify that one user cannot access another user's chats,
 * messages, or file uploads, and that persistence calls include the correct
 * userId so future query-level filtering will work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

// ---------------------------------------------------------------------------
// Shared env mock — no CF Access configured so the X-User-Id header is used
// ---------------------------------------------------------------------------
vi.mock('../config/env', () => ({
  getEnv: () => ({
    CF_ACCESS_TEAM_DOMAIN: undefined,
    CF_ACCESS_AUD: undefined,
    CHAT_DEFAULT_USER_ID: 'me',
  }),
}))

// ---------------------------------------------------------------------------
// Agent registry mock
// ---------------------------------------------------------------------------
vi.mock('../agents/registry', () => {
  const AGENTS = [
    {
      id: 'local-analyst',
      name: 'Local Analyst',
      providerName: 'lm-studio-a',
      model: 'local-model',
      costClass: 'free',
      systemPrompt: 'analyst',
      temperature: 0.3,
      routingPolicy: { preferredProvider: 'lm-studio-a' },
      enabled: true,
    },
  ]
  return {
    listAgents: () => AGENTS,
    getAgent: (id: string) => AGENTS.find((a) => a.id === id),
    getAgentRegistry: () => ({ list: () => AGENTS, get: (id: string) => AGENTS.find((a) => a.id === id) }),
  }
})

// ---------------------------------------------------------------------------
// Provider registry mock
// ---------------------------------------------------------------------------
const MOCK_REGISTRY = {
  sendChatWithChain: vi.fn().mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Hello!' },
      finishReason: 'stop',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    },
    usedProvider: 'lm-studio-a',
  }),
  getAll: vi.fn().mockReturnValue([{ name: 'lm-studio-a' }]),
}
vi.mock('../config/providerRegistry', () => ({ getProviderRegistry: () => MOCK_REGISTRY }))

// ---------------------------------------------------------------------------
// Persistence mocks — capture what userId values are written
// ---------------------------------------------------------------------------
const mockUpsertConversation = vi.fn()
const mockPersistMessage = vi.fn()
const mockPersistUsageLog = vi.fn()

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({ conversation: {}, message: {}, usageLog: {} }),
}))

vi.mock('../services/persistence', () => ({
  upsertConversation: (...args: unknown[]) => mockUpsertConversation(...args),
  persistMessage: (...args: unknown[]) => mockPersistMessage(...args),
  persistUsageLog: (...args: unknown[]) => mockPersistUsageLog(...args),
}))

vi.mock('../services/notesSync', () => ({
  syncAgentConversationToNotes: vi.fn(),
}))

vi.mock('../services/costEstimator', () => ({
  estimateCostUsd: () => 0,
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import userIdentityPlugin from '../plugins/userIdentity'
import filesRoutes from '../routes/files'
import chatRoutes from '../routes/chat'

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------
async function buildFilesApp() {
  const app = Fastify({ logger: false })
  await app.register(userIdentityPlugin)
  await app.register(filesRoutes, { prefix: '/api' })
  return app
}

async function buildChatApp() {
  const app = Fastify({ logger: false })
  await app.register(userIdentityPlugin)
  await app.register(chatRoutes, { prefix: '/api' })
  return app
}

// ---------------------------------------------------------------------------
// File upload isolation (#86, #87)
// ---------------------------------------------------------------------------
describe('File upload workspace isolation', () => {
  it('user-A upload is not visible when queried as user-B', async () => {
    const app = await buildFilesApp()
    const file = {
      threadId: 'shared-thread',
      name: 'secret.txt',
      mimeType: 'text/plain',
      content: btoa('User A secret'),
      size: 13,
    }

    // User A uploads a file
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'x-user-id': 'user-alice' },
      payload: file,
    })
    expect(uploadRes.statusCode).toBe(201)

    // User B queries the same threadId — should see no files
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/files?threadId=shared-thread',
      headers: { 'x-user-id': 'user-bob' },
    })
    expect(listRes.statusCode).toBe(200)
    const body = JSON.parse(listRes.payload)
    expect(body.files).toHaveLength(0)
  })

  it('user-A can retrieve their own files for a thread', async () => {
    const app = await buildFilesApp()
    const file = {
      threadId: 'alice-thread',
      name: 'note.txt',
      mimeType: 'text/plain',
      content: btoa('Alice note'),
      size: 10,
    }

    await app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'x-user-id': 'user-alice' },
      payload: file,
    })

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/files?threadId=alice-thread',
      headers: { 'x-user-id': 'user-alice' },
    })
    expect(listRes.statusCode).toBe(200)
    const body = JSON.parse(listRes.payload)
    expect(body.files).toHaveLength(1)
    expect(body.files[0].name).toBe('note.txt')
  })

  it('two users uploading to the same threadId have separate file lists', async () => {
    const app = await buildFilesApp()
    const baseFile = {
      threadId: 'collab-thread',
      mimeType: 'text/plain',
      size: 5,
    }

    await app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'x-user-id': 'user-alice' },
      payload: { ...baseFile, name: 'alice.txt', content: btoa('alice') },
    })
    await app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'x-user-id': 'user-bob' },
      payload: { ...baseFile, name: 'bob.txt', content: btoa('bob  ') },
    })

    const aliceRes = await app.inject({
      method: 'GET',
      url: '/api/files?threadId=collab-thread',
      headers: { 'x-user-id': 'user-alice' },
    })
    const bobRes = await app.inject({
      method: 'GET',
      url: '/api/files?threadId=collab-thread',
      headers: { 'x-user-id': 'user-bob' },
    })

    const aliceFiles = JSON.parse(aliceRes.payload).files as Array<{ name: string }>
    const bobFiles = JSON.parse(bobRes.payload).files as Array<{ name: string }>

    expect(aliceFiles.map((f) => f.name)).toContain('alice.txt')
    expect(aliceFiles.map((f) => f.name)).not.toContain('bob.txt')
    expect(bobFiles.map((f) => f.name)).toContain('bob.txt')
    expect(bobFiles.map((f) => f.name)).not.toContain('alice.txt')
  })

  it('default userId falls back to CHAT_DEFAULT_USER_ID when no header is set', async () => {
    const app = await buildFilesApp()
    const file = {
      threadId: 'default-thread',
      name: 'default.txt',
      mimeType: 'text/plain',
      content: btoa('default'),
      size: 7,
    }

    await app.inject({ method: 'POST', url: '/api/files', payload: file })

    // Query without header — also falls back to default 'me'
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/files?threadId=default-thread',
    })
    expect(listRes.statusCode).toBe(200)
    const body = JSON.parse(listRes.payload)
    expect(body.files).toHaveLength(1)
    expect(body.files[0].name).toBe('default.txt')
  })
})

// ---------------------------------------------------------------------------
// Chat / conversation persistence isolation (#85, #87)
// ---------------------------------------------------------------------------
describe('Chat workspace ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MOCK_REGISTRY.sendChatWithChain.mockResolvedValue({
      response: {
        id: 'resp-1',
        model: 'local-model',
        message: { role: 'assistant', content: 'Hello!' },
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      },
      usedProvider: 'lm-studio-a',
    })
  })

  it('upsertConversation is called with the requesting user\'s userId', async () => {
    const app = await buildChatApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'x-user-id': 'user-alice' },
      payload: {
        agentId: 'local-analyst',
        threadId: 'alice-conv',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(200)
    // Allow async persistence to complete
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockUpsertConversation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-alice', id: 'alice-conv' }),
    )
  })

  it('persistUsageLog is called with the requesting user\'s userId', async () => {
    const app = await buildChatApp()

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'x-user-id': 'user-bob' },
      payload: {
        agentId: 'local-analyst',
        threadId: 'bob-conv',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockPersistUsageLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-bob' }),
    )
  })

  it('different users writing to the same threadId record separate userId values', async () => {
    const app = await buildChatApp()

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'x-user-id': 'user-alice' },
      payload: {
        agentId: 'local-analyst',
        threadId: 'shared-thread',
        messages: [{ role: 'user', content: 'Alice message' }],
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const aliceCall = mockUpsertConversation.mock.calls[0]

    vi.clearAllMocks()

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'x-user-id': 'user-bob' },
      payload: {
        agentId: 'local-analyst',
        threadId: 'shared-thread',
        messages: [{ role: 'user', content: 'Bob message' }],
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const bobCall = mockUpsertConversation.mock.calls[0]

    expect(aliceCall[1].userId).toBe('user-alice')
    expect(bobCall[1].userId).toBe('user-bob')
  })

  it('falls back to CHAT_DEFAULT_USER_ID when no identity header is present', async () => {
    const app = await buildChatApp()

    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        agentId: 'local-analyst',
        threadId: 'anon-thread',
        messages: [{ role: 'user', content: 'Anonymous' }],
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockUpsertConversation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'me' }),
    )
  })
})
