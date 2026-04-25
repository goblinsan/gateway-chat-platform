import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import orchestrationRoutes from '../routes/orchestration'

const mockApproveAgentServiceApproval = vi.fn()
const mockDenyAgentServiceApproval = vi.fn()
const mockFetchAgentServiceRun = vi.fn()

vi.mock('../services/agentServiceClient', () => ({
  approveAgentServiceApproval: (...args: unknown[]) => mockApproveAgentServiceApproval(...args),
  denyAgentServiceApproval: (...args: unknown[]) => mockDenyAgentServiceApproval(...args),
  fetchAgentServiceRun: (...args: unknown[]) => mockFetchAgentServiceRun(...args),
}))

describe('orchestration approval routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
