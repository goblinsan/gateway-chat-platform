import { useCallback, useState } from 'react'
import type { PlanGoal, PlanStatus } from '@gateway/shared'
import {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  createPlanMilestone,
  updatePlanMilestone,
  deletePlanMilestone,
  createPlanTask,
  updatePlanTask,
  deletePlanTask,
} from '../api/plans'

type PlanPatch = Partial<Pick<PlanGoal, 'title' | 'vision' | 'status' | 'progressPercent' | 'reviewCadence' | 'sourceSystems' | 'metrics'>>

interface CreatePlanInput {
  title: string
  vision?: string
}

interface CreateMilestoneInput {
  planId: string
  title: string
}

interface CreateTaskInput {
  planId: string
  milestoneId: string
  title: string
}

export function usePlans() {
  const [plans, setPlans] = useState<PlanGoal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPlans(await listPlans())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plans')
    } finally {
      setLoading(false)
    }
  }, [])

  const create = useCallback(async ({ title, vision }: CreatePlanInput) => {
    const tempId = `temp-${Date.now()}`
    const now = new Date().toISOString()
    const optimistic: PlanGoal = {
      id: tempId,
      userId: 'me',
      title,
      vision,
      status: 'on_track',
      progressPercent: 0,
      tags: [],
      sourceSystems: [],
      metrics: [],
      createdAt: now,
      updatedAt: now,
      milestones: [],
    }
    setPlans((prev) => [optimistic, ...prev])
    try {
      const created = await createPlan({ title, vision })
      setPlans((prev) => prev.map((plan) => (plan.id === tempId ? created : plan)))
    } catch (err) {
      setPlans((prev) => prev.filter((plan) => plan.id !== tempId))
      setError(err instanceof Error ? err.message : 'Failed to create plan')
      await refresh()
    }
  }, [refresh])

  const patchPlan = useCallback(async (planId: string, patch: PlanPatch) => {
    const previous = plans
    setPlans((prev) => prev.map((plan) => (plan.id === planId ? { ...plan, ...patch } : plan)))
    try {
      const updated = await updatePlan(planId, patch)
      setPlans((prev) => prev.map((plan) => (plan.id === planId ? updated : plan)))
    } catch (err) {
      setPlans(previous)
      setError(err instanceof Error ? err.message : 'Failed to update plan')
      await refresh()
    }
  }, [plans, refresh])

  const remove = useCallback(async (planId: string) => {
    const previous = plans
    setPlans((prev) => prev.filter((plan) => plan.id !== planId))
    try {
      await deletePlan(planId)
    } catch (err) {
      setPlans(previous)
      setError(err instanceof Error ? err.message : 'Failed to delete plan')
      await refresh()
    }
  }, [plans, refresh])

  const addMilestone = useCallback(async ({ planId, title }: CreateMilestoneInput) => {
    const previous = plans
    const tempId = `temp-ms-${Date.now()}`
    const now = new Date().toISOString()
    setPlans((prev) => prev.map((plan) => (
      plan.id === planId
        ? {
            ...plan,
            milestones: [...plan.milestones, {
              id: tempId,
              planId,
              title,
              status: 'on_track',
              progressPercent: 0,
              orderIndex: plan.milestones.length,
              createdAt: now,
              updatedAt: now,
              tasks: [],
            }],
          }
        : plan
    )))
    try {
      await createPlanMilestone(planId, { title })
      await refresh()
    } catch (err) {
      setPlans(previous)
      setError(err instanceof Error ? err.message : 'Failed to add milestone')
      await refresh()
    }
  }, [plans, refresh])

  const updateMilestoneStatus = useCallback(async (planId: string, milestoneId: string, status: PlanStatus) => {
    const previous = plans
    setPlans((prev) => prev.map((plan) => (
      plan.id !== planId
        ? plan
        : {
            ...plan,
            milestones: plan.milestones.map((milestone) => (
              milestone.id === milestoneId ? { ...milestone, status } : milestone
            )),
          }
    )))
    try {
      await updatePlanMilestone(planId, milestoneId, { status })
      await refresh()
    } catch (err) {
      setPlans(previous)
      setError(err instanceof Error ? err.message : 'Failed to update milestone')
      await refresh()
    }
  }, [plans, refresh])

  const removeMilestone = useCallback(async (planId: string, milestoneId: string) => {
    const previous = plans
    setPlans((prev) => prev.map((plan) => (
      plan.id === planId
        ? { ...plan, milestones: plan.milestones.filter((milestone) => milestone.id !== milestoneId) }
        : plan
    )))
    try {
      await deletePlanMilestone(planId, milestoneId)
    } catch (err) {
      setPlans(previous)
      setError(err instanceof Error ? err.message : 'Failed to delete milestone')
      await refresh()
    }
  }, [plans, refresh])

  const addTask = useCallback(async ({ planId, milestoneId, title }: CreateTaskInput) => {
    const previous = plans
    const tempId = `temp-task-${Date.now()}`
    const now = new Date().toISOString()
    setPlans((prev) => prev.map((plan) => (
      plan.id !== planId
        ? plan
        : {
            ...plan,
            milestones: plan.milestones.map((milestone) => (
              milestone.id !== milestoneId
                ? milestone
                : {
                    ...milestone,
                    tasks: [...milestone.tasks, {
                      id: tempId,
                      milestoneId,
                      title,
                      status: 'on_track',
                      progressPercent: 0,
                      orderIndex: milestone.tasks.length,
                      createdAt: now,
                      updatedAt: now,
                    }],
                  }
            )),
          }
    )))
    try {
      await createPlanTask(planId, milestoneId, { title })
      await refresh()
    } catch (err) {
      setPlans(previous)
      setError(err instanceof Error ? err.message : 'Failed to add task')
      await refresh()
    }
  }, [plans, refresh])

  const updateTaskStatus = useCallback(async (planId: string, milestoneId: string, taskId: string, status: PlanStatus) => {
    const previous = plans
    setPlans((prev) => prev.map((plan) => (
      plan.id !== planId
        ? plan
        : {
            ...plan,
            milestones: plan.milestones.map((milestone) => (
              milestone.id !== milestoneId
                ? milestone
                : {
                    ...milestone,
                    tasks: milestone.tasks.map((task) => (task.id === taskId ? { ...task, status } : task)),
                  }
            )),
          }
    )))
    try {
      await updatePlanTask(planId, milestoneId, taskId, { status })
      await refresh()
    } catch (err) {
      setPlans(previous)
      setError(err instanceof Error ? err.message : 'Failed to update task')
      await refresh()
    }
  }, [plans, refresh])

  const removeTask = useCallback(async (planId: string, milestoneId: string, taskId: string) => {
    const previous = plans
    setPlans((prev) => prev.map((plan) => (
      plan.id !== planId
        ? plan
        : {
            ...plan,
            milestones: plan.milestones.map((milestone) => (
              milestone.id !== milestoneId
                ? milestone
                : { ...milestone, tasks: milestone.tasks.filter((task) => task.id !== taskId) }
            )),
          }
    )))
    try {
      await deletePlanTask(planId, milestoneId, taskId)
    } catch (err) {
      setPlans(previous)
      setError(err instanceof Error ? err.message : 'Failed to delete task')
      await refresh()
    }
  }, [plans, refresh])

  return {
    plans,
    loading,
    error,
    refresh,
    create,
    patchPlan,
    remove,
    addMilestone,
    updateMilestoneStatus,
    removeMilestone,
    addTask,
    updateTaskStatus,
    removeTask,
  }
}
