import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/env', () => ({
  getEnv: () => ({
    CF_ACCESS_TEAM_DOMAIN: undefined,
    CF_ACCESS_AUD: undefined,
    CHAT_DEFAULT_USER_ID: 'me',
  }),
}))

const mockPlanFindMany = vi.fn()
const mockPlanCreate = vi.fn()
const mockPlanFindFirst = vi.fn()
const mockPlanUpdate = vi.fn()
const mockPlanDelete = vi.fn()

const mockMilestoneCount = vi.fn()
const mockMilestoneCreate = vi.fn()
const mockMilestoneFindFirst = vi.fn()
const mockMilestoneUpdate = vi.fn()
const mockMilestoneDelete = vi.fn()

const mockTaskCount = vi.fn()
const mockTaskCreate = vi.fn()
const mockTaskFindFirst = vi.fn()
const mockTaskUpdate = vi.fn()
const mockTaskDelete = vi.fn()

vi.mock('../services/db', () => ({
  getPrismaClient: () => ({
    plan: {
      findMany: (...args: unknown[]) => mockPlanFindMany(...args),
      create: (...args: unknown[]) => mockPlanCreate(...args),
      findFirst: (...args: unknown[]) => mockPlanFindFirst(...args),
      update: (...args: unknown[]) => mockPlanUpdate(...args),
      delete: (...args: unknown[]) => mockPlanDelete(...args),
    },
    planMilestone: {
      count: (...args: unknown[]) => mockMilestoneCount(...args),
      create: (...args: unknown[]) => mockMilestoneCreate(...args),
      findFirst: (...args: unknown[]) => mockMilestoneFindFirst(...args),
      update: (...args: unknown[]) => mockMilestoneUpdate(...args),
      delete: (...args: unknown[]) => mockMilestoneDelete(...args),
    },
    planTask: {
      count: (...args: unknown[]) => mockTaskCount(...args),
      create: (...args: unknown[]) => mockTaskCreate(...args),
      findFirst: (...args: unknown[]) => mockTaskFindFirst(...args),
      update: (...args: unknown[]) => mockTaskUpdate(...args),
      delete: (...args: unknown[]) => mockTaskDelete(...args),
    },
  }),
}))

import userIdentityPlugin from '../plugins/userIdentity'
import planRoutes from '../routes/plans'

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(userIdentityPlugin)
  await app.register(planRoutes, { prefix: '/api' })
  return app
}

const TASK_ROW = {
  id: 'task-1',
  milestoneId: 'milestone-1',
  title: 'Build list',
  notes: null,
  status: 'on_track',
  progressPercent: 30,
  orderIndex: 0,
  createdAt: new Date('2026-05-27T00:00:00.000Z'),
  updatedAt: new Date('2026-05-27T00:00:00.000Z'),
}

const MILESTONE_ROW = {
  id: 'milestone-1',
  planId: 'plan-1',
  title: 'MVP',
  notes: null,
  status: 'on_track',
  progressPercent: 45,
  orderIndex: 0,
  createdAt: new Date('2026-05-27T00:00:00.000Z'),
  updatedAt: new Date('2026-05-27T00:00:00.000Z'),
  tasks: [TASK_ROW],
}

const PLAN_ROW = {
  id: 'plan-1',
  userId: 'alice',
  title: 'Shipping plan tracker',
  vision: 'Unified planning',
  status: 'on_track',
  progressPercent: 56,
  category: 'product',
  reviewCadence: 'Weekly',
  nextReviewAt: new Date('2026-06-01T00:00:00.000Z'),
  tagsJson: JSON.stringify(['planning']),
  sourceSystemsJson: JSON.stringify(['chat-ui']),
  metricsJson: JSON.stringify([{ label: 'Open tasks', value: '3' }]),
  createdAt: new Date('2026-05-27T00:00:00.000Z'),
  updatedAt: new Date('2026-05-27T00:00:00.000Z'),
  milestones: [MILESTONE_ROW],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPlanFindMany.mockResolvedValue([PLAN_ROW])
  mockPlanCreate.mockResolvedValue(PLAN_ROW)
  mockPlanFindFirst.mockResolvedValue(PLAN_ROW)
  mockPlanUpdate.mockResolvedValue(PLAN_ROW)
  mockPlanDelete.mockResolvedValue(undefined)

  mockMilestoneCount.mockResolvedValue(1)
  mockMilestoneCreate.mockResolvedValue(MILESTONE_ROW)
  mockMilestoneFindFirst.mockResolvedValue(MILESTONE_ROW)
  mockMilestoneUpdate.mockResolvedValue(MILESTONE_ROW)
  mockMilestoneDelete.mockResolvedValue(undefined)

  mockTaskCount.mockResolvedValue(1)
  mockTaskCreate.mockResolvedValue(TASK_ROW)
  mockTaskFindFirst.mockResolvedValue(TASK_ROW)
  mockTaskUpdate.mockResolvedValue(TASK_ROW)
  mockTaskDelete.mockResolvedValue(undefined)
})

describe('GET /api/plans', () => {
  it('returns user plan hierarchy', async () => {
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
    expect(mockPlanFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'alice' },
    }))
  })
})

describe('POST /api/plans', () => {
  it('creates plan for caller', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      headers: { 'x-user-id': 'alice' },
      payload: { title: 'Shipping plan tracker', tags: ['planning'] },
    })

    expect(res.statusCode).toBe(201)
    expect(mockPlanCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'alice',
        title: 'Shipping plan tracker',
      }),
    }))
  })
})

describe('PUT /api/plans/:planId', () => {
  it('returns 404 when plan not owned by user', async () => {
    mockPlanFindFirst.mockResolvedValueOnce(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/plans/plan-1',
      headers: { 'x-user-id': 'alice' },
      payload: { title: 'Changed' },
    })

    expect(res.statusCode).toBe(404)
    expect(mockPlanUpdate).not.toHaveBeenCalled()
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
    expect(mockMilestoneCreate).toHaveBeenCalled()

    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/plans/plan-1/milestones/milestone-1/tasks',
      headers: { 'x-user-id': 'alice' },
      payload: { title: 'Build list' },
    })
    expect(taskRes.statusCode).toBe(201)
    expect(mockTaskCreate).toHaveBeenCalled()
  })

  it('deletes owned task', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/plans/plan-1/milestones/milestone-1/tasks/task-1',
      headers: { 'x-user-id': 'alice' },
    })
    expect(res.statusCode).toBe(204)
    expect(mockTaskDelete).toHaveBeenCalledWith({ where: { id: 'task-1' } })
  })
})
