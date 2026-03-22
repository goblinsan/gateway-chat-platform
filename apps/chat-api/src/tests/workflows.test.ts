import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../agents/registry', () => {
  const AGENTS = [
    { id: 'local-analyst', name: 'Local Analyst', icon: '🔍', color: '#3b82f6', providerName: 'lm-studio-a', model: 'local-model', costClass: 'free', systemPrompt: 'analyst', temperature: 0.3, routingPolicy: { preferredProvider: 'lm-studio-a' }, enabled: true },
  ]
  return {
    listAgents: () => AGENTS,
    getAgent: (id: string) => AGENTS.find((a) => a.id === id),
    getAgentRegistry: () => ({ list: () => AGENTS, get: (id: string) => AGENTS.find((a) => a.id === id) }),
  }
})

const MOCK_REGISTRY = {
  sendChatWithChain: vi.fn().mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Workflow step result' },
      finishReason: 'stop',
    },
    usedProvider: 'lm-studio-a',
  }),
  getAll: vi.fn().mockReturnValue([{ name: 'lm-studio-a' }]),
}

vi.mock('../config/providerRegistry', () => ({
  getProviderRegistry: () => MOCK_REGISTRY,
}))

import Fastify from 'fastify'
import workflowsRoutes from '../routes/workflows'

beforeEach(() => {
  vi.clearAllMocks()
  MOCK_REGISTRY.sendChatWithChain.mockResolvedValue({
    response: {
      id: 'resp-1',
      model: 'local-model',
      message: { role: 'assistant', content: 'Workflow step result' },
      finishReason: 'stop',
    },
    usedProvider: 'lm-studio-a',
  })
  MOCK_REGISTRY.getAll.mockReturnValue([{ name: 'lm-studio-a' }])
})

const SAMPLE_WORKFLOW = {
  name: 'Test Workflow',
  description: 'A test',
  steps: [{ order: 0, agentId: 'local-analyst', prompt: 'Analyze this.' }],
}

describe('Workflows API', () => {
  it('GET /api/workflows returns empty array initially', async () => {
    const app = Fastify()
    await app.register(workflowsRoutes, { prefix: '/api' })
    const res = await app.inject({ method: 'GET', url: '/api/workflows' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(Array.isArray(body.workflows)).toBe(true)
  })

  it('POST /api/workflows creates workflow with id', async () => {
    const app = Fastify()
    await app.register(workflowsRoutes, { prefix: '/api' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: SAMPLE_WORKFLOW,
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.payload)
    expect(body.id).toBeDefined()
    expect(body.name).toBe('Test Workflow')
    expect(body.steps).toHaveLength(1)
  })

  it('DELETE /api/workflows/:id removes it', async () => {
    const app = Fastify()
    await app.register(workflowsRoutes, { prefix: '/api' })

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: SAMPLE_WORKFLOW,
    })
    const { id } = JSON.parse(createRes.payload) as { id: string }

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/workflows/${id}` })
    expect(deleteRes.statusCode).toBe(204)

    const getRes = await app.inject({ method: 'GET', url: '/api/workflows' })
    const body = JSON.parse(getRes.payload)
    expect(body.workflows.find((w: { id: string }) => w.id === id)).toBeUndefined()
  })

  it('POST /api/workflows/:id/run executes steps and returns results', async () => {
    const app = Fastify()
    await app.register(workflowsRoutes, { prefix: '/api' })

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: SAMPLE_WORKFLOW,
    })
    const { id } = JSON.parse(createRes.payload) as { id: string }

    const runRes = await app.inject({ method: 'POST', url: `/api/workflows/${id}/run` })
    expect(runRes.statusCode).toBe(200)
    const body = JSON.parse(runRes.payload)
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results[0].content).toBe('Workflow step result')
  })

  it('POST /api/workflows/:id/run returns 404 for unknown id', async () => {
    const app = Fastify()
    await app.register(workflowsRoutes, { prefix: '/api' })
    const res = await app.inject({ method: 'POST', url: '/api/workflows/nonexistent-id/run' })
    expect(res.statusCode).toBe(404)
  })
})
