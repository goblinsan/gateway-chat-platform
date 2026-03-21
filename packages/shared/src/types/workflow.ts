export interface WorkflowStep {
  order: number
  agentId: string
  prompt: string
  label?: string
}

export interface Workflow {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
  createdAt: number
}

export interface WorkflowStepResult {
  step: WorkflowStep
  content: string
  provider: string
  latencyMs: number
}
