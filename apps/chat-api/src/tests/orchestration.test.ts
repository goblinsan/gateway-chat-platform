import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import orchestrationRoutes from '../routes/orchestration'

const mockApproveAgentServiceApproval = vi.fn()
const mockDenyAgentServiceApproval = vi.fn()
const mockFetchAgentServiceRun = vi.fn()
const mockUpsertConversation = vi.fn()
const mockPersistMessage = vi.fn()
const mockSyncAgentConversationToNotes = vi.fn()
const mockGetAgent = vi.fn()
const mockPrisma = {
  userPersona: {
    findFirst: vi.fn(),
  },
}

vi.mock('../services/agentServiceClient', () => ({
  approveAgentServiceApproval: (...args: unknown[]) => mockApproveAgentServiceApproval(...args),
  denyAgentServiceApproval: (...args: unknown[]) => mockDenyAgentServiceApproval(...args),
  fetchAgentServiceRun: (...args: unknown[]) => mockFetchAgentServiceRun(...args),
}))

vi.mock('../services/persistence', () => ({
  upsertConversation: (...args: unknown[]) => mockUpsertConversation(...args),
  persistMessage: (...args: unknown[]) => mockPersistMessage(...args),
}))

vi.mock('../services/notesSync', () => ({
  syncAgentConversationToNotes: (...args: unknown[]) => mockSyncAgentConversationToNotes(...args),
}))

vi.mock('../agents/registry', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
}))

vi.mock('../services/db', () => ({
  getPrismaClient: () => mockPrisma,
}))

describe('orchestration approval routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.userPersona.findFirst.mockResolvedValue(null)
  })

  it('approves an orchestration and returns the completed run result', async () => {
    mockApproveAgentServiceApproval.mockResolvedValue(undefined)
    mockFetchAgentServiceRun.mockResolvedValue({
      ID: 'run-1',
      Status: 'completed',
      Response: 'Approved result.',
      ModelBackend: 'local-model',
    })

    const app = Fastify()
    await app.register(orchestrationRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/orchestrations/approvals/appr-1/approve',
      payload: { runId: 'run-1' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockApproveAgentServiceApproval).toHaveBeenCalledWith('appr-1')
    expect(mockFetchAgentServiceRun).toHaveBeenCalledWith('run-1')
    const body = JSON.parse(res.payload)
    expect(body.content).toBe('Approved result.')
    expect(body.status).toBe('completed')
  })

  it('denies an orchestration and returns the settled run result', async () => {
    mockDenyAgentServiceApproval.mockResolvedValue(undefined)
    mockFetchAgentServiceRun.mockResolvedValue({
      ID: 'run-2',
      Status: 'failed',
      Response: '',
      ModelBackend: 'local-model',
    })

    const app = Fastify()
    await app.register(orchestrationRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/orchestrations/approvals/appr-2/deny',
      payload: { runId: 'run-2', reason: 'Not safe' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockDenyAgentServiceApproval).toHaveBeenCalledWith('appr-2', 'Not safe')
    const body = JSON.parse(res.payload)
    expect(body.status).toBe('failed')
  })

  it('returns 502 when approval forwarding fails', async () => {
    mockApproveAgentServiceApproval.mockRejectedValue(new Error('agent-service unavailable'))

    const app = Fastify()
    await app.register(orchestrationRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/orchestrations/approvals/appr-1/approve',
      payload: { runId: 'run-1' },
    })

    expect(res.statusCode).toBe(502)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('unavailable')
  })

  it('persists approved chat completions and syncs them to notes when thread context is supplied', async () => {
    mockApproveAgentServiceApproval.mockResolvedValue(undefined)
    mockFetchAgentServiceRun.mockResolvedValue({
      ID: 'run-3',
      Status: 'completed',
      Response: 'Resumed assistant reply.',
      ModelBackend: 'local-model',
    })
    mockGetAgent.mockReturnValue({
      id: 'coach-agent',
      name: 'Coach',
      icon: 'C',
      color: '#000',
      providerName: 'agent-service',
      model: 'local-model',
      costClass: 'free',
      enabled: true,
      source: 'registry',
    })

    const app = Fastify()
    app.decorateRequest('userId', 'me')
    app.addHook('onRequest', async (req) => {
      req.userId = 'me'
    })
    await app.register(orchestrationRoutes, { prefix: '/api' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/orchestrations/approvals/appr-3/approve',
      payload: {
        runId: 'run-3',
        threadId: 'thread-3',
        agentId: 'coach-agent',
        userMessage: 'Please continue.',
        assistantMessageId: 'assistant-msg-3',
        threadTitle: 'Coach thread',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockUpsertConversation).toHaveBeenCalled()
    expect(mockPersistMessage).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        id: 'assistant-msg-3',
        conversationId: 'thread-3',
        role: 'assistant',
        content: 'Resumed assistant reply.',
        provider: 'agent-service',
      }),
    )
    expect(mockSyncAgentConversationToNotes).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'coach-agent' }),
      expect.objectContaining({
        threadId: 'thread-3',
        userMessage: 'Please continue.',
        assistantMessage: 'Resumed assistant reply.',
      }),
    )
  })
})
