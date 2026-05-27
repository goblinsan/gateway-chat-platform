export type PlanStatus = 'on_track' | 'at_risk' | 'blocked' | 'complete'

export interface PlanMetric {
  label: string
  value: string
}

export interface PlanTask {
  id: string
  milestoneId: string
  title: string
  notes?: string
  status: PlanStatus
  progressPercent: number
  orderIndex: number
  createdAt: string
  updatedAt: string
}

export interface PlanMilestone {
  id: string
  planId: string
  title: string
  notes?: string
  status: PlanStatus
  progressPercent: number
  orderIndex: number
  createdAt: string
  updatedAt: string
  tasks: PlanTask[]
}

export interface PlanGoal {
  id: string
  userId: string
  title: string
  vision?: string
  status: PlanStatus
  progressPercent: number
  category?: string
  reviewCadence?: string
  nextReviewAt?: string
  tags: string[]
  sourceSystems: string[]
  metrics: PlanMetric[]
  createdAt: string
  updatedAt: string
  milestones: PlanMilestone[]
}

export interface PlansListResponse {
  plans: PlanGoal[]
}

export interface PlanResponse {
  plan: PlanGoal
}

export interface CreatePlanRequest {
  title: string
  vision?: string
  status?: PlanStatus
  progressPercent?: number
  category?: string
  reviewCadence?: string
  nextReviewAt?: string
  tags?: string[]
  sourceSystems?: string[]
  metrics?: PlanMetric[]
}

export type UpdatePlanRequest = Partial<CreatePlanRequest>

export interface CreatePlanMilestoneRequest {
  title: string
  notes?: string
  status?: PlanStatus
  progressPercent?: number
  orderIndex?: number
}

export type UpdatePlanMilestoneRequest = Partial<CreatePlanMilestoneRequest>

export interface CreatePlanTaskRequest {
  title: string
  notes?: string
  status?: PlanStatus
  progressPercent?: number
  orderIndex?: number
}

export type UpdatePlanTaskRequest = Partial<CreatePlanTaskRequest>
