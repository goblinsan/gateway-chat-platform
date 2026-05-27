import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreatePlanMilestoneRequest,
  CreatePlanRequest,
  CreatePlanTaskRequest,
  PlanGoal,
  PlanMetric,
  PlanMilestone,
  PlanStatus,
  PlanTask,
  UpdatePlanMilestoneRequest,
  UpdatePlanRequest,
  UpdatePlanTaskRequest,
} from '@gateway/shared'
import {
  AgentServiceError,
  type AgentServicePlan,
  type AgentServicePlanMilestone,
  type AgentServicePlanTask,
  deletePlanInAgentService,
  fetchPlanFromAgentService,
  fetchPlansFromAgentService,
  importPlanInAgentService,
  upsertPlanInAgentService,
} from '../services/agentServiceClient'

const STATUS_VALUES: PlanStatus[] = ['on_track', 'at_risk', 'blocked', 'complete']

function isStatus(value: unknown): value is PlanStatus {
  return typeof value === 'string' && STATUS_VALUES.includes(value as PlanStatus)
}

function clampProgress(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, Math.round(value)))
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toMetricsArray(input: Record<string, unknown> | undefined): PlanMetric[] {
  if (!input) return []
  return Object.entries(input)
    .map(([label, value]) => ({
      label: label.trim(),
      value: typeof value === 'string' ? value.trim() : JSON.stringify(value),
    }))
    .filter((metric) => metric.label.length > 0 && metric.value.length > 0)
}

function toMetricsObject(input: PlanMetric[] | undefined): Record<string, unknown> {
  const metrics: Record<string, unknown> = {}
  for (const metric of input ?? []) {
    const label = metric.label.trim()
    const value = metric.value.trim()
    if (!label || !value) continue
    metrics[label] = value
  }
  return metrics
}

function planStatusFromStore(status: string): PlanStatus {
  switch (status.trim().toLowerCase()) {
    case 'done':
    case 'complete':
      return 'complete'
    case 'blocked':
      return 'blocked'
    case 'paused':
    case 'at_risk':
      return 'at_risk'
    default:
      return 'on_track'
  }
}

function storeStatusFromPlan(status: PlanStatus | undefined, fallback = 'active'): string {
  switch (status) {
    case 'complete':
      return 'done'
    case 'blocked':
      return 'blocked'
    case 'at_risk':
      return 'paused'
    case 'on_track':
      return 'active'
    default:
      return fallback
  }
}

function taskProgressFromStore(task: AgentServicePlanTask): number {
  if (planStatusFromStore(task.status) === 'complete') return 100
  return 0
}

function milestoneProgressFromStore(milestone: AgentServicePlanMilestone): number {
  if (milestone.tasks.length > 0) {
    const completed = milestone.tasks.filter((task) => planStatusFromStore(task.status) === 'complete').length
    return Math.round((completed / milestone.tasks.length) * 100)
  }
  if (planStatusFromStore(milestone.status) === 'complete') return 100
  return 0
}

function toTaskModel(task: AgentServicePlanTask, milestoneId: string, orderIndex: number, updatedAt: string): PlanTask {
  return {
    id: task.id,
    milestoneId,
    title: task.title,
    notes: task.notes || undefined,
    status: planStatusFromStore(task.status),
    progressPercent: taskProgressFromStore(task),
    orderIndex,
    createdAt: updatedAt,
    updatedAt,
  }
}

function toMilestoneModel(
  milestone: AgentServicePlanMilestone,
  planId: string,
  orderIndex: number,
  updatedAt: string,
): PlanMilestone {
  return {
    id: milestone.id,
    planId,
    title: milestone.title,
    notes: milestone.summary || undefined,
    status: planStatusFromStore(milestone.status),
    progressPercent: milestoneProgressFromStore(milestone),
    orderIndex,
    createdAt: updatedAt,
    updatedAt,
    tasks: (milestone.tasks ?? []).map((task, taskIndex) => toTaskModel(task, milestone.id, taskIndex, updatedAt)),
  }
}

function toPlanModel(plan: AgentServicePlan): PlanGoal {
  const updatedAt = plan.updated_at ?? new Date().toISOString()
  return {
    id: plan.id,
    userId: plan.user_id,
    title: plan.title,
    vision: plan.vision || undefined,
    status: planStatusFromStore(plan.status),
    progressPercent: clampProgress(plan.progress?.percent_complete) ?? 0,
    category: plan.category || undefined,
    reviewCadence: plan.review_cadence || undefined,
    nextReviewAt: plan.progress?.next_review_at ?? undefined,
    tags: toStringArray(plan.tags),
    sourceSystems: toStringArray(plan.data_sources),
    metrics: toMetricsArray(plan.metrics),
    createdAt: plan.created_at ?? updatedAt,
    updatedAt,
    milestones: (plan.milestones ?? []).map((milestone, milestoneIndex) => (
      toMilestoneModel(milestone, plan.id, milestoneIndex, updatedAt)
    )),
  }
}

function clonePlan(plan: AgentServicePlan): AgentServicePlan {
  return {
    ...plan,
    tags: [...(plan.tags ?? [])],
    data_sources: [...(plan.data_sources ?? [])],
    connectors: [...(plan.connectors ?? [])],
    metrics: { ...(plan.metrics ?? {}) },
    milestones: (plan.milestones ?? []).map((milestone) => ({
      ...milestone,
      tasks: (milestone.tasks ?? []).map((task) => ({ ...task })),
    })),
    steps: [...(plan.steps ?? [])],
  }
}

async function getOwnedPlan(userId: string, planId: string): Promise<AgentServicePlan> {
  const plan = await fetchPlanFromAgentService(userId, planId)
  return clonePlan(plan)
}

async function persistPlan(userId: string, plan: AgentServicePlan): Promise<AgentServicePlan> {
  return upsertPlanInAgentService(userId, {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    vision: plan.vision,
    target: plan.target,
    category: plan.category,
    tags: plan.tags,
    data_sources: plan.data_sources,
    review_cadence: plan.review_cadence,
    summary: plan.summary,
    metrics: plan.metrics,
    milestones: plan.milestones ?? [],
    steps: plan.steps ?? [],
  })
}

export default async function planRoutes(app: FastifyInstance) {
  app.get('/plans', async (req, reply) => {
    try {
      const plans = await fetchPlansFromAgentService(req.userId)
      return reply.send({ plans: plans.map(toPlanModel) })
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'list plans')
    }
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
      try {
        const plan = await upsertPlanInAgentService(req.userId, {
          title: req.body.title.trim(),
          status: storeStatusFromPlan(req.body.status, 'active'),
          vision: req.body.vision?.trim() || '',
          category: req.body.category?.trim() || '',
          tags: toStringArray(req.body.tags),
          data_sources: toStringArray(req.body.sourceSystems),
          review_cadence: req.body.reviewCadence?.trim() || '',
          metrics: toMetricsObject(req.body.metrics),
          milestones: [],
          steps: [],
        })
        return reply.status(201).send({ plan: toPlanModel(plan) })
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'create plan')
      }
    },
  )

  app.post<{ Body: { title?: string; text: string; source?: string } }>(
    '/plans/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['text'],
          properties: {
            title: { type: 'string', maxLength: 200 },
            text: { type: 'string', minLength: 1, maxLength: 200000 },
            source: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const plan = await importPlanInAgentService(req.userId, {
          title: req.body.title?.trim() || undefined,
          text: req.body.text,
          source: req.body.source?.trim() || undefined,
        })
        return reply.code(201).send({ plan: toPlanModel(plan) })
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'import plan')
      }
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
      try {
        const plan = await getOwnedPlan(req.userId, req.params.planId)
        if (req.body.title !== undefined) plan.title = req.body.title.trim()
        if (req.body.vision !== undefined) plan.vision = req.body.vision?.trim() || ''
        if (req.body.status !== undefined) plan.status = storeStatusFromPlan(req.body.status, plan.status || 'active')
        if (req.body.category !== undefined) plan.category = req.body.category?.trim() || ''
        if (req.body.reviewCadence !== undefined) plan.review_cadence = req.body.reviewCadence?.trim() || ''
        if (req.body.tags !== undefined) plan.tags = toStringArray(req.body.tags)
        if (req.body.sourceSystems !== undefined) plan.data_sources = toStringArray(req.body.sourceSystems)
        if (req.body.metrics !== undefined) plan.metrics = toMetricsObject(req.body.metrics)
        const updated = await persistPlan(req.userId, plan)
        return reply.send({ plan: toPlanModel(updated) })
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'update plan')
      }
    },
  )

  app.delete<{ Params: { planId: string } }>('/plans/:planId', async (req, reply) => {
    try {
      await deletePlanInAgentService(req.userId, req.params.planId)
      return reply.status(204).send()
    } catch (err) {
      return sendAgentServiceError(reply, req, err, 'delete plan')
    }
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
      try {
        const plan = await getOwnedPlan(req.userId, req.params.planId)
        const milestone: AgentServicePlanMilestone = {
          id: randomUUID(),
          title: req.body.title.trim(),
          status: storeStatusFromPlan(req.body.status, 'active'),
          summary: req.body.notes?.trim() || '',
          tasks: [],
        }
        const milestones = plan.milestones ?? []
        const insertAt = Math.min(Math.max(req.body.orderIndex ?? milestones.length, 0), milestones.length)
        milestones.splice(insertAt, 0, milestone)
        plan.milestones = milestones
        const updated = await persistPlan(req.userId, plan)
        const created = updated.milestones?.find((item) => item.id === milestone.id)
        return reply.status(201).send({
          milestone: toMilestoneModel(created ?? milestone, plan.id, insertAt, updated.updated_at ?? new Date().toISOString()),
        })
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'create milestone')
      }
    },
  )

  app.put<{ Params: { planId: string; milestoneId: string }; Body: UpdatePlanMilestoneRequest }>(
    '/plans/:planId/milestones/:milestoneId',
    async (req, reply) => {
      try {
        const plan = await getOwnedPlan(req.userId, req.params.planId)
        const milestones = plan.milestones ?? []
        const milestoneIndex = milestones.findIndex((item) => item.id === req.params.milestoneId)
        if (milestoneIndex < 0) {
          return reply.status(404).send({ error: 'Milestone not found' })
        }
        const milestone = milestones[milestoneIndex]
        if (req.body.title !== undefined) milestone.title = req.body.title.trim()
        if (req.body.notes !== undefined) milestone.summary = req.body.notes?.trim() || ''
        if (req.body.status !== undefined) milestone.status = storeStatusFromPlan(req.body.status, milestone.status || 'active')
        if (req.body.orderIndex !== undefined) {
          milestones.splice(milestoneIndex, 1)
          const insertAt = Math.min(Math.max(req.body.orderIndex, 0), milestones.length)
          milestones.splice(insertAt, 0, milestone)
        }
        const updated = await persistPlan(req.userId, plan)
        const updatedMilestones = updated.milestones ?? []
        const updatedIndex = updatedMilestones.findIndex((item) => item.id === req.params.milestoneId)
        const saved = updatedIndex >= 0 ? updatedMilestones[updatedIndex] : milestone
        return reply.send({
          milestone: toMilestoneModel(saved, plan.id, Math.max(updatedIndex, 0), updated.updated_at ?? new Date().toISOString()),
        })
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'update milestone')
      }
    },
  )

  app.delete<{ Params: { planId: string; milestoneId: string } }>(
    '/plans/:planId/milestones/:milestoneId',
    async (req, reply) => {
      try {
        const plan = await getOwnedPlan(req.userId, req.params.planId)
        const milestones = plan.milestones ?? []
        const remaining = milestones.filter((item) => item.id !== req.params.milestoneId)
        if (remaining.length === milestones.length) {
          return reply.status(404).send({ error: 'Milestone not found' })
        }
        plan.milestones = remaining
        await persistPlan(req.userId, plan)
        return reply.status(204).send()
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'delete milestone')
      }
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
      try {
        const plan = await getOwnedPlan(req.userId, req.params.planId)
        const milestone = (plan.milestones ?? []).find((item) => item.id === req.params.milestoneId)
        if (!milestone) {
          return reply.status(404).send({ error: 'Milestone not found' })
        }
        const task: AgentServicePlanTask = {
          id: randomUUID(),
          title: req.body.title.trim(),
          status: storeStatusFromPlan(req.body.status, 'todo'),
          notes: req.body.notes?.trim() || '',
        }
        const tasks = milestone.tasks ?? []
        const insertAt = Math.min(Math.max(req.body.orderIndex ?? tasks.length, 0), tasks.length)
        tasks.splice(insertAt, 0, task)
        milestone.tasks = tasks
        const updated = await persistPlan(req.userId, plan)
        const savedMilestone = (updated.milestones ?? []).find((item) => item.id === req.params.milestoneId) ?? milestone
        const savedTask = (savedMilestone.tasks ?? []).find((item) => item.id === task.id) ?? task
        return reply.status(201).send({
          task: toTaskModel(savedTask, req.params.milestoneId, insertAt, updated.updated_at ?? new Date().toISOString()),
        })
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'create task')
      }
    },
  )

  app.put<{ Params: { planId: string; milestoneId: string; taskId: string }; Body: UpdatePlanTaskRequest }>(
    '/plans/:planId/milestones/:milestoneId/tasks/:taskId',
    async (req, reply) => {
      try {
        const plan = await getOwnedPlan(req.userId, req.params.planId)
        const milestone = (plan.milestones ?? []).find((item) => item.id === req.params.milestoneId)
        if (!milestone) {
          return reply.status(404).send({ error: 'Milestone not found' })
        }
        const tasks = milestone.tasks ?? []
        const taskIndex = tasks.findIndex((item) => item.id === req.params.taskId)
        if (taskIndex < 0) {
          return reply.status(404).send({ error: 'Task not found' })
        }
        const task = tasks[taskIndex]
        if (req.body.title !== undefined) task.title = req.body.title.trim()
        if (req.body.notes !== undefined) task.notes = req.body.notes?.trim() || ''
        if (req.body.status !== undefined) task.status = storeStatusFromPlan(req.body.status, task.status || 'todo')
        if (req.body.orderIndex !== undefined) {
          tasks.splice(taskIndex, 1)
          const insertAt = Math.min(Math.max(req.body.orderIndex, 0), tasks.length)
          tasks.splice(insertAt, 0, task)
        }
        const updated = await persistPlan(req.userId, plan)
        const savedMilestone = (updated.milestones ?? []).find((item) => item.id === req.params.milestoneId) ?? milestone
        const savedIndex = (savedMilestone.tasks ?? []).findIndex((item) => item.id === req.params.taskId)
        const savedTask = savedIndex >= 0 ? savedMilestone.tasks[savedIndex] : task
        return reply.send({
          task: toTaskModel(savedTask, req.params.milestoneId, Math.max(savedIndex, 0), updated.updated_at ?? new Date().toISOString()),
        })
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'update task')
      }
    },
  )

  app.delete<{ Params: { planId: string; milestoneId: string; taskId: string } }>(
    '/plans/:planId/milestones/:milestoneId/tasks/:taskId',
    async (req, reply) => {
      try {
        const plan = await getOwnedPlan(req.userId, req.params.planId)
        const milestone = (plan.milestones ?? []).find((item) => item.id === req.params.milestoneId)
        if (!milestone) {
          return reply.status(404).send({ error: 'Milestone not found' })
        }
        const tasks = milestone.tasks ?? []
        const remaining = tasks.filter((item) => item.id !== req.params.taskId)
        if (remaining.length === tasks.length) {
          return reply.status(404).send({ error: 'Task not found' })
        }
        milestone.tasks = remaining
        await persistPlan(req.userId, plan)
        return reply.status(204).send()
      } catch (err) {
        return sendAgentServiceError(reply, req, err, 'delete task')
      }
    },
  )
}

function sendAgentServiceError(reply: FastifyReply, req: FastifyRequest, err: unknown, op: string) {
  if (err instanceof AgentServiceError && err.statusCode === 404) {
    return reply.status(404).send({ error: 'Plan not found' })
  }
  req.log.error({ err, op }, 'plan operation failed')
  const message = err instanceof Error ? err.message : String(err)
  return reply.status(502).send({ error: message })
}
