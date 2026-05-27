import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type {
  PlanGoal,
  PlanMetric,
  PlanMilestone,
  PlanStatus,
  PlanTask,
  CreatePlanRequest,
  UpdatePlanRequest,
  CreatePlanMilestoneRequest,
  UpdatePlanMilestoneRequest,
  CreatePlanTaskRequest,
  UpdatePlanTaskRequest,
} from '@gateway/shared'
import { getPrismaClient } from '../services/db'

const STATUS_VALUES: PlanStatus[] = ['on_track', 'at_risk', 'blocked', 'complete']

function clampProgress(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, Math.round(value)))
}

function isStatus(value: unknown): value is PlanStatus {
  return typeof value === 'string' && STATUS_VALUES.includes(value as PlanStatus)
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toMetrics(input: unknown): PlanMetric[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      label: typeof item.label === 'string' ? item.label.trim() : '',
      value: typeof item.value === 'string' ? item.value.trim() : '',
    }))
    .filter((item) => item.label.length > 0 && item.value.length > 0)
}

function parseDate(input: unknown): Date | null | undefined {
  if (input === undefined) return undefined
  if (input === null || input === '') return null
  if (typeof input !== 'string') return undefined
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

function parseJsonString<T>(input: string | null): T {
  if (!input) return [] as T
  try {
    return JSON.parse(input) as T
  } catch {
    return [] as T
  }
}

function toTaskModel(task: {
  id: string
  milestoneId: string
  title: string
  notes: string | null
  status: string
  progressPercent: number
  orderIndex: number
  createdAt: Date
  updatedAt: Date
}): PlanTask {
  return {
    id: task.id,
    milestoneId: task.milestoneId,
    title: task.title,
    notes: task.notes ?? undefined,
    status: isStatus(task.status) ? task.status : 'on_track',
    progressPercent: clampProgress(task.progressPercent) ?? 0,
    orderIndex: task.orderIndex,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

function toMilestoneModel(milestone: {
  id: string
  planId: string
  title: string
  notes: string | null
  status: string
  progressPercent: number
  orderIndex: number
  createdAt: Date
  updatedAt: Date
  tasks?: Array<{
    id: string
    milestoneId: string
    title: string
    notes: string | null
    status: string
    progressPercent: number
    orderIndex: number
    createdAt: Date
    updatedAt: Date
  }>
}): PlanMilestone {
  return {
    id: milestone.id,
    planId: milestone.planId,
    title: milestone.title,
    notes: milestone.notes ?? undefined,
    status: isStatus(milestone.status) ? milestone.status : 'on_track',
    progressPercent: clampProgress(milestone.progressPercent) ?? 0,
    orderIndex: milestone.orderIndex,
    createdAt: milestone.createdAt.toISOString(),
    updatedAt: milestone.updatedAt.toISOString(),
    tasks: (milestone.tasks ?? []).map(toTaskModel),
  }
}

function toPlanModel(plan: {
  id: string
  userId: string
  title: string
  vision: string | null
  status: string
  progressPercent: number
  category: string | null
  reviewCadence: string | null
  nextReviewAt: Date | null
  tagsJson: string | null
  sourceSystemsJson: string | null
  metricsJson: string | null
  createdAt: Date
  updatedAt: Date
  milestones?: Array<{
    id: string
    planId: string
    title: string
    notes: string | null
    status: string
    progressPercent: number
    orderIndex: number
    createdAt: Date
    updatedAt: Date
    tasks?: Array<{
      id: string
      milestoneId: string
      title: string
      notes: string | null
      status: string
      progressPercent: number
      orderIndex: number
      createdAt: Date
      updatedAt: Date
    }>
  }>
}): PlanGoal {
  return {
    id: plan.id,
    userId: plan.userId,
    title: plan.title,
    vision: plan.vision ?? undefined,
    status: isStatus(plan.status) ? plan.status : 'on_track',
    progressPercent: clampProgress(plan.progressPercent) ?? 0,
    category: plan.category ?? undefined,
    reviewCadence: plan.reviewCadence ?? undefined,
    nextReviewAt: plan.nextReviewAt?.toISOString(),
    tags: toStringArray(parseJsonString<unknown[]>(plan.tagsJson)),
    sourceSystems: toStringArray(parseJsonString<unknown[]>(plan.sourceSystemsJson)),
    metrics: toMetrics(parseJsonString<unknown[]>(plan.metricsJson)),
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    milestones: (plan.milestones ?? []).map(toMilestoneModel),
  }
}

export default async function planRoutes(app: FastifyInstance) {
  const prisma = getPrismaClient()

  app.get('/plans', async (req, reply) => {
    const plans = await prisma.plan.findMany({
      where: { userId: req.userId },
      include: {
        milestones: {
          orderBy: { orderIndex: 'asc' },
          include: { tasks: { orderBy: { orderIndex: 'asc' } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })
    return reply.send({ plans: plans.map(toPlanModel) })
  })

  app.post<{ Body: CreatePlanRequest }>(
    '/plans',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            vision: { type: 'string', maxLength: 5000 },
            status: { type: 'string', enum: STATUS_VALUES },
            progressPercent: { type: 'number', minimum: 0, maximum: 100 },
            category: { type: 'string', maxLength: 100 },
            reviewCadence: { type: 'string', maxLength: 100 },
            nextReviewAt: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            sourceSystems: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            metrics: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                required: ['label', 'value'],
                properties: {
                  label: { type: 'string', minLength: 1, maxLength: 120 },
                  value: { type: 'string', minLength: 1, maxLength: 240 },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const parsedDate = parseDate(req.body.nextReviewAt)
      if (req.body.nextReviewAt !== undefined && parsedDate === undefined) {
        return reply.status(400).send({ error: 'Invalid nextReviewAt timestamp' })
      }

      const row = await prisma.plan.create({
        data: {
          id: randomUUID(),
          userId: req.userId,
          title: req.body.title.trim(),
          vision: req.body.vision?.trim() || null,
          status: isStatus(req.body.status) ? req.body.status : 'on_track',
          progressPercent: clampProgress(req.body.progressPercent) ?? 0,
          category: req.body.category?.trim() || null,
          reviewCadence: req.body.reviewCadence?.trim() || null,
          nextReviewAt: parsedDate ?? null,
          tagsJson: JSON.stringify(toStringArray(req.body.tags)),
          sourceSystemsJson: JSON.stringify(toStringArray(req.body.sourceSystems)),
          metricsJson: JSON.stringify(toMetrics(req.body.metrics)),
        },
        include: { milestones: { include: { tasks: true }, orderBy: { orderIndex: 'asc' } } },
      })
      return reply.status(201).send({ plan: toPlanModel(row) })
    },
  )

  app.put<{ Params: { planId: string }; Body: UpdatePlanRequest }>(
    '/plans/:planId',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            vision: { type: 'string', maxLength: 5000 },
            status: { type: 'string', enum: STATUS_VALUES },
            progressPercent: { type: 'number', minimum: 0, maximum: 100 },
            category: { type: 'string', maxLength: 100 },
            reviewCadence: { type: 'string', maxLength: 100 },
            nextReviewAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            sourceSystems: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            metrics: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                required: ['label', 'value'],
                properties: {
                  label: { type: 'string', minLength: 1, maxLength: 120 },
                  value: { type: 'string', minLength: 1, maxLength: 240 },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const existing = await prisma.plan.findFirst({
        where: { id: req.params.planId, userId: req.userId },
      })
      if (!existing) {
        return reply.status(404).send({ error: 'Plan not found' })
      }

      const parsedDate = parseDate(req.body.nextReviewAt)
      if (req.body.nextReviewAt !== undefined && parsedDate === undefined) {
        return reply.status(400).send({ error: 'Invalid nextReviewAt timestamp' })
      }

      const row = await prisma.plan.update({
        where: { id: req.params.planId },
        data: {
          ...(req.body.title !== undefined && { title: req.body.title.trim() }),
          ...(req.body.vision !== undefined && { vision: req.body.vision?.trim() || null }),
          ...(req.body.status !== undefined && { status: isStatus(req.body.status) ? req.body.status : existing.status }),
          ...(req.body.progressPercent !== undefined && { progressPercent: clampProgress(req.body.progressPercent) ?? existing.progressPercent }),
          ...(req.body.category !== undefined && { category: req.body.category?.trim() || null }),
          ...(req.body.reviewCadence !== undefined && { reviewCadence: req.body.reviewCadence?.trim() || null }),
          ...(req.body.nextReviewAt !== undefined && { nextReviewAt: parsedDate ?? null }),
          ...(req.body.tags !== undefined && { tagsJson: JSON.stringify(toStringArray(req.body.tags)) }),
          ...(req.body.sourceSystems !== undefined && { sourceSystemsJson: JSON.stringify(toStringArray(req.body.sourceSystems)) }),
          ...(req.body.metrics !== undefined && { metricsJson: JSON.stringify(toMetrics(req.body.metrics)) }),
          updatedAt: new Date(),
        },
        include: {
          milestones: {
            orderBy: { orderIndex: 'asc' },
            include: { tasks: { orderBy: { orderIndex: 'asc' } } },
          },
        },
      })
      return reply.send({ plan: toPlanModel(row) })
    },
  )

  app.delete<{ Params: { planId: string } }>('/plans/:planId', async (req, reply) => {
    const existing = await prisma.plan.findFirst({
      where: { id: req.params.planId, userId: req.userId },
      select: { id: true },
    })
    if (!existing) {
      return reply.status(404).send({ error: 'Plan not found' })
    }
    await prisma.plan.delete({ where: { id: req.params.planId } })
    return reply.status(204).send()
  })

  app.post<{ Params: { planId: string }; Body: CreatePlanMilestoneRequest }>(
    '/plans/:planId/milestones',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            notes: { type: 'string', maxLength: 5000 },
            status: { type: 'string', enum: STATUS_VALUES },
            progressPercent: { type: 'number', minimum: 0, maximum: 100 },
            orderIndex: { type: 'integer', minimum: 0, maximum: 1000000 },
          },
        },
      },
    },
    async (req, reply) => {
      const plan = await prisma.plan.findFirst({
        where: { id: req.params.planId, userId: req.userId },
      })
      if (!plan) {
        return reply.status(404).send({ error: 'Plan not found' })
      }
      const existingCount = await prisma.planMilestone.count({ where: { planId: plan.id } })
      const row = await prisma.planMilestone.create({
        data: {
          id: randomUUID(),
          planId: plan.id,
          title: req.body.title.trim(),
          notes: req.body.notes?.trim() || null,
          status: isStatus(req.body.status) ? req.body.status : 'on_track',
          progressPercent: clampProgress(req.body.progressPercent) ?? 0,
          orderIndex: req.body.orderIndex ?? existingCount,
        },
        include: { tasks: { orderBy: { orderIndex: 'asc' } } },
      })
      return reply.status(201).send({ milestone: toMilestoneModel(row) })
    },
  )

  app.put<{ Params: { planId: string; milestoneId: string }; Body: UpdatePlanMilestoneRequest }>(
    '/plans/:planId/milestones/:milestoneId',
    async (req, reply) => {
      const milestone = await prisma.planMilestone.findFirst({
        where: {
          id: req.params.milestoneId,
          planId: req.params.planId,
          plan: { userId: req.userId },
        },
      })
      if (!milestone) {
        return reply.status(404).send({ error: 'Milestone not found' })
      }
      const row = await prisma.planMilestone.update({
        where: { id: milestone.id },
        data: {
          ...(req.body.title !== undefined && { title: req.body.title.trim() }),
          ...(req.body.notes !== undefined && { notes: req.body.notes?.trim() || null }),
          ...(req.body.status !== undefined && { status: isStatus(req.body.status) ? req.body.status : milestone.status }),
          ...(req.body.progressPercent !== undefined && { progressPercent: clampProgress(req.body.progressPercent) ?? milestone.progressPercent }),
          ...(req.body.orderIndex !== undefined && { orderIndex: req.body.orderIndex }),
          updatedAt: new Date(),
        },
        include: { tasks: { orderBy: { orderIndex: 'asc' } } },
      })
      return reply.send({ milestone: toMilestoneModel(row) })
    },
  )

  app.delete<{ Params: { planId: string; milestoneId: string } }>(
    '/plans/:planId/milestones/:milestoneId',
    async (req, reply) => {
      const milestone = await prisma.planMilestone.findFirst({
        where: {
          id: req.params.milestoneId,
          planId: req.params.planId,
          plan: { userId: req.userId },
        },
      })
      if (!milestone) {
        return reply.status(404).send({ error: 'Milestone not found' })
      }
      await prisma.planMilestone.delete({ where: { id: milestone.id } })
      return reply.status(204).send()
    },
  )

  app.post<{ Params: { planId: string; milestoneId: string }; Body: CreatePlanTaskRequest }>(
    '/plans/:planId/milestones/:milestoneId/tasks',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            notes: { type: 'string', maxLength: 5000 },
            status: { type: 'string', enum: STATUS_VALUES },
            progressPercent: { type: 'number', minimum: 0, maximum: 100 },
            orderIndex: { type: 'integer', minimum: 0, maximum: 1000000 },
          },
        },
      },
    },
    async (req, reply) => {
      const milestone = await prisma.planMilestone.findFirst({
        where: {
          id: req.params.milestoneId,
          planId: req.params.planId,
          plan: { userId: req.userId },
        },
      })
      if (!milestone) {
        return reply.status(404).send({ error: 'Milestone not found' })
      }
      const existingCount = await prisma.planTask.count({ where: { milestoneId: milestone.id } })
      const row = await prisma.planTask.create({
        data: {
          id: randomUUID(),
          milestoneId: milestone.id,
          title: req.body.title.trim(),
          notes: req.body.notes?.trim() || null,
          status: isStatus(req.body.status) ? req.body.status : 'on_track',
          progressPercent: clampProgress(req.body.progressPercent) ?? 0,
          orderIndex: req.body.orderIndex ?? existingCount,
        },
      })
      return reply.status(201).send({ task: toTaskModel(row) })
    },
  )

  app.put<{ Params: { planId: string; milestoneId: string; taskId: string }; Body: UpdatePlanTaskRequest }>(
    '/plans/:planId/milestones/:milestoneId/tasks/:taskId',
    async (req, reply) => {
      const task = await prisma.planTask.findFirst({
        where: {
          id: req.params.taskId,
          milestoneId: req.params.milestoneId,
          milestone: {
            planId: req.params.planId,
            plan: { userId: req.userId },
          },
        },
      })
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' })
      }
      const row = await prisma.planTask.update({
        where: { id: task.id },
        data: {
          ...(req.body.title !== undefined && { title: req.body.title.trim() }),
          ...(req.body.notes !== undefined && { notes: req.body.notes?.trim() || null }),
          ...(req.body.status !== undefined && { status: isStatus(req.body.status) ? req.body.status : task.status }),
          ...(req.body.progressPercent !== undefined && { progressPercent: clampProgress(req.body.progressPercent) ?? task.progressPercent }),
          ...(req.body.orderIndex !== undefined && { orderIndex: req.body.orderIndex }),
          updatedAt: new Date(),
        },
      })
      return reply.send({ task: toTaskModel(row) })
    },
  )

  app.delete<{ Params: { planId: string; milestoneId: string; taskId: string } }>(
    '/plans/:planId/milestones/:milestoneId/tasks/:taskId',
    async (req, reply) => {
      const task = await prisma.planTask.findFirst({
        where: {
          id: req.params.taskId,
          milestoneId: req.params.milestoneId,
          milestone: {
            planId: req.params.planId,
            plan: { userId: req.userId },
          },
        },
      })
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' })
      }
      await prisma.planTask.delete({ where: { id: task.id } })
      return reply.status(204).send()
    },
  )
}
