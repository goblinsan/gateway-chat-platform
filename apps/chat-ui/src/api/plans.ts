import type {
  PlanGoal,
  PlansListResponse,
  PlanResponse,
  CreatePlanRequest,
  UpdatePlanRequest,
  CreatePlanMilestoneRequest,
  UpdatePlanMilestoneRequest,
  CreatePlanTaskRequest,
  UpdatePlanTaskRequest,
} from '@gateway/shared'
import { apiClient } from './client'

export async function listPlans(): Promise<PlanGoal[]> {
  const res = await apiClient.get<PlansListResponse>('/plans')
  return res.data.plans
}

export async function createPlan(data: CreatePlanRequest): Promise<PlanGoal> {
  const res = await apiClient.post<PlanResponse>('/plans', data)
  return res.data.plan
}

export async function importPlanDocument(data: { title?: string; text: string; source?: string }): Promise<PlanGoal> {
  const res = await apiClient.post<PlanResponse>('/plans/import', data)
  return res.data.plan
}

export async function updatePlan(planId: string, data: UpdatePlanRequest): Promise<PlanGoal> {
  const res = await apiClient.put<PlanResponse>(`/plans/${encodeURIComponent(planId)}`, data)
  return res.data.plan
}

export async function deletePlan(planId: string): Promise<void> {
  await apiClient.delete(`/plans/${encodeURIComponent(planId)}`)
}

export async function createPlanMilestone(
  planId: string,
  data: CreatePlanMilestoneRequest,
): Promise<void> {
  await apiClient.post(`/plans/${encodeURIComponent(planId)}/milestones`, data)
}

export async function updatePlanMilestone(
  planId: string,
  milestoneId: string,
  data: UpdatePlanMilestoneRequest,
): Promise<void> {
  await apiClient.put(
    `/plans/${encodeURIComponent(planId)}/milestones/${encodeURIComponent(milestoneId)}`,
    data,
  )
}

export async function deletePlanMilestone(planId: string, milestoneId: string): Promise<void> {
  await apiClient.delete(`/plans/${encodeURIComponent(planId)}/milestones/${encodeURIComponent(milestoneId)}`)
}

export async function createPlanTask(
  planId: string,
  milestoneId: string,
  data: CreatePlanTaskRequest,
): Promise<void> {
  await apiClient.post(
    `/plans/${encodeURIComponent(planId)}/milestones/${encodeURIComponent(milestoneId)}/tasks`,
    data,
  )
}

export async function updatePlanTask(
  planId: string,
  milestoneId: string,
  taskId: string,
  data: UpdatePlanTaskRequest,
): Promise<void> {
  await apiClient.put(
    `/plans/${encodeURIComponent(planId)}/milestones/${encodeURIComponent(milestoneId)}/tasks/${encodeURIComponent(taskId)}`,
    data,
  )
}

export async function deletePlanTask(planId: string, milestoneId: string, taskId: string): Promise<void> {
  await apiClient.delete(
    `/plans/${encodeURIComponent(planId)}/milestones/${encodeURIComponent(milestoneId)}/tasks/${encodeURIComponent(taskId)}`,
  )
}
