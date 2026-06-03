import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/env', () => ({
  getEnv: () => ({
    CF_ACCESS_TEAM_DOMAIN: undefined,
    CF_ACCESS_AUD: undefined,
    CHAT_DEFAULT_USER_ID: 'me',
  }),
}))

const mockFetchPlans = vi.fn()
const mockFetchPlan = vi.fn()
const mockUpsertPlan = vi.fn()
const mockImportPlan = vi.fn()
const mockDeletePlan = vi.fn()

vi.mock('../services/agentServiceClient', () => ({
  AgentServiceError: class AgentServiceError extends Error {
    constructor(message: string, public readonly statusCode?: number) {
      super(message)
      this.name = 'AgentServiceError'
    }
  },
  fetchPlansFromAgentService: (...args: unknown[]) => mockFetchPlans(...args),
  fetchPlanFromAgentService: (...args: unknown[]) => mockFetchPlan(...args),
  upsertPlanInAgentService: (...args: unknown[]) => mockUpsertPlan(...args),
  importPlanInAgentService: (...args: unknown[]) => mockImportPlan(...args),
  deletePlanInAgentService: (...args: unknown[]) => mockDeletePlan(...args),
}))

import userIdentityPlugin from '../plugins/userIdentity'
import planRoutes from '../routes/plans'
import { AgentServiceError } from '../services/agentServiceClient'

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(userIdentityPlugin)
  await app.register(planRoutes, { prefix: '/api' })
  return app
}

const PLAN_ROW = {
  id: 'plan-1',
  user_id: 'alice',
  title: 'Shipping plan tracker',
  vision: 'Unified planning',
  status: 'active',
  category: 'product',
  review_cadence: 'Weekly',
  tags: ['planning'],
  data_sources: ['chat-ui'],
  metrics: { 'Open tasks': '3' },
  progress: {
    percent_complete: 56,
    next_review_at: '2026-06-01T00:00:00.000Z',
  },
  created_at: '2026-05-27T00:00:00.000Z',
  updated_at: '2026-05-27T00:00:00.000Z',
  milestones: [
    {
      id: 'milestone-1',
      title: 'MVP',
      status: 'active',
      summary: 'Ship the first tracker slice',
      tasks: [
        {
          id: 'task-1',
          title: 'Build list',
          notes: 'Focus on sidebar layout',
          status: 'todo',
        },
      ],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchPlans.mockResolvedValue([PLAN_ROW])
  mockFetchPlan.mockResolvedValue(PLAN_ROW)
  mockUpsertPlan.mockResolvedValue(PLAN_ROW)
  mockImportPlan.mockResolvedValue(PLAN_ROW)
  mockDeletePlan.mockResolvedValue(undefined)
})

describe('GET /api/plans', () => {
  it('returns user plan hierarchy from agent-service', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/plans',
      headers: { 'x-user-id': 'alice' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.plans).toHaveLength(1)
    expect(body.plans[0].title).toBe('Shipping plan tracker')
    expect(body.plans[0].milestones[0].tasks[0].title).toBe('Build list')
    expect(mockFetchPlans).toHaveBeenCalledWith('alice')
  })
})

describe('POST /api/plans', () => {
  it('creates plan for caller through agent-service', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      headers: { 'x-user-id': 'alice' },
      payload: { title: 'Shipping plan tracker', tags: ['planning'] },
    })

    expect(res.statusCode).toBe(201)
    expect(mockUpsertPlan).toHaveBeenCalledWith('alice', expect.objectContaining({
      title: 'Shipping plan tracker',
      tags: ['planning'],
      milestones: [],
    }))
  })
})

describe('POST /api/plans/import', () => {
  it('imports a structured plan document through agent-service', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/plans/import',
      payload: {
        title: 'Endurance Plan',
        source: 'endurance-yaml',
        text: 'title: Endurance Plan\ncategory: health\nmilestones:\n  - title: Week 1',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(mockImportPlan).toHaveBeenCalledWith('me', expect.objectContaining({
      title: 'Endurance Plan',
      source: 'endurance-yaml',
    }))
    expect(response.body).toContain('"title":"Shipping plan tracker"')
  })

  it('updates an existing plan when planId is provided', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/plans/import',
      headers: { 'x-user-id': 'alice' },
      payload: {
        planId: 'plan-1',
        title: 'Shipping plan tracker',
        source: 'shipping-plan.json',
        text: '{"title":"Shipping plan tracker"}',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(mockImportPlan).toHaveBeenCalledWith('alice', expect.objectContaining({
      id: 'plan-1',
      title: 'Shipping plan tracker',
      source: 'shipping-plan.json',
    }))
  })

  it('surfaces structured import validation errors instead of masking them as 502', async () => {
    mockImportPlan.mockRejectedValueOnce(new AgentServiceError('agent-service returned 400: {"error":"failed to parse structured plan document \\"endurance.yaml\\": yaml: line 5: mapping values are not allowed in this context. Fix the YAML/JSON formatting and try again. For YAML, quote values containing \':\' such as task titles"}', 400))
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/plans/import',
      payload: {
        title: 'endurance.yaml',
        source: 'endurance.yaml',
        text: 'title: Endurance Plan\nmilestones:\n  - title: Week 1\n    tasks:\n      - title: Monday: 3 easy miles\n',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.body).toContain('Fix the YAML/JSON formatting')
    expect(response.body).not.toContain('agent-service returned 400:')
  })
})

describe('GET /api/plans/:planId/export', () => {
  it('exports the durable plan document with rich metadata preserved', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/plans/plan-1/export',
      headers: { 'x-user-id': 'alice' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockFetchPlan).toHaveBeenCalledWith('alice', 'plan-1')
    expect(response.headers['content-type']).toContain('application/json')
    const body = JSON.parse(response.body)
    expect(body.filename).toBe('shipping-plan-tracker-plan-1.json')
    expect(body.document).toContain('"data_sources"')
    expect(body.document).toContain('"milestones"')
    expect(body.document).toContain('"tasks"')
  })
})

describe('PUT /api/plans/:planId', () => {
  it('updates an owned plan through agent-service', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/plans/plan-1',
      headers: { 'x-user-id': 'alice' },
      payload: { title: 'Changed' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockFetchPlan).toHaveBeenCalledWith('alice', 'plan-1')
    expect(mockUpsertPlan).toHaveBeenCalledWith('alice', expect.objectContaining({
      id: 'plan-1',
      title: 'Changed',
    }))
  })
})

describe('milestones and tasks', () => {
  it('creates milestone and task under owned plan', async () => {
    const app = await buildApp()
    const milestoneRes = await app.inject({
      method: 'POST',
      url: '/api/plans/plan-1/milestones',
      headers: { 'x-user-id': 'alice' },
      payload: { title: 'MVP' },
    })
    expect(milestoneRes.statusCode).toBe(201)
    expect(mockUpsertPlan).toHaveBeenCalled()

    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/plans/plan-1/milestones/milestone-1/tasks',
      headers: { 'x-user-id': 'alice' },
      payload: { title: 'Build list' },
    })
    expect(taskRes.statusCode).toBe(201)
    expect(mockUpsertPlan).toHaveBeenCalled()
  })

  it('deletes owned task by rewriting the durable plan', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/plans/plan-1/milestones/milestone-1/tasks/task-1',
      headers: { 'x-user-id': 'alice' },
    })
    expect(res.statusCode).toBe(204)
    expect(mockUpsertPlan).toHaveBeenCalledWith('alice', expect.objectContaining({
      id: 'plan-1',
      milestones: [expect.objectContaining({ tasks: [] })],
    }))
  })
})
