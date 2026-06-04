export type PlanStatus = 'on_track' | 'at_risk' | 'blocked' | 'complete'
export type PlanTaskStatus = 'todo' | 'in_progress' | 'complete' | 'on_hold' | 'blocked'

export interface PlanMetric {
  label: string
  value: string
}

export interface PlanFact {
  label: string
  value: string
}

export interface PlanTrackedMetric {
  name: string
  notes?: string
  source?: string
  cadence?: string
  baseline?: string
  target?: string
}

export interface PlanCadenceEntry {
  label?: string
  day?: string
  activity: string
  notes?: string
}

export interface PlanSupportingItem {
  label?: string
  kind?: string
  content?: string
  uri?: string
}

export interface PlanSupportingSection {
  title: string
  kind?: string
  summary?: string
  items: PlanSupportingItem[]
}

export interface PlanTask {
  id: string
  milestoneId: string
  title: string
  notes?: string
  status: PlanTaskStatus
  progressPercent: number
  orderIndex: number
  dueAt?: string
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
  targetDate?: string
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
  objectives: string[]
  principles: string[]
  reviewCadence?: string
  nextReviewAt?: string
  tags: string[]
  sourceSystems: string[]
  metrics: PlanMetric[]
  trackedMetrics: PlanTrackedMetric[]
  baselineFacts: PlanFact[]
  successCriteria: string[]
  cadence: PlanCadenceEntry[]
  supportingSections: PlanSupportingSection[]
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

export interface ImportPlanRequest {
  planId?: string
  title?: string
  text: string
  source?: string
}

export interface ExportPlanResponse {
  filename: string
  document: string
  contentType: string
}

export interface CreatePlanRequest {
  title: string
  vision?: string
  status?: PlanStatus
  progressPercent?: number
  category?: string
  objectives?: string[]
  principles?: string[]
  reviewCadence?: string
  nextReviewAt?: string
  tags?: string[]
  sourceSystems?: string[]
  metrics?: PlanMetric[]
  trackedMetrics?: PlanTrackedMetric[]
  baselineFacts?: PlanFact[]
  successCriteria?: string[]
  cadence?: PlanCadenceEntry[]
  supportingSections?: PlanSupportingSection[]
}

export type UpdatePlanRequest = Partial<CreatePlanRequest>

export interface CreatePlanMilestoneRequest {
  title: string
  notes?: string
  status?: PlanStatus
  progressPercent?: number
  orderIndex?: number
  targetDate?: string
}

export type UpdatePlanMilestoneRequest = Partial<CreatePlanMilestoneRequest>

export interface CreatePlanTaskRequest {
  title: string
  notes?: string
  status?: PlanTaskStatus
  progressPercent?: number
  orderIndex?: number
  dueAt?: string
}

export type UpdatePlanTaskRequest = Partial<CreatePlanTaskRequest>
