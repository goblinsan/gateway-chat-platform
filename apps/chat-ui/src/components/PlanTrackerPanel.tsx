import { useRef } from 'react'
import type { PlanGoal, PlanStatus } from '@gateway/shared'

interface PlanTrackerPanelProps {
  isOpen: boolean
  plans: PlanGoal[]
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
  onClose: () => void
  onCreatePlan: (input: { title: string; vision?: string }) => Promise<void>
  onImportPlan: (input: { title?: string; text: string; source?: string }) => Promise<void>
  onPatchPlan: (planId: string, patch: { title?: string; vision?: string; status?: PlanStatus }) => Promise<void>
  onDeletePlan: (planId: string) => Promise<void>
  onAddMilestone: (input: { planId: string; title: string }) => Promise<void>
  onUpdateMilestoneStatus: (planId: string, milestoneId: string, status: PlanStatus) => Promise<void>
  onDeleteMilestone: (planId: string, milestoneId: string) => Promise<void>
  onAddTask: (input: { planId: string; milestoneId: string; title: string }) => Promise<void>
  onUpdateTaskStatus: (planId: string, milestoneId: string, taskId: string, status: PlanStatus) => Promise<void>
  onDeleteTask: (planId: string, milestoneId: string, taskId: string) => Promise<void>
}

const STATUS_LABEL: Record<PlanStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  complete: 'Complete',
}

const STATUS_CLASS: Record<PlanStatus, string> = {
  on_track: 'bg-green-900/40 text-green-300 border-green-700/50',
  at_risk: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  blocked: 'bg-red-900/40 text-red-300 border-red-700/50',
  complete: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
}

const STATUS_VALUES: PlanStatus[] = ['on_track', 'at_risk', 'blocked', 'complete']

function nextStatus(current: PlanStatus): PlanStatus {
  const index = STATUS_VALUES.indexOf(current)
  return STATUS_VALUES[(index + 1) % STATUS_VALUES.length]
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
      <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export default function PlanTrackerPanel({
  isOpen,
  plans,
  loading,
  error,
  onRefresh,
  onClose,
  onCreatePlan,
  onImportPlan,
  onPatchPlan,
  onDeletePlan,
  onAddMilestone,
  onUpdateMilestoneStatus,
  onDeleteMilestone,
  onAddTask,
  onUpdateTaskStatus,
  onDeleteTask,
}: PlanTrackerPanelProps) {
  if (!isOpen) return null
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleCreatePlan = async () => {
    const title = window.prompt('Goal title')
    if (!title?.trim()) return
    const vision = window.prompt('Goal vision (optional)') ?? undefined
    await onCreatePlan({ title: title.trim(), vision: vision?.trim() || undefined })
  }

  const handleImportFile = async (file: File | null) => {
    if (!file) return
    try {
      const text = (await file.text()).trim()
      if (!text) return
      const title = file.name.replace(/\.[^.]+$/, '').trim() || undefined
      await onImportPlan({ title, text, source: title })
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    }
  }

  return (
    <aside className="w-full md:w-[34rem] border-l border-gray-800 bg-gray-900/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-gray-800">
        <div>
          <p className="text-sm font-semibold text-gray-100">Plan Tracker</p>
          <p className="text-xs text-gray-500">Goals, milestones, tasks, progress, and review metadata</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void onRefresh() }}
            className="px-3 py-1.5 text-xs border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleCreatePlan}
            className="px-3 py-1.5 text-xs border border-blue-700 text-blue-300 hover:border-blue-600 hover:text-blue-200 transition-colors"
          >
            New Goal
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".txt,.md,.markdown,.yaml,.yml,text/plain,text/markdown,application/yaml,text/yaml"
            className="hidden"
            onChange={(event) => {
              void handleImportFile(event.target.files?.[0] ?? null)
            }}
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="px-3 py-1.5 text-xs border border-emerald-700 text-emerald-300 hover:border-emerald-600 hover:text-emerald-200 transition-colors"
          >
            Import Plan
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && <p className="text-xs text-gray-500 animate-pulse text-center">Loading plans…</p>}
        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
        {!loading && plans.length === 0 && (
          <div className="rounded-lg border border-gray-800 p-4 text-center">
            <p className="text-sm text-gray-300">No goals yet.</p>
            <p className="text-xs text-gray-500 mt-1">Create your first goal to start tracking milestones and tasks.</p>
          </div>
        )}
        {plans.map((plan) => (
          <div key={plan.id} className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-100 truncate">{plan.title}</p>
                {plan.vision && <p className="mt-1 text-xs text-gray-400">{plan.vision}</p>}
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded border ${STATUS_CLASS[plan.status]}`}>
                {STATUS_LABEL[plan.status]}
              </span>
            </div>

            <div className="mt-2">
              <ProgressBar value={plan.progressPercent} />
              <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
                <span>{plan.progressPercent}% complete</span>
                <span>{plan.reviewCadence ? `Review: ${plan.reviewCadence}` : 'Review cadence unset'}</span>
              </div>
              {(plan.sourceSystems.length > 0 || plan.metrics.length > 0) && (
                <div className="mt-2 text-[11px] text-gray-500">
                  {plan.sourceSystems.length > 0 && <p>Sources: {plan.sourceSystems.join(' · ')}</p>}
                  {plan.metrics.length > 0 && (
                    <p>
                      Metrics: {plan.metrics.map((metric) => `${metric.label}: ${metric.value}`).join(' · ')}
                    </p>
                  )}
                </div>
              )}
              {(plan.objectives.length > 0 || plan.principles.length > 0 || plan.baselineFacts.length > 0 || plan.trackedMetrics.length > 0 || plan.successCriteria.length > 0 || plan.cadence.length > 0 || plan.supportingSections.length > 0) && (
                <div className="mt-3 space-y-2 text-[11px] text-gray-400">
                  {plan.objectives.length > 0 && <p><span className="text-gray-500">Objectives:</span> {plan.objectives.join(' · ')}</p>}
                  {plan.principles.length > 0 && <p><span className="text-gray-500">Principles:</span> {plan.principles.join(' · ')}</p>}
                  {plan.baselineFacts.length > 0 && (
                    <p><span className="text-gray-500">Baseline:</span> {plan.baselineFacts.map((fact) => `${fact.label}: ${fact.value}`).join(' · ')}</p>
                  )}
                  {plan.trackedMetrics.length > 0 && (
                    <p><span className="text-gray-500">Track:</span> {plan.trackedMetrics.map((metric) => metric.notes ? `${metric.name} (${metric.notes})` : metric.name).join(' · ')}</p>
                  )}
                  {plan.successCriteria.length > 0 && <p><span className="text-gray-500">Success:</span> {plan.successCriteria.join(' · ')}</p>}
                  {plan.cadence.length > 0 && (
                    <p><span className="text-gray-500">Cadence:</span> {plan.cadence.map((entry) => `${entry.day ?? entry.label ?? 'Session'}: ${entry.activity}`).join(' · ')}</p>
                  )}
                  {plan.supportingSections.length > 0 && (
                    <div>
                      <p className="text-gray-500">Supporting material:</p>
                      <ul className="mt-1 space-y-1">
                        {plan.supportingSections.map((section) => (
                          <li key={section.title}>
                            <span className="text-gray-300">{section.title}</span>
                            {section.summary ? ` — ${section.summary}` : ''}
                            {section.items.length > 0 ? ` (${section.items.map((item) => item.label || item.uri || item.content || 'item').join(', ')})` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white"
                onClick={() => {
                  const title = window.prompt('Update goal title', plan.title)?.trim()
                  if (!title) return
                  void onPatchPlan(plan.id, { title })
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white"
                onClick={() => { void onPatchPlan(plan.id, { status: nextStatus(plan.status) }) }}
              >
                Next status
              </button>
              <button
                type="button"
                className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white"
                onClick={() => {
                  const title = window.prompt('New milestone title')
                  if (!title?.trim()) return
                  void onAddMilestone({ planId: plan.id, title: title.trim() })
                }}
              >
                Add milestone
              </button>
              <button
                type="button"
                className="text-[11px] px-2 py-1 rounded border border-red-700 text-red-300 hover:text-red-200"
                onClick={() => {
                  if (!window.confirm(`Delete "${plan.title}"?`)) return
                  void onDeletePlan(plan.id)
                }}
              >
                Delete
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {plan.milestones.map((milestone) => (
                <div key={milestone.id} className="rounded border border-gray-700 bg-gray-900/40 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-gray-200 font-medium">{milestone.title}</p>
                    <button
                      type="button"
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[milestone.status]}`}
                      onClick={() => { void onUpdateMilestoneStatus(plan.id, milestone.id, nextStatus(milestone.status)) }}
                    >
                      {STATUS_LABEL[milestone.status]}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">{milestone.progressPercent}% complete</p>
                  <ProgressBar value={milestone.progressPercent} />

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-300"
                      onClick={() => {
                        const title = window.prompt('New task title')
                        if (!title?.trim()) return
                        void onAddTask({ planId: plan.id, milestoneId: milestone.id, title: title.trim() })
                      }}
                    >
                      Add task
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-red-700 text-red-300"
                      onClick={() => {
                        if (!window.confirm(`Delete milestone "${milestone.title}"?`)) return
                        void onDeleteMilestone(plan.id, milestone.id)
                      }}
                    >
                      Delete milestone
                    </button>
                  </div>

                  <ul className="mt-2 space-y-1">
                    {milestone.tasks.map((task) => (
                      <li key={task.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-gray-300">{task.title}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className={`px-1.5 py-0.5 rounded border ${STATUS_CLASS[task.status]}`}
                            onClick={() => { void onUpdateTaskStatus(plan.id, milestone.id, task.id, nextStatus(task.status)) }}
                          >
                            {STATUS_LABEL[task.status]}
                          </button>
                          <button
                            type="button"
                            className="px-1.5 py-0.5 rounded border border-red-700 text-red-300"
                            onClick={() => { void onDeleteTask(plan.id, milestone.id, task.id) }}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
